from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from helpers import register_owner

REGOS_TOKEN = "a" * 32
REGOS_EDIT_OK = {"ok": True, "result": {}}

PAYMENT_LINKING_WRITE_TESTS = {
    "test_checkout_document_description_mode_links_payments",
    "test_wholesale_return_document_description_mode_links_payments",
}


@pytest.fixture(autouse=True)
def noop_payment_linking_unless_testing_link_writes(request, monkeypatch):
    if request.node.name in PAYMENT_LINKING_WRITE_TESTS:
        yield
        return

    mock_link = AsyncMock(return_value=None)
    monkeypatch.setattr(
        "app.services.regos_sales.regos_payment_linking_service.link_payments_to_source_document",
        mock_link,
    )
    mock_settings = AsyncMock(
        return_value={
            "mode": "sale_id_field",
            "sale_id_field_configured": False,
            "sale_id_field": None,
        }
    )
    monkeypatch.setattr(
        "app.services.regos_sales.regos_payment_linking_service.get_payment_linking_settings",
        mock_settings,
    )
    yield

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

ENRICHED_DEFAULTS_USD = {
    **ENRICHED_DEFAULTS,
    "currency": {"id": 2, "name": "US Dollar", "code_chr": "USD", "exchange_rate": 12600},
}

PAYMENT_TYPE_UZS = {
    "id": 5,
    "name": "Cash",
    "is_cash": True,
    "allows_debt": False,
    "image_url": "",
    "account_id": 101,
    "currency": {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1},
}

PAYMENT_TYPE_USD = {
    "id": 6,
    "name": "Dollars",
    "is_cash": True,
    "allows_debt": False,
    "image_url": "",
    "account_id": 102,
    "currency": {"id": 2, "name": "US Dollar", "code_chr": "USD", "exchange_rate": 12600},
}

USD_PRICE_TYPE = {
    "id": 77,
    "name": "Wholesale USD",
    "currency": PAYMENT_TYPE_USD["currency"],
}

DOC_WHOLESALE_TYPE_ID = 77
DOC_WHOLESALE_RETURN_TYPE_ID = 88


async def _mock_payment_type_by_id(_session, _company_id, payment_type_id: int) -> dict:
    if payment_type_id == PAYMENT_TYPE_USD["id"]:
        return PAYMENT_TYPE_USD
    return PAYMENT_TYPE_UZS


async def _mock_usd_price_type_for_currency(_session, _company_id, currency_id: int) -> dict | None:
    if currency_id == PAYMENT_TYPE_USD["currency"]["id"]:
        return USD_PRICE_TYPE
    return None


async def _configure_checkout_defaults(client: AsyncClient, headers: dict) -> None:
    await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={"settings": {"regos_defaults": FULL_DEFAULTS}},
    )


async def _configure_sale_currency_transfer_mode(client: AsyncClient, headers: dict) -> None:
    await client.patch(
        "/api/v1/company/settings/pos",
        headers=headers,
        json={"cross_currency_payment_mode": "sale_currency_transfer"},
    )


async def _mock_find_payment_type_for_currency(
    _session,
    _company_id,
    *,
    currency_id: int,
    is_cash: bool,
) -> dict | None:
    if currency_id == PAYMENT_TYPE_UZS["currency"]["id"] and is_cash:
        return PAYMENT_TYPE_UZS
    return None


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
        REGOS_EDIT_OK,
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
        "docwholesale/edit",
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
    assert ops_payload[0]["price"] == 10000
    assert ops_payload[0]["price2"] == 10000

    unlock_payload = mock_regos.call_args_list[3][0][3]
    assert unlock_payload == {"ids": [1001]}

    payment_payload = mock_regos.call_args_list[6][0][3]
    assert payment_payload["document"] == 1001
    assert payment_payload["type_id"] == 5
    assert payment_payload["amount"] == 20000
    assert payment_payload["exchange_rate"] == 1
    assert payment_payload["description"] == "1001"
    assert payment_payload["firm_id"] == 55
    assert payment_payload["category_id"] == 66
    assert payment_payload["document_type_id"] == DOC_WHOLESALE_TYPE_ID


@patch("app.services.regos_sales.time.time", return_value=1_700_000_000)
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
async def test_checkout_coordinates_document_dates(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    _mock_time: AsyncMock,
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
        REGOS_EDIT_OK,
        {"ok": True, "result": {"code": "WS-1001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(
        client, email="checkout-dates@test.com", company_name="Checkout Dates Co"
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/checkout",
        headers=headers,
        json={
            "items": [{"regos_item_id": 101, "qty": 1, "price": 10000}],
            "discount": 0,
            "payment_type_id": 5,
            "total": 10000,
        },
    )
    assert response.status_code == 200

    date_edit_payload = next(
        call[0][3]
        for call in mock_regos.call_args_list
        if call[0][2] == "docwholesale/edit"
    )
    assert date_edit_payload == {"id": 1001, "date": 1_700_000_000}

    payment_payload = next(
        call[0][3]
        for call in mock_regos.call_args_list
        if call[0][2] == "docpayment/add"
    )
    assert payment_payload["date"] == 1_700_000_001


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
async def test_checkout_foreign_currency_puts_actual_price_in_price(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS_USD
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001, "code": "WS-1001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
        REGOS_EDIT_OK,
        {"ok": True, "result": {"code": "WS-1001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(client, email="checkout-usd@test.com", company_name="USD Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/checkout",
        headers=headers,
        json={
            "items": [{"regos_item_id": 101, "qty": 1, "price": 10}],
            "discount": 1,
            "payment_type_id": 5,
            "total": 9,
        },
    )
    assert response.status_code == 200

    ops_payload = mock_regos.call_args_list[2][0][3]
    assert ops_payload[0]["price"] == 9
    assert ops_payload[0]["price2"] == 10

    add_payload = mock_regos.call_args_list[0][0][3]
    assert add_payload["exchange_rate"] == 12600


@patch("app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_postpone_sale_creates_unperformed_document(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001, "code": "WS-1001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(client, email="postpone@test.com", company_name="Postpone Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/postpone",
        headers=headers,
        json={
            "items": [{"regos_item_id": 101, "qty": 2, "price": 10000}],
            "discount": 0,
            "total": 20000,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["wholesale_doc_id"] == 1001
    assert data["wholesale_code"] == "1001"
    assert data["total"] == 20000

    calls = [call[0][2] for call in mock_regos.call_args_list]
    assert calls == [
        "docwholesale/add",
        "docwholesale/lock",
        "wholesaleoperation/add",
        "docwholesale/unlock",
    ]
    assert "docwholesale/perform" not in calls


@patch("app.services.regos_sales.regos_defaults_service.get_regos_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_list_unperformed_wholesale_documents(
    mock_regos: AsyncMock,
    mock_defaults: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_defaults.return_value = FULL_DEFAULTS
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 501,
                "code": "WS-501",
                "date": 1_700_000_000,
                "performed": False,
                "amount": 15000,
                "partner": {"id": 33, "name": "Walk-in"},
                "stock": {"id": 11, "name": "Main warehouse"},
            }
        ],
        "next_offset": 0,
        "total": 1,
    }

    reg = await register_owner(client, email="unperformed@test.com", company_name="Unperformed Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.get(
        "/api/v1/sales/wholesale-documents?performed=false",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["documents"][0]["id"] == 501
    assert data["documents"][0]["performed"] is False

    payload = mock_regos.call_args[0][3]
    assert payload["performed"] is False


@patch("app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults", new_callable=AsyncMock)
@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_postpone_sale_updates_existing_document(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_regos.side_effect = [
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"id": 9001, "document_id": 1001, "item_id": 101, "quantity": 1, "price": 10000}]},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2002}]},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(client, email="postpone-update@test.com", company_name="Postpone Update Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/postpone",
        headers=headers,
        json={
            "items": [{"regos_item_id": 101, "qty": 3, "price": 10000}],
            "discount": 0,
            "total": 30000,
            "wholesale_doc_id": 1001,
        },
    )
    assert response.status_code == 200
    assert response.json()["wholesale_doc_id"] == 1001

    calls = [call[0][2] for call in mock_regos.call_args_list]
    assert calls == [
        "docwholesale/lock",
        "wholesaleoperation/get",
        "wholesaleoperation/edit",
        "docwholesale/unlock",
    ]


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
async def test_checkout_with_existing_wholesale_doc_id(
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
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"id": 9001, "document_id": 1001, "item_id": 101, "quantity": 1, "price": 10000, "price2": 10000}]},
        {"ok": True, "result": {}},
        {"ok": True, "result": {}},
        REGOS_EDIT_OK,
        {"ok": True, "result": {"code": "WS-1001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(client, email="checkout-continue@test.com", company_name="Continue Co")
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
            "wholesale_doc_id": 1001,
        },
    )
    assert response.status_code == 200
    assert response.json()["wholesale_doc_id"] == 1001

    calls = [call[0][2] for call in mock_regos.call_args_list]
    assert calls[0] == "docwholesale/lock"
    assert calls[1] == "wholesaleoperation/get"
    assert "docwholesale/add" not in calls
    assert "docwholesale/perform" in calls


@patch(
    "app.services.regos_sales.regos_payment_linking_service.get_payment_linking_settings",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_sales.regos_fields_service.build_doc_payment_sale_id_fields",
    new_callable=AsyncMock,
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
async def test_checkout_sets_sale_id_field_on_payment(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    mock_sale_id_fields: AsyncMock,
    mock_linking_settings: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_sale_id_fields.return_value = [{"key": "field_sale_id", "value": "1001"}]
    mock_linking_settings.return_value = {
        "mode": "sale_id_field",
        "sale_id_field_configured": True,
        "sale_id_field": {"id": 1, "key": "field_sale_id", "name": "Sale ID", "entity_type": "DocPayment", "data_type": "string"},
    }
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001, "code": "WS-1001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
        REGOS_EDIT_OK,
        {"ok": True, "result": {"code": "WS-1001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(client, email="checkout-field@test.com", company_name="Checkout Field Co")
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

    payment_payload = mock_regos.call_args_list[6][0][3]
    assert payment_payload["fields"] == [{"key": "field_sale_id", "value": "1001"}]
    mock_sale_id_fields.assert_awaited_once()
    assert mock_sale_id_fields.await_args.kwargs["source_document_id"] == 1001


@patch(
    "app.services.regos_sales.regos_payment_linking_service.get_payment_linking_settings",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_sales.regos_fields_service.build_doc_payment_sale_id_fields",
    new_callable=AsyncMock,
)
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
async def test_wholesale_return_sets_sale_id_field_on_payment(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_return_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    mock_sale_id_fields: AsyncMock,
    mock_linking_settings: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_return_doc_type_id.return_value = DOC_WHOLESALE_RETURN_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_sale_id_fields.return_value = [{"key": "field_sale_id", "value": "2001"}]
    mock_linking_settings.return_value = {
        "mode": "sale_id_field",
        "sale_id_field_configured": True,
        "sale_id_field": {"id": 1, "key": "field_sale_id", "name": "Sale ID", "entity_type": "DocPayment", "data_type": "string"},
    }
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
        REGOS_EDIT_OK,
        {"ok": True, "result": {"code": "WRT-2001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(
        client, email="return-field@test.com", company_name="Return Field Co"
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.post(
        "/api/v1/sales/wholesale-returns",
        headers=headers,
        json={
            "wholesale_doc_id": 1001,
            "items": [{"regos_item_id": 101, "qty": 1}],
            "total": 10000,
            "payment_type_id": 5,
            "amount_paid": 10000,
        },
    )
    assert response.status_code == 200

    payment_payload = mock_regos.call_args_list[8][0][3]
    assert payment_payload["document"] == 2001
    assert payment_payload["fields"] == [{"key": "field_sale_id", "value": "2001"}]
    mock_sale_id_fields.assert_awaited_once()
    assert mock_sale_id_fields.await_args.kwargs["source_document_id"] == 2001


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
        REGOS_EDIT_OK,
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

    payment_payload = mock_regos.call_args_list[6][0][3]
    assert payment_payload["amount"] == 8000
    assert payment_payload["exchange_rate"] == 1


@patch(
    "app.services.regos_sales.regos_defaults_service.find_price_type_for_currency",
    new_callable=AsyncMock,
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
async def test_checkout_converts_payment_to_payment_currency(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    mock_find_price_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_find_price_type.return_value = USD_PRICE_TYPE
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001, "code": "WS-1001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
        REGOS_EDIT_OK,
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

    payment_payload = mock_regos.call_args_list[6][0][3]
    assert payment_payload["type_id"] == 6
    assert payment_payload["amount"] == 9.52
    assert payment_payload["exchange_rate"] == 12600

    add_payload = mock_regos.call_args_list[0][0][3]
    assert add_payload["currency_id"] == 44
    assert add_payload["price_type_id"] == 22
    assert add_payload.get("exchange_rate", 1) == 1

    ops_payload = mock_regos.call_args_list[2][0][3]
    assert ops_payload[0]["price"] == 120000
    assert ops_payload[0]["price2"] == 120000


@patch(
    "app.services.regos_sales.regos_payment_types_service.find_payment_type_for_currency",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_sales.regos_defaults_service.find_price_type_for_currency",
    new_callable=AsyncMock,
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
async def test_checkout_sale_currency_transfer_mode(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    mock_find_price_type: AsyncMock,
    mock_find_payment_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_find_price_type.return_value = USD_PRICE_TYPE
    mock_find_payment_type.side_effect = _mock_find_payment_type_for_currency
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001, "code": "WS-1001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
        REGOS_EDIT_OK,
        {"ok": True, "result": {"code": "WS-1001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
        {"ok": True, "result": {"new_id": 4001}},
        {"ok": True, "result": {"row_affected": 1}},
    ]

    reg = await register_owner(client, email="checkout-transfer@test.com", company_name="Transfer Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)
    await _configure_sale_currency_transfer_mode(client, headers)

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
    assert data["payment"]["payment_amount"] == 9.52
    assert data["payment"]["payment_currency"]["code_chr"] == "USD"

    calls = [call[0][2] for call in mock_regos.call_args_list]
    assert calls[-3:] == [
        "docpayment/perform",
        "docaccountmovement/add",
        "docaccountmovement/perform",
    ]

    payment_payload = mock_regos.call_args_list[6][0][3]
    assert payment_payload["type_id"] == 5
    assert payment_payload["amount"] == 120000
    assert payment_payload["exchange_rate"] == 1

    transfer_payload = mock_regos.call_args_list[8][0][3]
    assert transfer_payload["account_sender_id"] == 101
    assert transfer_payload["account_receiver_id"] == 102
    assert transfer_payload["amount_sended"] == 120000
    assert transfer_payload["amount_received"] == 9.52
    assert transfer_payload["firm_id"] == 55

    perform_transfer_payload = mock_regos.call_args_list[9][0][3]
    assert perform_transfer_payload == {"id": 4001}


@patch(
    "app.services.regos_sales.regos_defaults_service.find_price_type_for_currency",
    new_callable=AsyncMock,
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
async def test_checkout_partial_payment_converts_to_payment_currency(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    mock_find_price_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_find_price_type.side_effect = _mock_usd_price_type_for_currency
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001, "code": "WS-1001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
        REGOS_EDIT_OK,
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

    payment_payload = mock_regos.call_args_list[6][0][3]
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
        REGOS_EDIT_OK,
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
        REGOS_EDIT_OK,
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
        REGOS_EDIT_OK,
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
                "attached_user": {"id": 7, "full_name": "Cashier One"},
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
    assert data["documents"][0]["attached_user_id"] == 7
    assert data["documents"][0]["attached_user_name"] == "Cashier One"

    payload = mock_regos.call_args[0][3]
    assert payload["start_date"] == 1716000000
    assert "partner_ids" not in payload
    assert "stock_ids" not in payload


@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_list_wholesale_documents_filters_by_partner_ids(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [],
        "next_offset": 0,
        "total": 0,
    }

    reg = await register_owner(client, email="sales-partners@test.com", company_name="Sales Partners Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)

    response = await client.get(
        "/api/v1/sales/wholesale-documents",
        headers=headers,
        params={
            "start_date": 1716000000,
            "end_date": 1718000000,
            "all_partners": "false",
            "partner_ids": [33, 44],
        },
    )
    assert response.status_code == 200
    payload = mock_regos.call_args[0][3]
    assert payload["partner_ids"] == [33, 44]


@patch(
    "app.services.regos_payment_linking.regos_fields_service.get_doc_payment_sale_id_field_status",
    new_callable=AsyncMock,
)
@patch("app.services.regos_payment_linking.fetch_document", new_callable=AsyncMock)
@patch("app.services.regos_payment_linking.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_list_wholesale_document_payments_without_link_returns_empty(
    mock_regos: AsyncMock,
    mock_fetch_document: AsyncMock,
    mock_sale_id_status: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_fetch_document.return_value = {"id": 1001, "description": "POS note"}
    mock_sale_id_status.return_value = {"configured": False, "field": None, "created": False}

    reg = await register_owner(client, email="sales-payments@test.com", company_name="Sales Pay Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.get(
        "/api/v1/sales/wholesale-documents/1001/payments",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["payments"] == []
    mock_regos.assert_not_awaited()


@patch(
    "app.services.regos_payment_linking.regos_fields_service.get_doc_payment_sale_id_field_key",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_payment_linking.get_payment_linking_settings",
    new_callable=AsyncMock,
)
@patch("app.services.regos_payment_linking.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_list_wholesale_document_payments_filters_by_sale_id_field(
    mock_regos: AsyncMock,
    mock_linking_settings: AsyncMock,
    mock_sale_id_field_key: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_linking_settings.return_value = {
        "mode": "sale_id_field",
        "sale_id_field_configured": True,
        "sale_id_field": {"id": 1, "key": "field_sale_id", "name": "Sale ID", "entity_type": "DocPayment", "data_type": "string"},
    }
    mock_sale_id_field_key.return_value = "field_sale_id"
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 3001,
                "code": "PAY-3001",
                "date": 1717000100,
                "amount": 25000,
                "type": {"id": 5, "name": "Cash"},
                "partner": {"id": 33, "name": "Walk-in"},
                "category": {"id": 66, "name": "Sales"},
            }
        ],
    }

    reg = await register_owner(
        client, email="sales-payments-filter@test.com", company_name="Sales Pay Filter Co"
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.get(
        "/api/v1/sales/wholesale-documents/1001/payments",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["payments"]) == 1

    payment_payload = mock_regos.call_args[0][3]
    assert payment_payload["filters"] == [
        {"field": "field_sale_id", "operator": "Equal", "value": "1001"}
    ]
    assert "document" not in payment_payload
    assert "document_type_id" not in payment_payload


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
                "item": {"id": 101, "name": "Cola", "code": "COLA-001"},
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
    assert data["operations"][0]["item_code"] == "COLA-001"
    assert data["operations"][0]["item_name"] == "Cola"
    assert data["operations"][0]["quantity"] == 2
    assert data["operations"][0]["item"]["articul"] is None

    payload = mock_regos.call_args[0][3]
    assert payload["document_ids"] == [1001]


@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_list_wholesale_operations_includes_item_details(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 5001,
                "document_id": 1001,
                "quantity": 2,
                "price": 10000,
                "item": {
                    "id": 101,
                    "name": "Cola",
                    "fullname": "Cola 0.5L",
                    "description": "Sparkling drink",
                    "articul": "SKU-101",
                    "base_barcode": "4601234567890",
                    "package_code": "PKG-101",
                    "icps": "1234567890123",
                    "color": {"name": "Red"},
                    "size": {"name": "0.5L"},
                    "producer": {"name": "Cola Co"},
                    "country": {"name": "Uzbekistan"},
                    "department": {"name": "Beverages"},
                    "vat": {"name": "VAT 12%", "value": 12},
                },
            }
        ],
    }

    reg = await register_owner(client, email="sales-item@test.com", company_name="Sales Item Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.get(
        "/api/v1/sales/wholesale-documents/1001/operations",
        headers=headers,
    )
    assert response.status_code == 200
    item = response.json()["operations"][0]["item"]
    assert item["fullname"] == "Cola 0.5L"
    assert item["articul"] == "SKU-101"
    assert item["color"]["name"] == "Red"
    assert item["vat"]["value"] == 12
    assert item["base_barcode"] == "4601234567890"

    payload = mock_regos.call_args[0][3]
    assert payload["document_ids"] == [1001]


@patch("app.services.regos_sales.regos_batch_request_chunks_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_list_wholesale_operations_batch(mock_batch: AsyncMock, client: AsyncClient) -> None:
    mock_batch.return_value = {
        "doc_1001": {
            "ok": True,
            "result": [
                {
                    "id": 5001,
                    "document_id": 1001,
                    "quantity": 2,
                    "price": 10000,
                    "item": {"id": 101, "name": "Cola"},
                },
            ],
        },
        "doc_1002": {
            "ok": True,
            "result": [
                {
                    "id": 5002,
                    "document_id": 1002,
                    "quantity": 1,
                    "price": 5000,
                    "item": {"id": 102, "name": "Chips"},
                },
            ],
        },
    }

    reg = await register_owner(client, email="sales-batch@test.com", company_name="Sales Batch Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.get(
        "/api/v1/sales/wholesale-operations",
        headers=headers,
        params=[("document_ids", 1001), ("document_ids", 1002)],
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["operations"]) == 2
    assert mock_batch.call_count == 1

    steps = mock_batch.await_args.args[2]
    assert len(steps) == 2
    assert all(step["path"] == "wholesaleoperation/get" for step in steps)
    assert sorted(step["payload"]["document_ids"][0] for step in steps) == [1001, 1002]


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
                "attached_user": {"id": 7, "full_name": "Cashier One"},
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
    assert data["documents"][0]["attached_user_id"] == 7
    assert data["documents"][0]["attached_user_name"] == "Cashier One"

    payload = mock_regos.call_args[0][3]
    assert payload["performed"] is True
    assert mock_regos.call_args[0][2] == "docwholesalereturn/get"


@patch("app.services.regos_sales.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_list_wholesale_return_operations(mock_regos: AsyncMock, client: AsyncClient) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 6001,
                "document_id": 2001,
                "quantity": 1,
                "price": 5000,
                "item": {"id": 101, "name": "Cola", "code": "COLA-001"},
            }
        ],
    }

    reg = await register_owner(client, email="returns-ops@test.com", company_name="Returns Ops Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.get(
        "/api/v1/sales/wholesale-return-documents/2001/operations",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["operations"][0]["item_code"] == "COLA-001"
    assert data["operations"][0]["item_name"] == "Cola"

    payload = mock_regos.call_args[0][3]
    assert payload["document_ids"] == [2001]
    assert mock_regos.call_args[0][2] == "wholesalereturnoperation/get"


@patch(
    "app.services.regos_payment_linking.regos_fields_service.get_doc_payment_sale_id_field_status",
    new_callable=AsyncMock,
)
@patch("app.services.regos_payment_linking.fetch_document", new_callable=AsyncMock)
@patch("app.services.regos_payment_linking.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_list_wholesale_return_document_payments_without_link_returns_empty(
    mock_regos: AsyncMock,
    mock_fetch_document: AsyncMock,
    mock_sale_id_status: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_fetch_document.return_value = {
        "id": 2001,
        "description": "pulse:ws:1001|Damaged goods",
    }
    mock_sale_id_status.return_value = {"configured": False, "field": None, "created": False}

    reg = await register_owner(
        client, email="returns-payments@test.com", company_name="Returns Pay Co"
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.get(
        "/api/v1/sales/wholesale-return-documents/2001/payments",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["payments"] == []
    mock_regos.assert_not_awaited()


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
        REGOS_EDIT_OK,
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
        "docwholesalereturn/edit",
        "docwholesalereturn/perform",
        "docpayment/add",
        "docpayment/perform",
    ]

    add_payload = mock_regos.call_args_list[2][0][3]
    assert add_payload["description"] == "pulse:ws:1001|Customer changed mind"

    payment_payload = mock_regos.call_args_list[8][0][3]
    assert payment_payload["document"] == 2001
    assert payment_payload["document_type_id"] == DOC_WHOLESALE_RETURN_TYPE_ID
    assert payment_payload["amount"] == 10000


@patch(
    "app.services.regos_sales.regos_payment_types_service.find_payment_type_for_currency",
    new_callable=AsyncMock,
)
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
async def test_wholesale_return_sale_currency_transfer_mode(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_return_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    mock_find_payment_type: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_return_doc_type_id.return_value = DOC_WHOLESALE_RETURN_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_find_payment_type.side_effect = _mock_find_payment_type_for_currency
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
        REGOS_EDIT_OK,
        {"ok": True, "result": {"code": "WRT-2001"}},
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {}},
        {"ok": True, "result": {"new_id": 4001}},
        {"ok": True, "result": {"row_affected": 1}},
    ]

    reg = await register_owner(
        client, email="returns-transfer@test.com", company_name="Return Transfer Co"
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_checkout_defaults(client, headers)
    await _configure_sale_currency_transfer_mode(client, headers)

    response = await client.post(
        "/api/v1/sales/wholesale-returns",
        headers=headers,
        json={
            "wholesale_doc_id": 1001,
            "items": [{"regos_item_id": 101, "qty": 1}],
            "total": 10000,
            "reason": "Customer changed mind",
            "payment_type_id": 6,
            "amount_paid": 10000,
            "partner_id": 33,
        },
    )
    assert response.status_code == 200

    calls = [call[0][2] for call in mock_regos.call_args_list]
    assert calls[-3:] == [
        "docpayment/perform",
        "docaccountmovement/add",
        "docaccountmovement/perform",
    ]

    payment_payload = mock_regos.call_args_list[8][0][3]
    assert payment_payload["type_id"] == 5
    assert payment_payload["amount"] == 10000
    assert payment_payload["exchange_rate"] == 1

    transfer_payload = mock_regos.call_args_list[10][0][3]
    assert transfer_payload["account_sender_id"] == 102
    assert transfer_payload["account_receiver_id"] == 101
    assert transfer_payload["amount_sended"] == 0.79
    assert transfer_payload["amount_received"] == 10000


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
        REGOS_EDIT_OK,
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
        REGOS_EDIT_OK,
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


@patch("app.services.regos_payment_linking.regos_async_api_request_for_company", new_callable=AsyncMock)
@patch("app.services.regos_payment_linking.fetch_document", new_callable=AsyncMock)
@patch(
    "app.services.regos_payment_linking.regos_fields_service.get_doc_payment_sale_id_field_status",
    new_callable=AsyncMock,
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
async def test_checkout_document_description_mode_links_payments(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    mock_sale_id_status: AsyncMock,
    mock_fetch_document: AsyncMock,
    mock_linking_regos: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_doc_type_id.return_value = DOC_WHOLESALE_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_sale_id_status.return_value = {"configured": False, "field": None, "created": False}
    mock_fetch_document.return_value = {"id": 1001, "description": "POS John"}
    mock_linking_regos.return_value = {"ok": True, "result": {"row_affected": 1}}
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 1001, "code": "WS-1001"}},
        {"ok": True, "result": {}},
        {"ok": True, "result": [{"new_id": 2001}]},
        {"ok": True, "result": {}},
        REGOS_EDIT_OK,
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {"code": "WS-1001"}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(
        client, email="checkout-desc-link@test.com", company_name="Checkout Desc Link Co"
    )
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

    sales_calls = [call[0][2] for call in mock_regos.call_args_list]
    assert sales_calls == [
        "docwholesale/add",
        "docwholesale/lock",
        "wholesaleoperation/add",
        "docwholesale/unlock",
        "docwholesale/edit",
        "docpayment/add",
        "docwholesale/perform",
        "docpayment/perform",
    ]
    assert "fields" not in mock_regos.call_args_list[5][0][3]

    edit_calls = [
        call for call in mock_linking_regos.await_args_list if call.args[2] == "docwholesale/edit"
    ]
    assert len(edit_calls) == 1
    assert edit_calls[0].args[3] == {
        "id": 1001,
        "description": "POS John|pulse:pay:3001",
    }


@patch("app.services.regos_payment_linking.regos_async_api_request_for_company", new_callable=AsyncMock)
@patch("app.services.regos_payment_linking.fetch_document", new_callable=AsyncMock)
@patch(
    "app.services.regos_payment_linking.regos_fields_service.get_doc_payment_sale_id_field_status",
    new_callable=AsyncMock,
)
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
async def test_wholesale_return_document_description_mode_links_payments(
    mock_regos: AsyncMock,
    mock_enriched: AsyncMock,
    mock_return_doc_type_id: AsyncMock,
    mock_payment_type: AsyncMock,
    mock_sale_id_status: AsyncMock,
    mock_fetch_document: AsyncMock,
    mock_linking_regos: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_enriched.return_value = ENRICHED_DEFAULTS
    mock_return_doc_type_id.return_value = DOC_WHOLESALE_RETURN_TYPE_ID
    mock_payment_type.side_effect = _mock_payment_type_by_id
    mock_sale_id_status.return_value = {"configured": False, "field": None, "created": False}
    mock_fetch_document.return_value = {
        "id": 2001,
        "description": "pulse:ws:1001|Customer changed mind",
    }
    mock_linking_regos.return_value = {"ok": True, "result": {"row_affected": 1}}
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
        REGOS_EDIT_OK,
        {"ok": True, "result": {"new_id": 3001}},
        {"ok": True, "result": {"code": "WRT-2001"}},
        {"ok": True, "result": {}},
    ]

    reg = await register_owner(
        client, email="return-desc-link@test.com", company_name="Return Desc Link Co"
    )
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
        },
    )
    assert response.status_code == 200

    sales_calls = [call[0][2] for call in mock_regos.call_args_list]
    assert "docpayment/add" in sales_calls
    assert sales_calls.index("docpayment/add") < sales_calls.index("docwholesalereturn/perform")
    assert sales_calls.index("docwholesalereturn/perform") < sales_calls.index("docpayment/perform")

    edit_calls = [
        call
        for call in mock_linking_regos.await_args_list
        if call.args[2] == "docwholesalereturn/edit"
    ]
    assert len(edit_calls) == 1
    assert edit_calls[0].args[3] == {
        "id": 2001,
        "description": "pulse:ws:1001|Customer changed mind|pulse:pay:3001",
    }


@patch(
    "app.services.regos_payment_linking.get_payment_linking_settings",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_payment_linking.regos_fields_service.get_doc_payment_sale_id_field_status",
    new_callable=AsyncMock,
)
@patch("app.services.regos_payment_linking.fetch_document", new_callable=AsyncMock)
@patch("app.services.regos_payment_linking.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_list_wholesale_document_payments_by_description_ids(
    mock_regos: AsyncMock,
    mock_fetch_document: AsyncMock,
    mock_sale_id_status: AsyncMock,
    mock_linking_settings: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_linking_settings.return_value = {
        "mode": "document_description",
        "sale_id_field_configured": False,
        "sale_id_field": None,
    }
    mock_sale_id_status.return_value = {"configured": False, "field": None, "created": False}
    mock_fetch_document.return_value = {
        "id": 1001,
        "description": "POS John|pulse:pay:3001,3002",
    }
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 3001,
                "code": "PAY-3001",
                "date": 1717000100,
                "amount": 25000,
                "type": {"id": 5, "name": "Cash"},
                "partner": {"id": 33, "name": "Walk-in"},
                "category": {"id": 66, "name": "Sales"},
            }
        ],
    }

    reg = await register_owner(
        client, email="sales-payments-desc@test.com", company_name="Sales Pay Desc Co"
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.get(
        "/api/v1/sales/wholesale-documents/1001/payments",
        headers=headers,
    )
    assert response.status_code == 200
    assert len(response.json()["payments"]) == 1

    payment_payload = mock_regos.call_args[0][3]
    assert payment_payload["ids"] == [3001, 3002]
