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
    "currency": {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1},
    "firm": {"id": 55, "name": "Main firm"},
    "vat_calculation_type": "Include",
}

PAYMENT_TYPE_UZS = {
    "id": 5,
    "name": "Cash",
    "is_cash": True,
    "allows_debt": False,
    "image_url": "",
    "currency": {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1},
}

PAYMENT_TYPE_USD = {
    "id": 6,
    "name": "Dollars",
    "is_cash": True,
    "allows_debt": False,
    "image_url": "",
    "currency": {"id": 2, "name": "US Dollar", "code_chr": "USD", "exchange_rate": 12600},
}

DOC_WHOLESALE_TYPE_ID = 77
DOC_WHOLESALE_RETURN_TYPE_ID = 88


async def _mock_payment_type_by_id(_session, _company_id, payment_type_id: int) -> dict:
    if payment_type_id == PAYMENT_TYPE_USD["id"]:
        return PAYMENT_TYPE_USD
    return PAYMENT_TYPE_UZS


async def _configure_checkout_defaults(client: AsyncClient, headers: dict) -> None:
    await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={"settings": {"regos_defaults": FULL_DEFAULTS}},
    )


@patch(
    "app.services.regos_sales.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
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
    mock_payment_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
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
    assert data["wholesale_code"] == "1001"
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
    assert add_payload["vat_calculation_type"] == "Include"

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
    assert payment_payload["exchange_rate"] == 1
    assert payment_payload["description"] == "1001"
    assert payment_payload["firm_id"] == 55
    assert payment_payload["category_id"] == 66
    assert payment_payload["document_type_id"] == DOC_WHOLESALE_TYPE_ID


@patch(
    "app.services.regos_sales.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_sales.regos_defaults_service.get_doc_wholesale_document_type_id",
    new_callable=AsyncMock,
)
@patch("app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_checkout_partial_payment(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001, "code": "WS-1001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
        {"ok": True, "result": {"code": "WS-1001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(client, email="checkout-partial@test.com", company_name="Partial Co")
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
            "amount_paid": 8000,
            "tendered": 8000,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["amount_paid"] == 8000
    assert data["balance_due"] == 12000
    assert data["is_fully_paid"] is False
    assert data["payment"]["amount_paid"] == 8000

    payment_payload = mock_regos.call_args_list[5][0][3]
    assert payment_payload["amount"] == 8000
    assert payment_payload["exchange_rate"] == 1


@patch(
    "app.services.regos_sales.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_sales.regos_defaults_service.get_doc_wholesale_document_type_id",
    new_callable=AsyncMock,
)
@patch("app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_checkout_converts_payment_to_payment_currency(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001, "code": "WS-1001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
        {"ok": True, "result": {"code": "WS-1001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(client, email="checkout-fx@test.com", company_name="FX Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/checkout",
        headers=headers,
        json={
            "items": [{"regos_item_id": 101, "qty": 1, "price": 120000}],
            "discount": 0,
            "payment_type_id": 6,
            "total": 120000,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["amount_paid"] == 120000
    assert data["balance_due"] == 0
    assert data["payment"]["payment_amount"] == 9.52
    assert data["payment"]["payment_currency"]["code_chr"] == "USD"
    assert data["payment"]["sale_currency"]["code_chr"] == "UZS"

    payment_payload = mock_regos.call_args_list[5][0][3]
    assert payment_payload["type_id"] == 6
    assert payment_payload["amount"] == 9.52
    assert payment_payload["exchange_rate"] == 12600


@patch(
    "app.services.regos_sales.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_sales.regos_defaults_service.get_doc_wholesale_document_type_id",
    new_callable=AsyncMock,
)
@patch("app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_checkout_partial_payment_converts_to_payment_currency(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001, "code": "WS-1001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
        {"ok": True, "result": {"code": "WS-1001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(
        client, email="checkout-fx-partial@test.com", company_name="FX Partial Co"
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/checkout",
        headers=headers,
        json={
            "items": [{"regos_item_id": 101, "qty": 1, "price": 120000}],
            "discount": 0,
            "payment_type_id": 6,
            "total": 120000,
            "amount_paid": 63000,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["amount_paid"] == 63000
    assert data["balance_due"] == 57000
    assert data["payment"]["payment_amount"] == 5.0

    payment_payload = mock_regos.call_args_list[5][0][3]
    assert payment_payload["amount"] == 5.0
    assert payment_payload["exchange_rate"] == 12600


@patch(
    "app.services.regos_sales.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_sales.regos_defaults_service.get_doc_wholesale_document_type_id",
    new_callable=AsyncMock,
)
@patch("app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_checkout_deferred_payment_skips_payment_doc(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001, "code": "WS-1001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
        {"ok": True, "result": {"code": "WS-1001"}},
    ]

    reg = await register_owner(client, email="checkout-debt@test.com", company_name="Debt Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/checkout",
        headers=headers,
        json={
            "items": [{"regos_item_id": 101, "qty": 1, "price": 15000}],
            "discount": 0,
            "payment_type_id": 9,
            "total": 15000,
            "amount_paid": 0,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["payment_doc_id"] is None
    assert data["amount_paid"] == 0
    assert data["balance_due"] == 15000
    assert data["is_fully_paid"] is False

    calls = [call[0][2] for call in mock_regos.call_args_list]
    assert "docpayment/add" not in calls
    assert "docpayment/perform" not in calls


@patch(
    "app.services.regos_sales.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_sales.regos_defaults_service.get_doc_wholesale_document_type_id",
    new_callable=AsyncMock,
)
@patch("app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_checkout_multiple_payments(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001, "code": "WS-1001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
        {"ok": True, "result": {"code": "WS-1001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
        {"ok": True, "result": {"new_id": 3002}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(
        client, email="checkout-multi@test.com", company_name="Multi Pay Co"
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/checkout",
        headers=headers,
        json={
            "items": [{"regos_item_id": 101, "qty": 1, "price": 120000}],
            "discount": 0,
            "total": 120000,
            "payments": [
                {"payment_type_id": 5, "amount_paid": 50000},
                {"payment_type_id": 6, "amount_paid": 70000},
            ],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["amount_paid"] == 120000
    assert data["balance_due"] == 0
    assert data["is_fully_paid"] is True
    assert len(data["payments"]) == 2
    assert data["payments"][0]["payment_type_id"] == 5
    assert data["payments"][0]["amount_paid"] == 50000
    assert data["payments"][1]["payment_type_id"] == 6
    assert data["payments"][1]["amount_paid"] == 70000
    assert data["payments"][1]["payment_amount"] == 5.56

    payment_calls = [
        call[0][3]
        for call in mock_regos.call_args_list
        if call[0][2] == "docpayment/add"
    ]
    assert len(payment_calls) == 2
    assert payment_calls[0]["type_id"] == 5
    assert payment_calls[0]["amount"] == 50000
    assert payment_calls[0]["description"] == "1001"
    assert payment_calls[1]["type_id"] == 6
    assert payment_calls[1]["amount"] == 5.56
    assert payment_calls[1]["description"] == "1001"


@patch(
    "app.services.regos_sales.regos_defaults_service.get_doc_wholesale_document_type_id",
    new_callable=AsyncMock,
)
@patch("app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_checkout_amount_paid_exceeds_total_returns_400(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID

    reg = await register_owner(client, email="checkout-overpay@test.com", company_name="Overpay Co")
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
            "amount_paid": 150,
        },
    )
    assert response.status_code == 400
    assert response.json()["code"] == "CHECKOUT_AMOUNT_PAID_EXCEEDS_TOTAL"
    mock_regos.assert_not_called()


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
    "app.services.regos_sales.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
)
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
    mock_payment_type: AsyncMock,
    client: AsyncClient,
) -> None:
    from app.core.exceptions import AppError

    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
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
        json={"login": "cashier", "password": "employee123"},
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


@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_list_wholesale_return_documents(mock_regos: AsyncMock, client: AsyncClient) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 2001,
                "code": "WRT-2001",
                "date": 1717000000,
                "amount": 5000,
                "performed": True,
                "description": "pulse:ws:1001|Damaged goods",
                "partner": {"id": 33, "name": "Walk-in"},
                "stock": {"id": 11, "name": "Main warehouse"},
            }
        ],
        "next_offset": 0,
        "total": 1,
    }

    reg = await register_owner(client, email="returns-list@test.com", company_name="Returns Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.get("/api/v1/sales/wholesale-return-documents", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["documents"][0]["code"] == "WRT-2001"
    assert data["documents"][0]["wholesale_doc_id"] == 1001
    assert data["documents"][0]["reason"] == "Damaged goods"

    payload = mock_regos.call_args[0][3]
    assert payload["performed"] is True
    assert mock_regos.call_args[0][2] == "docwholesalereturn/get"


@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_wholesale_return_summary(mock_regos: AsyncMock, client: AsyncClient) -> None:
    mock_regos.side_effect = [
        {
            "ok": True,
            "result": [
                {
                    "id": 2001,
                    "code": "WRT-2001",
                    "date": 1717000000,
                    "amount": 5000,
                    "performed": True,
                    "description": "pulse:ws:1001",
                    "partner": {"id": 33, "name": "Walk-in"},
                    "stock": {"id": 11, "name": "Main warehouse"},
                }
            ],
            "next_offset": 0,
            "total": 1,
        },
        {
            "ok": True,
            "result": [
                {
                    "id": 6001,
                    "document_id": 2001,
                    "quantity": 1,
                    "price": 5000,
                    "item": {"id": 101, "name": "Cola"},
                }
            ],
        },
    ]

    reg = await register_owner(client, email="returns-summary@test.com", company_name="Summary Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.get(
        "/api/v1/sales/wholesale-documents/1001/return-summary",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["wholesale_doc_id"] == 1001
    assert data["items"] == [{"item_id": 101, "returned_qty": 1}]


@patch(
    "app.services.regos_sales.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_sales.regos_defaults_service.get_doc_wholesale_return_document_type_id",
    new_callable=AsyncMock,
)
@patch("app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_create_wholesale_return(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_return_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_return_doc_type_id.return_value = DOC_WHOLESALE_RETURN_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_regos.side_effect = [
        {
            "ok": True,
            "result": [
                {
                    "id": 5001,
                    "document_id": 1001,
                    "quantity": 2,
                    "price": 10000,
                    "price2": 10000,
                    "item": {"id": 101, "name": "Cola"},
                }
            ],
        },
        {"ok": True, "result": [], "next_offset": 0, "total": 0},
        {"ok": True, "result": {"new_id": 2001, "code": "WRT-2001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 6001}]},
        {"ok": True, "result": {}},
        {"ok": True, "result": {"code": "WRT-2001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(client, email="returns-create@test.com", company_name="Create Return Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/wholesale-returns",
        headers=headers,
        json={
            "wholesale_doc_id": 1001,
            "items": [{"regos_item_id": 101, "qty": 1}],
            "total": 10000,
            "reason": "Customer changed mind",
            "payment_type_id": 5,
            "amount_paid": 10000,
            "partner_id": 33,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["wholesale_return_doc_id"] == 2001
    assert data["wholesale_return_code"] == "WRT-2001"
    assert data["wholesale_doc_id"] == 1001
    assert data["total"] == 10000
    assert data["payment_doc_id"] == 3001
    assert data["amount_paid"] == 10000
    assert data["is_fully_paid"] is True

    calls = [call[0][2] for call in mock_regos.call_args_list]
    assert calls == [
        "wholesaleoperation/get",
        "docwholesalereturn/get",
        "docwholesalereturn/add",
        "docwholesalereturn/lock",
        "wholesalereturnoperation/add",
        "docwholesalereturn/unlock",
        "docwholesalereturn/perform",
        "docpayment/add",
        "docpayment/perform",
    ]

    add_payload = mock_regos.call_args_list[2][0][3]
    assert add_payload["description"] == "pulse:ws:1001|Customer changed mind"

    payment_payload = mock_regos.call_args_list[7][0][3]
    assert payment_payload["document"] == 2001
    assert payment_payload["document_type_id"] == DOC_WHOLESALE_RETURN_TYPE_ID
    assert payment_payload["amount"] == 10000


PAYMENT_TYPE_DEBT = {
    "id": 7,
    "name": "On account",
    "is_cash": False,
    "allows_debt": True,
    "image_url": "",
    "currency": {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1},
}


async def _mock_payment_type_with_debt(_session, _company_id, payment_type_id: int) -> dict:
    if payment_type_id == PAYMENT_TYPE_DEBT["id"]:
        return PAYMENT_TYPE_DEBT
    return await _mock_payment_type_by_id(_session, _company_id, payment_type_id)


@patch(
    "app.services.regos_sales.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_sales.regos_defaults_service.get_doc_wholesale_return_document_type_id",
    new_callable=AsyncMock,
)
@patch("app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_create_manual_wholesale_return(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_return_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_return_doc_type_id.return_value = DOC_WHOLESALE_RETURN_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 2001, "code": "WRT-2001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 6001}]},
        {"ok": True, "result": {}},
        {"ok": True, "result": {"code": "WRT-2001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(client, email="manual-return@test.com", company_name="Manual Return Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/wholesale-returns",
        headers=headers,
        json={
            "items": [{"regos_item_id": 101, "qty": 2, "price": 5000}],
            "total": 10000,
            "payment_type_id": 5,
            "amount_paid": 10000,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["wholesale_return_doc_id"] == 2001
    assert data["wholesale_doc_id"] is None
    assert data["total"] == 10000

    add_payload = mock_regos.call_args_list[0][0][3]
    assert add_payload["description"] == "pulse:manual"


@patch(
    "app.services.regos_sales.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_sales.regos_defaults_service.get_doc_wholesale_return_document_type_id",
    new_callable=AsyncMock,
)
@patch("app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_create_wholesale_return_deferred_refund(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_return_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_return_doc_type_id.return_value = DOC_WHOLESALE_RETURN_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_with_debt
    mock_regos.side_effect = [
        {
            "ok": True,
            "result": [
                {
                    "id": 5001,
                    "document_id": 1001,
                    "quantity": 2,
                    "price": 10000,
                    "price2": 10000,
                    "item": {"id": 101, "name": "Cola"},
                }
            ],
        },
        {"ok": True, "result": [], "next_offset": 0, "total": 0},
        {"ok": True, "result": {"new_id": 2001, "code": "WRT-2001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 6001}]},
        {"ok": True, "result": {}},
        {"ok": True, "result": {"code": "WRT-2001"}},
    ]

    reg = await register_owner(client, email="deferred-return@test.com", company_name="Deferred Return Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/wholesale-returns",
        headers=headers,
        json={
            "wholesale_doc_id": 1001,
            "items": [{"regos_item_id": 101, "qty": 1}],
            "total": 10000,
            "payment_type_id": 7,
            "amount_paid": 0,
            "partner_id": 33,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["amount_paid"] == 0
    assert data["balance_due"] == 10000
    assert data["is_fully_paid"] is False
    assert data["payment_doc_id"] is None

    calls = [call[0][2] for call in mock_regos.call_args_list]
    assert "docpayment/add" not in calls


@pytest.mark.asyncio
async def test_manual_return_requires_price(client: AsyncClient) -> None:
    reg = await register_owner(client, email="manual-price@test.com", company_name="Manual Price Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/wholesale-returns",
        headers=headers,
        json={
            "items": [{"regos_item_id": 101, "qty": 1}],
            "total": 10000,
            "payment_type_id": 5,
        },
    )
    assert response.status_code == 422
