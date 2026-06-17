from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from helpers import register_owner

REGOS_TOKEN = "a" * 32

FULL_DEFAULTS = {
    "warehouse": {"id": 11, "name": "Main warehouse"},
    "price_type": {"id": 22, "name": "Retail"},
    "partner": {"id": 33, "name": "Walk-in"},
    "payment_category": {"id": 66, "name": "Sales"},
}

ENRICHED_DEFAULTS = {
    **FULL_DEFAULTS,
    "currency": {"id": 44, "name": "UZS"},
    "firm": {"id": 55, "name": "Main firm"},
}

DOC_WHOLESALE_TYPE_ID = 77


async def _configure_checkout_defaults(client: AsyncClient, headers: dict) -> None:
    await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={"settings": {"regos_defaults": FULL_DEFAULTS}},
    )


@patch(
    "app.services.regos_sales.regos_defaults_service.get_doc_wholesale_document_type_id",
    new_callable=AsyncMock,
)
@patch("app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_checkout_happy_path(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001, "code": "WS-1001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
        {"ok": True, "result": {"code": "WS-1001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(client, email="checkout@test.com", company_name="Checkout Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/checkout",
        headers=headers,
        json={
            "items": [{"regos_item_id": 101, "qty": 2, "price": 10000}],
            "discount": 0,
            "payment_type_id": 5,
            "total": 20000,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["wholesale_doc_id"] == 1001
    assert data["wholesale_code"] == "WS-1001"
    assert data["payment_doc_id"] == 3001
    assert data["total"] == 20000
    assert len(data["lines"]) == 1
    assert data["lines"][0]["regos_item_id"] == 101

    calls = [call[0][2] for call in mock_regos.call_args_list]
    assert calls == [
        "docwholesale/add",
        "docwholesale/lock",
        "wholesaleoperation/add",
        "docwholesale/unlock",
        "docwholesale/perform",
        "docpayment/add",
        "docpayment/perform",
    ]

    add_payload = mock_regos.call_args_list[0][0][3]
    assert add_payload["partner_id"] == 33
    assert add_payload["stock_id"] == 11
    assert add_payload["currency_id"] == 44
    assert add_payload["price_type_id"] == 22
    assert add_payload["vat_calculation_type"] == "Exclude"

    lock_payload = mock_regos.call_args_list[1][0][3]
    assert lock_payload == {"ids": [1001]}

    ops_payload = mock_regos.call_args_list[2][0][3]
    assert ops_payload[0]["document_id"] == 1001
    assert ops_payload[0]["item_id"] == 101
    assert ops_payload[0]["quantity"] == 2

    unlock_payload = mock_regos.call_args_list[3][0][3]
    assert unlock_payload == {"ids": [1001]}

    payment_payload = mock_regos.call_args_list[5][0][3]
    assert payment_payload["document"] == 1001
    assert payment_payload["type_id"] == 5
    assert payment_payload["amount"] == 20000
    assert payment_payload["firm_id"] == 55
    assert payment_payload["category_id"] == 66
    assert payment_payload["document_type_id"] == DOC_WHOLESALE_TYPE_ID


@pytest.mark.asyncio
async def test_checkout_missing_defaults_returns_400(client: AsyncClient) -> None:
    reg = await register_owner(client, email="checkout-missing@test.com", company_name="Missing Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.post(
        "/api/v1/sales/checkout",
        headers=headers,
        json={
            "items": [{"regos_item_id": 101, "qty": 1, "price": 100}],
            "discount": 0,
            "payment_type_id": 5,
            "total": 100,
        },
    )
    assert response.status_code == 400
    assert response.json()["code"] == "REGOS_CHECKOUT_DEFAULTS_NOT_CONFIGURED"


@patch(
    "app.services.regos_sales.regos_defaults_service.get_doc_wholesale_document_type_id",
    new_callable=AsyncMock,
)
@patch("app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_checkout_perform_failure_returns_error(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    client: AsyncClient,
) -> None:
    from app.core.exceptions import AppError

    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
        AppError(400, "Perform failed", "REGOS_API_ERROR"),
    ]

    reg = await register_owner(client, email="checkout-fail@test.com", company_name="Fail Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/checkout",
        headers=headers,
        json={
            "items": [{"regos_item_id": 101, "qty": 1, "price": 100}],
            "discount": 0,
            "payment_type_id": 5,
            "total": 100,
        },
    )
    assert response.status_code == 400
    assert "wholesale_doc_id=1001" in response.json()["detail"]


@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_list_wholesale_documents(mock_regos: AsyncMock, client: AsyncClient) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 1001,
                "code": "WS-1001",
                "date": 1717000000,
                "amount": 25000,
                "performed": True,
                "partner": {"id": 33, "name": "Walk-in"},
                "stock": {"id": 11, "name": "Main warehouse"},
            }
        ],
        "next_offset": 0,
        "total": 1,
    }

    reg = await register_owner(client, email="sales-list@test.com", company_name="Sales List Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.get(
        "/api/v1/sales/wholesale-documents",
        headers=headers,
        params={"start_date": 1716000000, "end_date": 1718000000},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["documents"]) == 1
    assert data["documents"][0]["code"] == "WS-1001"
    assert data["documents"][0]["partner_name"] == "Walk-in"

    payload = mock_regos.call_args[0][3]
    assert payload["start_date"] == 1716000000
    assert payload["partner_ids"] == [33]
    assert payload["stock_ids"] == [11]


@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_list_wholesale_operations(mock_regos: AsyncMock, client: AsyncClient) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 5001,
                "document_id": 1001,
                "quantity": 2,
                "price": 10000,
                "item": {"id": 101, "name": "Cola"},
            }
        ],
    }

    reg = await register_owner(client, email="sales-ops@test.com", company_name="Sales Ops Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.get(
        "/api/v1/sales/wholesale-documents/1001/operations",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["operations"][0]["item_name"] == "Cola"
    assert data["operations"][0]["quantity"] == 2

    payload = mock_regos.call_args[0][3]
    assert payload["document_ids"] == [1001]


@pytest.mark.asyncio
async def test_employee_can_read_wholesale_documents(client: AsyncClient) -> None:
    reg = await register_owner(client, email="sales-read@test.com", company_name="Read Co")
    owner_token = reg.json()["access_token"]
    company_slug = reg.json()["user"]["company"]["slug"]
    owner_headers = {"Authorization": f"Bearer {owner_token}"}

    await client.post(
        "/api/v1/users",
        headers=owner_headers,
        json={
            "login": "cashier",
            "password": "employee123",
            "display_name": "Cashier",
            "role": "employee",
        },
    )

    emp_login = await client.post(
        "/api/v1/auth/login",
        json={"company_slug": company_slug, "login": "cashier", "password": "employee123"},
    )
    emp_headers = {"Authorization": f"Bearer {emp_login.json()['access_token']}"}

    with patch(
        "app.services.regos_sales.regos_async_api_request_for_company",
        new_callable=AsyncMock,
    ) as mock_regos:
        mock_regos.return_value = {"ok": True, "result": [], "next_offset": 0, "total": 0}
        response = await client.get("/api/v1/sales/wholesale-documents", headers=emp_headers)

    assert response.status_code == 200
    assert response.json()["documents"] == []
