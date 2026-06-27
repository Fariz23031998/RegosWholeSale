from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from helpers import TEST_VERIFICATION_CODE, register_owner
from app.services import regos_defaults as regos_defaults_service

REGOS_TOKEN = "a" * 32


@pytest.mark.asyncio
async def test_upsert_and_status_regos_token(client: AsyncClient) -> None:
    reg = await register_owner(client, email="regos-owner@test.com", company_name="Regos Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    status_before = await client.get("/api/v1/regos/tokens/status", headers=headers)
    assert status_before.status_code == 200
    assert status_before.json()["configured"] is False

    upsert = await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )
    assert upsert.status_code == 200

    status_after = await client.get("/api/v1/regos/tokens/status", headers=headers)
    assert status_after.json()["configured"] is True
    assert status_after.json()["is_replicable"] is False

    token_config = await client.get("/api/v1/regos/tokens", headers=headers)
    assert token_config.status_code == 200
    assert "token" not in token_config.json()
    assert token_config.json()["token_masked"].endswith(REGOS_TOKEN[-4:])
    assert token_config.json()["configured"] is True


@pytest.mark.asyncio
async def test_upsert_regos_token_from_integration_url(client: AsyncClient) -> None:
    reg = await register_owner(
        client,
        email="regos-url-owner@test.com",
        company_name="Regos URL Co",
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    integration_url = f"https://integration.regos.uz/gateway/out/{REGOS_TOKEN}"
    upsert = await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": integration_url, "is_replicable": False},
    )
    assert upsert.status_code == 200

    token_config = await client.get("/api/v1/regos/tokens", headers=headers)
    assert token_config.status_code == 200
    assert token_config.json()["configured"] is True
    assert token_config.json()["token_masked"].endswith(REGOS_TOKEN[-4:])


@pytest.mark.asyncio
async def test_employee_cannot_manage_regos_token(client: AsyncClient) -> None:
    reg = await register_owner(client, email="regos-emp@test.com", company_name="Emp Co")
    owner_token = reg.json()["access_token"]

    await client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {owner_token}"},
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
    emp_token = emp_login.json()["access_token"]

    denied = await client.put(
        "/api/v1/regos/tokens",
        headers={"Authorization": f"Bearer {emp_token}"},
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_proxy_without_token_returns_404(client: AsyncClient) -> None:
    reg = await register_owner(client, email="proxy-none@test.com", company_name="No Token Co")
    token = reg.json()["access_token"]

    response = await client.post(
        "/api/v1/regos/proxy/Item/Get",
        headers={"Authorization": f"Bearer {token}"},
        json={},
    )
    assert response.status_code == 404
    assert response.json()["code"] == "REGOS_TOKEN_NOT_CONFIGURED"


@patch("app.api.v1.regos.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_proxy_forwards_request(mock_regos: AsyncMock, client: AsyncClient) -> None:
    mock_regos.return_value = {"ok": True, "result": [{"id": 1, "name": "Item"}]}

    reg = await register_owner(client, email="proxy-ok@test.com", company_name="Proxy Co")
    owner_token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {owner_token}"}

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )

    response = await client.post(
        "/api/v1/regos/proxy/Item/Get",
        headers=headers,
        json={"deleted_mark": False},
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True
    mock_regos.assert_called_once()
    call_args = mock_regos.call_args
    assert call_args[0][2] == "Item/Get"
    assert call_args[0][3] == {"deleted_mark": False}


@patch("app.services.regos_products.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_products_use_default_warehouse_and_price_type(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "item": {
                    "id": 101,
                    "name": "Cola",
                    "articul": "SKU-101",
                    "code": "COLA-101",
                    "base_barcode": "4601234567890",
                    "unit": {"name": "piece", "type": "pcs"},
                    "group": {"name": "Beverages"},
                },
                "quantity": {"allowed": 7},
                "price": 22000,
                "image_url": "https://cdn.example.test/item.png",
            }
        ],
        "next_offset": 1,
        "total": 1,
    }

    reg = await register_owner(client, email="products@test.com", company_name="Products Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    patch = await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={
            "settings": {
                "regos_defaults": {
                    "warehouse": {"id": 11, "name": "Main warehouse"},
                    "price_type": {"id": 22, "name": "Retail"},
                }
            }
        },
    )
    assert patch.status_code == 200

    response = await client.get(
        "/api/v1/regos/products",
        headers=headers,
        params={"offset": 3, "limit": 25, "search": "cola"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["products"][0]["id"] == "101"
    assert data["products"][0]["stock"] == 7
    assert data["products"][0]["category"] == "Beverages"
    assert data["products"][0]["code"] == "COLA-101"
    assert data["products"][0]["articul"] == "SKU-101"
    assert data["products"][0]["barcode"] == "4601234567890"
    assert data["products"][0]["unit_name"] == "piece"
    assert data["products"][0]["unit_type"] == 1
    assert data["next_offset"] == 0

    call_args = mock_regos.call_args
    assert call_args[0][2] == "item/getext"
    assert call_args[0][3]["stock_id"] == 11
    assert call_args[0][3]["price_type_id"] == 22
    assert call_args[0][3]["offset"] == 3
    assert call_args[0][3]["limit"] == 60
    assert call_args[0][3]["search"] == "cola"
    assert call_args[0][3]["zero_quantity"] is False
    assert call_args[0][3]["zero_price"] is False


@patch("app.services.regos_groups.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_product_groups_route_returns_regos_groups(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {"id": 2, "parent_id": 1, "name": "Snacks", "path": "Food/Snacks", "child_count": 0},
            {"id": 1, "parent_id": None, "name": "Food", "path": "Food", "child_count": 1},
        ],
    }

    reg = await register_owner(client, email="groups@test.com", company_name="Groups Co")
    token = reg.json()["access_token"]
    response = await client.get(
        "/api/v1/regos/product-groups",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["groups"][0]["name"] == "Food"
    assert data["groups"][1]["path"] == "Food/Snacks"


@patch("app.services.regos_payment_types.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_payment_types_route_returns_regos_payment_types(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 1,
                "name": "Наличные",
                "is_cash": True,
                "enabled": "True",
                "image_url": "https://cdn.regos.uz/cash.png",
                "account": {
                    "id": 10,
                    "name": "Cash account",
                    "currency": {
                        "id": 44,
                        "name": "UZS",
                        "code_chr": "UZS",
                        "exchange_rate": 1,
                    },
                },
            },
            {
                "id": 2,
                "name": "Uzcard",
                "is_cash": False,
                "enabled": "backoffice",
                "image_url": "",
                "account": {
                    "id": 11,
                    "name": "Card account",
                    "currency": {
                        "id": 2,
                        "name": "US Dollar",
                        "code_chr": "USD",
                        "exchange_rate": 12600,
                    },
                },
            },
            {
                "id": 3,
                "name": "POS only",
                "is_cash": False,
                "enabled": 2,
            },
            {
                "id": 4,
                "name": "Disabled",
                "is_cash": False,
                "enabled": False,
            },
        ],
    }

    reg = await register_owner(client, email="payments@test.com", company_name="Payments Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )

    response = await client.get("/api/v1/regos/payment-types", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data["payment_types"]) == 2
    assert data["payment_types"][0]["id"] == 1
    assert data["payment_types"][0]["name"] == "Наличные"
    assert data["payment_types"][0]["is_cash"] is True
    assert data["payment_types"][0]["account_id"] == 10
    assert data["payment_types"][0]["currency"]["code_chr"] == "UZS"
    assert data["payment_types"][1]["id"] == 2
    assert data["payment_types"][1]["is_cash"] is False
    assert data["payment_types"][1]["account_id"] == 11
    assert data["payment_types"][1]["currency"]["code_chr"] == "USD"

    mock_regos.assert_called_once()
    call_args = mock_regos.call_args
    assert call_args[0][2] == "paymenttype/get"
    assert call_args[0][3] == {}


@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@patch("app.services.regos_payment_types.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_payment_types_enrich_missing_currency_exchange_rates(
    mock_payment_regos: AsyncMock,
    mock_currency_regos: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_payment_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 7,
                "name": "Rubl",
                "is_cash": True,
                "enabled": True,
                "image_url": "",
                "account": {
                    "id": 12,
                    "name": "RUB account",
                    "currency": {
                        "id": 3,
                        "name": "Rubl",
                        "code_chr": "R",
                    },
                },
            },
        ],
    }
    mock_currency_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 3,
                "name": "Rubl",
                "code_chr": "R",
                "exchange_rate": 160.53,
            },
        ],
    }

    reg = await register_owner(client, email="payments-fx@test.com", company_name="Payments FX Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )

    response = await client.get("/api/v1/regos/payment-types", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data["payment_types"]) == 1
    assert data["payment_types"][0]["currency"]["code_chr"] == "R"
    assert data["payment_types"][0]["currency"]["exchange_rate"] == 160.53

    mock_payment_regos.assert_called_once()
    assert mock_payment_regos.call_args[0][2] == "paymenttype/get"
    mock_currency_regos.assert_called_once()
    assert mock_currency_regos.call_args[0][2] == "currency/get"
    assert mock_currency_regos.call_args[0][3] == {"ids": [3]}


@patch("app.services.regos_partners.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_partners_route_lists_and_searches(mock_regos: AsyncMock, client: AsyncClient) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 1,
                "name": "Walk-in",
                "legal_status": "Natural",
                "phones": "+998901112233",
                "inn": "123456789",
                "group": {"id": 2, "name": "Buyers"},
                "deleted_mark": False,
            }
        ],
        "next_offset": 1,
        "total": 1,
    }

    reg = await register_owner(client, email="partners@test.com", company_name="Partners Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )

    response = await client.get(
        "/api/v1/regos/partners",
        headers=headers,
        params={"search": "walk"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["partners"][0]["id"] == 1
    assert data["partners"][0]["name"] == "Walk-in"
    assert data["partners"][0]["group_id"] == 2
    assert data["partners"][0]["group_name"] == "Buyers"

    mock_regos.assert_called_once()
    assert mock_regos.call_args[0][2] == "partner/get"
    assert mock_regos.call_args[0][3]["search"] == "walk"
    assert mock_regos.call_args[0][3]["deleted_mark"] is False


@patch("app.services.regos_partners.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_partners_create_edit_delete_mark(mock_regos: AsyncMock, client: AsyncClient) -> None:
    mock_regos.side_effect = [
        {"ok": True, "result": {"new_id": 16}},
        {"ok": True, "result": {"row_affected": 1}},
        {"ok": True, "result": {"row_affected": 1}},
    ]

    reg = await register_owner(client, email="partners-crud@test.com", company_name="Partners CRUD Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )

    create = await client.post(
        "/api/v1/regos/partners",
        headers=headers,
        json={
            "group_id": 2,
            "legal_status": "Natural",
            "name": "Trade max",
            "phones": "90 567-123-23",
        },
    )
    assert create.status_code == 200
    assert create.json()["id"] == 16

    update = await client.patch(
        "/api/v1/regos/partners/16",
        headers=headers,
        json={"name": "Trade max updated"},
    )
    assert update.status_code == 200
    assert update.json()["row_affected"] == 1

    delete_mark = await client.post(
        "/api/v1/regos/partners/16/delete-mark",
        headers=headers,
    )
    assert delete_mark.status_code == 200
    assert delete_mark.json()["row_affected"] == 1

    assert mock_regos.call_args_list[0][0][2] == "partner/add"
    assert mock_regos.call_args_list[1][0][2] == "partner/edit"
    assert mock_regos.call_args_list[2][0][2] == "partner/deletemark"


@patch(
    "app.services.regos_partner_balance.regos_async_api_request_for_company",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_partner_balance_route(mock_regos: AsyncMock, client: AsyncClient) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 41,
                "date": 1581404315,
                "document_code": "2020-0000021",
                "document_id": 1,
                "start_amount": 0.0,
                "debit": 2558.0,
                "credit": 0.0,
                "currency": {
                    "id": 2,
                    "name": "Dollar",
                    "code_chr": "USD",
                    "exchange_rate": 12500.0,
                },
                "firm": {"id": 4, "name": "ROFEY TECHNOLOGIES"},
                "document_type": {"id": 9, "name": "Payments"},
            }
        ],
    }

    reg = await register_owner(client, email="partner-balance@test.com", company_name="Balance Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )

    response = await client.get(
        "/api/v1/regos/partners/7/balance",
        headers=headers,
        params={
            "start_date": 1735689600,
            "end_date": 1767225599,
            "firm_id": 4,
            "currency_id": 2,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data["rows"]) == 1
    row = data["rows"][0]
    assert row["document_code"] == "2020-0000021"
    assert row["debit"] == 2558.0
    assert row["end_amount"] == 2558.0
    assert row["currency"]["id"] == 2
    assert row["firm"]["name"] == "ROFEY TECHNOLOGIES"

    mock_regos.assert_called_once()
    assert mock_regos.call_args[0][2] == "partnerbalance/get"
    payload = mock_regos.call_args[0][3]
    assert payload["partner_id"] == 7
    assert payload["firm_id"] == 4
    assert payload["currency_id"] == 2

    mock_regos.reset_mock()
    mock_regos.return_value = {"ok": True, "result": []}

    base_response = await client.get(
        "/api/v1/regos/partners/7/balance",
        headers=headers,
        params={
            "start_date": 1735689600,
            "end_date": 1767225599,
            "in_base_currency": True,
        },
    )
    assert base_response.status_code == 200
    assert mock_regos.call_args[0][2] == "partnerbalance/getinbasecurrency"
    assert "currency_id" not in mock_regos.call_args[0][3]


def test_partner_balance_end_amount_formula() -> None:
    from app.services.regos_partner_balance import _map_balance_row

    shipment = _map_balance_row(
        {
            "id": 1,
            "date": 1,
            "start_amount": -2_468_910.91,
            "debit": 26_970.0,
            "credit": 0.0,
        }
    )
    assert shipment["end_amount"] == -2_441_940.91

    payment = _map_balance_row(
        {
            "id": 2,
            "date": 2,
            "start_amount": -2_441_940.91,
            "debit": 0.0,
            "credit": 10_000.0,
            "document_code": "2026-0000160",
        }
    )
    assert payment["end_amount"] == -2_451_940.91


@patch("app.services.regos_firms.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_firms_route_lists_enterprises(mock_regos: AsyncMock, client: AsyncClient) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {"id": 1, "name": "REGOS", "deleted_mark": False},
            {"id": 4, "name": "ROFEY TECHNOLOGIES", "deleted_mark": False},
        ],
    }

    reg = await register_owner(client, email="firms@test.com", company_name="Firms Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )

    response = await client.get("/api/v1/regos/firms", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data["firms"]) == 2
    assert data["firms"][0]["name"] == "REGOS"
    assert data["firms"][1]["id"] == 4

    mock_regos.assert_called_once()
    assert mock_regos.call_args[0][2] == "firm/get"
    assert mock_regos.call_args[0][3]["deleted_mark"] is False


@patch("app.services.regos_products.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_products_route_passes_group_id(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.return_value = {"ok": True, "result": [], "next_offset": 0, "total": 0}

    reg = await register_owner(client, email="products-group@test.com", company_name="Products Group Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={
            "settings": {
                "regos_defaults": {
                    "warehouse": {"id": 11, "name": "Main warehouse"},
                    "price_type": {"id": 22, "name": "Retail"},
                }
            }
        },
    )

    response = await client.get(
        "/api/v1/regos/products",
        headers=headers,
        params={"group_id": 7},
    )
    assert response.status_code == 200
    assert mock_regos.call_args[0][3]["group_ids"] == [7]


@patch("app.services.regos_products.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_products_search_ignores_group_and_featured_filters(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.return_value = {"ok": True, "result": [], "next_offset": 0, "total": 0}

    reg = await register_owner(client, email="products-search@test.com", company_name="Search Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={
            "settings": {
                "regos_defaults": {
                    "warehouse": {"id": 11, "name": "Main warehouse"},
                    "price_type": {"id": 22, "name": "Retail"},
                }
            }
        },
    )

    response = await client.get(
        "/api/v1/regos/products",
        headers=headers,
        params={"group_id": 7, "featured_only": True, "search": "cola"},
    )
    assert response.status_code == 200

    payload = mock_regos.call_args[0][3]
    assert payload["search"] == "cola"
    assert "group_ids" not in payload
    assert "ids" not in payload


@patch("app.services.regos_products.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_products_search_single_hit_does_not_paginate(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "item": {
                    "id": 99,
                    "name": "Barcode item",
                    "articul": "SKU-99",
                    "group": {"id": 10, "name": "A"},
                },
                "quantity": {"allowed": 5},
                "price": 12000,
            }
        ],
        "next_offset": 0,
        "total": 500,
    }

    reg = await register_owner(client, email="products-search-hit@test.com", company_name="Search Hit Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={
            "settings": {
                "regos_defaults": {
                    "warehouse": {"id": 11, "name": "Main warehouse"},
                    "price_type": {"id": 22, "name": "Retail"},
                }
            }
        },
    )

    response = await client.get(
        "/api/v1/regos/products",
        headers=headers,
        params={"search": "4870249813251", "limit": 20, "offset": 0},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["products"]) == 1
    assert data["next_offset"] == 0
    assert data["total"] == 1
    assert mock_regos.await_count == 1


@patch("app.services.regos_products.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_products_route_filters_zero_quantity_when_disabled(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.side_effect = [
        {
            "ok": True,
            "result": [
                {
                    "item": {"id": 1, "name": "Zero stock", "articul": "SKU-1", "group": {"id": 10, "name": "A"}},
                    "quantity": {"allowed": 0},
                    "price": 12000,
                }
            ],
            "next_offset": 1,
            "total": 2,
        },
        {
            "ok": True,
            "result": [
                {
                    "item": {"id": 2, "name": "Available", "articul": "SKU-2", "group": {"id": 10, "name": "A"}},
                    "quantity": {"allowed": 5},
                    "price": 13000,
                }
            ],
            "next_offset": 0,
            "total": 2,
        },
    ]

    reg = await register_owner(client, email="products-filter@test.com", company_name="Products Filter Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={
            "settings": {
                "regos_defaults": {
                    "warehouse": {"id": 11, "name": "Main warehouse"},
                    "price_type": {"id": 22, "name": "Retail"},
                    "zero_quantity": False,
                    "zero_price": False,
                }
            }
        },
    )

    response = await client.get("/api/v1/regos/products", headers=headers, params={"limit": 1})
    assert response.status_code == 200
    data = response.json()
    assert [product["id"] for product in data["products"]] == ["2"]
    assert mock_regos.await_count == 2


@patch("app.services.regos_products.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_products_pagination_uses_regos_cursor_when_filters_skip_rows(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    def regos_page(_session, _company_id, _method, payload):
        offset = payload["offset"]
        if offset == 0:
            return {
                "ok": True,
                "result": [
                    {
                        "item": {"id": 1, "name": "Zero stock", "articul": "SKU-1", "group": {"id": 10, "name": "A"}},
                        "quantity": {"allowed": 0},
                        "price": 12000,
                    }
                ],
                "next_offset": 1,
                "total": 100,
            }
        if offset == 1:
            return {
                "ok": True,
                "result": [
                    {
                        "item": {"id": 2, "name": "Available", "articul": "SKU-2", "group": {"id": 10, "name": "A"}},
                        "quantity": {"allowed": 5},
                        "price": 13000,
                    }
                ],
                "next_offset": 2,
                "total": 100,
            }
        return {"ok": True, "result": [], "next_offset": 0, "total": 100}

    mock_regos.side_effect = regos_page

    reg = await register_owner(client, email="products-cursor@test.com", company_name="Products Cursor Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={
            "settings": {
                "regos_defaults": {
                    "warehouse": {"id": 11, "name": "Main warehouse"},
                    "price_type": {"id": 22, "name": "Retail"},
                    "zero_quantity": False,
                    "zero_price": False,
                }
            }
        },
    )

    first = await client.get("/api/v1/regos/products", headers=headers, params={"limit": 1, "offset": 0})
    assert first.status_code == 200
    first_data = first.json()
    assert [product["id"] for product in first_data["products"]] == ["2"]
    assert first_data["next_offset"] == 2

    second = await client.get(
        "/api/v1/regos/products",
        headers=headers,
        params={"limit": 1, "offset": first_data["next_offset"]},
    )
    assert second.status_code == 200
    second_data = second.json()
    assert second_data["products"] == []
    assert second_data["next_offset"] == 0


@patch("app.services.regos_products.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_products_keep_scanning_when_regos_omits_next_offset(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    """Regos sometimes returns next_offset=0 while more rows exist (common with zero_price on)."""

    def regos_page(_session, _company_id, _method, payload):
        offset = payload["offset"]
        if offset == 0:
            return {
                "ok": True,
                "result": [
                    {
                        "item": {"id": index, "name": f"Item {index}", "articul": f"SKU-{index}", "group": {"id": 10, "name": "A"}},
                        "quantity": {"allowed": 5},
                        "price": 0 if index % 2 == 0 else 1000,
                    }
                    for index in range(1, 11)
                ],
                "next_offset": 0,
                "total": 25,
            }
        if offset == 10:
            return {
                "ok": True,
                "result": [
                    {
                        "item": {"id": index, "name": f"Item {index}", "articul": f"SKU-{index}", "group": {"id": 10, "name": "A"}},
                        "quantity": {"allowed": 5},
                        "price": 0,
                    }
                    for index in range(11, 31)
                ],
                "next_offset": 0,
                "total": 25,
            }
        if offset == 20:
            return {
                "ok": True,
                "result": [
                    {
                        "item": {"id": index, "name": f"Item {index}", "articul": f"SKU-{index}", "group": {"id": 10, "name": "A"}},
                        "quantity": {"allowed": 5},
                        "price": 0,
                    }
                    for index in range(21, 26)
                ],
                "next_offset": 0,
                "total": 25,
            }
        return {"ok": True, "result": [], "next_offset": 0, "total": 25}

    mock_regos.side_effect = regos_page

    reg = await register_owner(client, email="products-stall@test.com", company_name="Products Stall Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={
            "settings": {
                "regos_defaults": {
                    "warehouse": {"id": 11, "name": "Main warehouse"},
                    "price_type": {"id": 22, "name": "Retail"},
                    "zero_quantity": True,
                    "zero_price": True,
                }
            }
        },
    )

    response = await client.get("/api/v1/regos/products", headers=headers, params={"limit": 20, "offset": 0})
    assert response.status_code == 200
    data = response.json()
    assert len(data["products"]) == 20
    assert data["next_offset"] == 20
    assert mock_regos.await_count >= 2

    second = await client.get(
        "/api/v1/regos/products",
        headers=headers,
        params={"limit": 20, "offset": data["next_offset"]},
    )
    assert second.status_code == 200
    second_data = second.json()
    assert len(second_data["products"]) == 5
    assert second_data["next_offset"] == 0


@patch("app.services.regos_products.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_products_partial_page_without_total_returns_scan_cursor(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    """Regos often omits total; client must still receive a cursor to continue."""

    def regos_page(_session, _company_id, _method, payload):
        offset = payload["offset"]
        if offset == 0:
            return {
                "ok": True,
                "result": [
                    {
                        "item": {"id": index, "name": f"Item {index}", "articul": f"SKU-{index}", "group": {"id": 10, "name": "A"}},
                        "quantity": {"allowed": 5},
                        "price": 0,
                    }
                    for index in range(1, 11)
                ],
                "next_offset": 0,
                "total": 0,
            }
        if offset == 10:
            return {
                "ok": True,
                "result": [
                    {
                        "item": {"id": index, "name": f"Item {index}", "articul": f"SKU-{index}", "group": {"id": 10, "name": "A"}},
                        "quantity": {"allowed": 5},
                        "price": 0,
                    }
                    for index in range(11, 21)
                ],
                "next_offset": 0,
                "total": 0,
            }
        return {"ok": True, "result": [], "next_offset": 0, "total": 0}

    mock_regos.side_effect = regos_page

    reg = await register_owner(client, email="products-no-total@test.com", company_name="No Total Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={
            "settings": {
                "regos_defaults": {
                    "warehouse": {"id": 11, "name": "Main warehouse"},
                    "price_type": {"id": 22, "name": "Retail"},
                    "zero_quantity": True,
                    "zero_price": True,
                }
            }
        },
    )

    response = await client.get("/api/v1/regos/products", headers=headers, params={"limit": 20, "offset": 0})
    assert response.status_code == 200
    data = response.json()
    assert len(data["products"]) == 20
    assert data["next_offset"] == 0
    assert mock_regos.await_count >= 2


@pytest.mark.asyncio
async def test_products_require_default_warehouse_and_price_type(client: AsyncClient) -> None:
    reg = await register_owner(client, email="products-missing@test.com", company_name="Missing Co")
    token = reg.json()["access_token"]

    response = await client.get(
        "/api/v1/regos/products",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "REGOS_DEFAULT_WAREHOUSE_NOT_CONFIGURED"


@patch("app.core.regos_oauth.regos_oauth_service.acquire_access_token", new_callable=AsyncMock)
@patch("app.core.regos_api.regos_async_api_request", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_replicable_token_sends_bearer(
    mock_api: AsyncMock,
    mock_oauth: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_oauth.return_value = "oauth-bearer-token"
    mock_api.return_value = {"ok": True, "result": []}

    with patch("app.services.regos_credentials.regos_oauth_configured", return_value=True):
        reg = await register_owner(
            client, email="repl@test.com", company_name="Repl Co"
        )
        headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

        await client.put(
            "/api/v1/regos/tokens",
            headers=headers,
            json={"token": REGOS_TOKEN, "is_replicable": True},
        )

        response = await client.post(
            "/api/v1/regos/proxy/User/Get",
            headers=headers,
            json={},
        )
    assert response.status_code == 200
    mock_oauth.assert_called()
    mock_api.assert_called_once()
    assert mock_api.call_args.kwargs["bearer_token"] == "oauth-bearer-token"


@pytest.mark.asyncio
async def test_delete_regos_token(client: AsyncClient) -> None:
    reg = await register_owner(client, email="del@test.com", company_name="Del Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )
    delete = await client.delete("/api/v1/regos/tokens", headers=headers)
    assert delete.status_code == 200

    status = await client.get("/api/v1/regos/tokens/status", headers=headers)
    assert status.json()["configured"] is False


@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_payment_category_reference_request_includes_positive(
    mock_regos: AsyncMock,
) -> None:
    mock_regos.side_effect = [
        {"ok": True, "result": []},
        {"ok": True, "result": []},
        {"ok": True, "result": []},
        {"ok": True, "result": [{"id": 1, "name": "Sales income", "positive": True}]},
        {"ok": True, "result": [{"id": 2, "name": "Sales refund", "positive": False}]},
        {"ok": True, "result": []},
    ]

    options = await regos_defaults_service.list_reference_options(None, 1)

    assert options["payment_categories"][0]["name"] == "Sales income"
    assert options["refund_payment_categories"][0]["name"] == "Sales refund"
    payment_calls = [
        call
        for call in mock_regos.call_args_list
        if call[0][2] == "accountoperationcategory/get"
    ]
    assert payment_calls[0][0][3]["positive"] is True
    assert payment_calls[1][0][3]["positive"] is False


@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_price_type_reference_options_include_currency(mock_regos: AsyncMock) -> None:
    mock_regos.side_effect = [
        {"ok": True, "result": []},
        {
            "ok": True,
            "result": [
                {
                    "id": 22,
                    "name": "Retail",
                    "currency": {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1},
                },
                {
                    "id": 23,
                    "name": "Wholesale USD",
                    "currency": {"id": 45, "name": "USD", "code_chr": "USD", "exchange_rate": 12500},
                },
            ],
        },
        {"ok": True, "result": []},
        {"ok": True, "result": []},
        {"ok": True, "result": []},
        {"ok": True, "result": []},
    ]

    options = await regos_defaults_service.list_reference_options(None, 1)

    assert options["price_types"][0]["currency"]["code_chr"] == "UZS"
    assert options["price_types"][1]["currency"]["exchange_rate"] == 12500


@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_get_doc_wholesale_document_type_id(mock_regos: AsyncMock) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [{"id": 26, "name": "Склад: Отгрузка контрагенту"}],
    }

    doc_type_id = await regos_defaults_service.get_doc_wholesale_document_type_id(None, 1)

    assert doc_type_id == 26
    mock_regos.assert_awaited_once_with(
        None,
        1,
        "documenttype/get",
        {"model": "DocWholeSale"},
    )


@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_get_doc_order_from_partner_default_status_id(mock_regos: AsyncMock) -> None:
    mock_regos.side_effect = [
        {"ok": True, "result": [{"id": 15, "name": "Заказ от контрагента"}]},
        {
            "ok": True,
            "result": [
                {"id": 3, "document_type_id": 15, "name": "В ожидании"},
            ],
        },
    ]

    status_id = await regos_defaults_service.get_doc_order_from_partner_default_status_id(
        None, 1
    )

    assert status_id == 3
    assert mock_regos.await_args_list[0].args[2] == "documenttype/get"
    assert mock_regos.await_args_list[1].args[2] == "documentstatus/get"
    assert mock_regos.await_args_list[1].args[3] == {"document_type_id": 15}


@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_get_doc_order_from_partner_default_status_id_falls_back_to_existing_document(
    mock_regos: AsyncMock,
) -> None:
    mock_regos.side_effect = [
        {"ok": True, "result": [{"id": 99, "name": "Склад: Поступление от контрагента"}]},
        {
            "ok": True,
            "result": [
                {"id": 99, "name": "Склад: Поступление от контрагента"},
                {"id": 15, "name": "Склад: Заказ от контрагента", "model": "DocOrderFromPartner"},
            ],
        },
        {"ok": True, "result": []},
        {
            "ok": True,
            "result": [
                {"id": 501, "status": {"id": 7, "name": "Новый"}},
            ],
        },
    ]

    status_id = await regos_defaults_service.get_doc_order_from_partner_default_status_id(
        None, 1
    )

    assert status_id == 7
    assert mock_regos.await_args_list[-1].args[2] == "docorderfrompartner/get"


@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_attached_user_reference_request_uses_valid_user_get_fields(
    mock_regos: AsyncMock,
) -> None:
    mock_regos.side_effect = [
        {"ok": True, "result": []},
        {"ok": True, "result": []},
        {"ok": True, "result": []},
        {"ok": True, "result": []},
        {"ok": True, "result": []},
        {"ok": True, "result": [{"id": 1, "full_name": "Cashier One"}]},
    ]

    options = await regos_defaults_service.list_reference_options(None, 1)

    assert options["attached_users"][0]["name"] == "Cashier One"
    user_call = next(
        call for call in mock_regos.call_args_list if call[0][2] == "user/get"
    )
    payload = user_call[0][3]
    assert payload["active"] is True
    assert "deleted_mark" not in payload
    assert payload["sort_orders"][0]["column"] == "FirstName"


@patch("app.api.v1.regos.regos_defaults_service.list_reference_options", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_get_regos_reference_options_requires_settings_manage(
    mock_options: AsyncMock, client: AsyncClient
) -> None:
    mock_options.return_value = {
        "warehouses": [{"id": 1, "name": "Main warehouse"}],
        "price_types": [{"id": 2, "name": "Retail"}],
        "partners": [{"id": 3, "name": "Walk-in"}],
        "payment_categories": [{"id": 4, "name": "Sales"}],
        "refund_payment_categories": [{"id": 6, "name": "Refund"}],
        "attached_users": [{"id": 5, "name": "Cashier"}],
    }

    reg = await register_owner(client, email="opts@test.com", company_name="Opts Co")
    owner_token = reg.json()["access_token"]

    await client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "login": "cashier2",
            "password": "employee123",
            "display_name": "Cashier",
            "role": "employee",
        },
    )

    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    allowed = await client.get("/api/v1/regos/reference-options", headers=owner_headers)
    assert allowed.status_code == 200
    assert allowed.json()["warehouses"][0]["name"] == "Main warehouse"

    emp_login = await client.post(
        "/api/v1/auth/login",
        json={"login": "cashier2", "password": "employee123"},
    )
    emp_headers = {"Authorization": f"Bearer {emp_login.json()['access_token']}"}
    denied = await client.get("/api/v1/regos/reference-options", headers=emp_headers)
    assert denied.status_code == 403


@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_patch_and_get_regos_defaults(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.side_effect = [
        {"ok": True, "result": [{"id": 11, "name": "Main warehouse", "firm": {"id": 55, "name": "Main firm"}}]},
        {"ok": True, "result": [{"id": 22, "name": "Retail", "currency": {"id": 44, "name": "UZS"}}]},
        {"ok": True, "result": [{"id": 33, "name": "Walk-in"}]},
        {"ok": True, "result": [{"id": 11, "name": "Main warehouse", "firm": {"id": 55, "name": "Main firm"}}]},
        {"ok": True, "result": [{"id": 22, "name": "Retail", "currency": {"id": 44, "name": "UZS"}}]},
    ]

    reg = await register_owner(client, email="defaults@test.com", company_name="Defaults Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    patched = await client.patch(
        "/api/v1/company/settings/regos-defaults",
        headers=headers,
        json={
            "warehouse_id": 11,
            "price_type_id": 22,
            "partner_id": 33,
            "zero_quantity": True,
            "zero_price": True,
        },
    )
    assert patched.status_code == 200
    assert patched.json()["defaults"]["warehouse"]["name"] == "Main warehouse"
    assert patched.json()["defaults"]["price_type"]["id"] == 22
    assert patched.json()["defaults"]["partner"]["id"] == 33
    assert patched.json()["defaults"]["currency"]["id"] == 44
    assert patched.json()["defaults"]["firm"]["id"] == 55
    assert patched.json()["defaults"]["zero_quantity"] is True
    assert patched.json()["defaults"]["zero_price"] is True
    assert patched.json()["defaults"]["vat_calculation_type"] == "Exclude"

    fetched = await client.get("/api/v1/company/settings/regos-defaults", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["defaults"]["warehouse"]["id"] == 11
    assert fetched.json()["defaults"]["partner"]["name"] == "Walk-in"
    assert fetched.json()["defaults"]["currency"]["name"] == "UZS"
    assert fetched.json()["defaults"]["firm"]["name"] == "Main firm"
    assert fetched.json()["defaults"]["zero_quantity"] is True
    assert fetched.json()["defaults"]["zero_price"] is True


@patch("app.services.regos_products.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_products_route_uses_zero_flags_from_defaults(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.return_value = {"ok": True, "result": [], "next_offset": 0, "total": 0}

    reg = await register_owner(client, email="products-zero@test.com", company_name="Products Zero Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    patched = await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={
            "settings": {
                "regos_defaults": {
                    "warehouse": {"id": 11, "name": "Main warehouse"},
                    "price_type": {"id": 22, "name": "Retail"},
                    "zero_quantity": True,
                    "zero_price": True,
                }
            }
        },
    )
    assert patched.status_code == 200

    response = await client.get("/api/v1/regos/products", headers=headers)
    assert response.status_code == 200
    payload = mock_regos.call_args[0][3]
    assert payload["zero_quantity"] is True
    assert payload["zero_price"] is True


@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_employee_can_read_but_not_update_regos_defaults(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.side_effect = [
        {"ok": True, "result": [{"id": 11, "name": "Main warehouse", "firm": {"id": 55, "name": "Main firm"}}]},
        {"ok": True, "result": [{"id": 22, "name": "Retail", "currency": {"id": 44, "name": "UZS"}}]},
        {"ok": True, "result": [{"id": 33, "name": "Walk-in"}]},
        {"ok": True, "result": [{"id": 11, "name": "Main warehouse", "firm": {"id": 55, "name": "Main firm"}}]},
        {"ok": True, "result": [{"id": 22, "name": "Retail", "currency": {"id": 44, "name": "UZS"}}]},
    ]

    reg = await register_owner(client, email="defaults-emp@test.com", company_name="Defaults Emp Co")
    owner_token = reg.json()["access_token"]
    owner_headers = {"Authorization": f"Bearer {owner_token}"}

    await client.patch(
        "/api/v1/company/settings/regos-defaults",
        headers=owner_headers,
        json={"warehouse_id": 11, "price_type_id": 22, "partner_id": 33},
    )

    await client.post(
        "/api/v1/users",
        headers=owner_headers,
        json={
            "login": "cashier3",
            "password": "employee123",
            "display_name": "Cashier",
            "role": "employee",
        },
    )
    emp_login = await client.post(
        "/api/v1/auth/login",
        json={"login": "cashier3", "password": "employee123"},
    )
    emp_headers = {"Authorization": f"Bearer {emp_login.json()['access_token']}"}

    fetched = await client.get("/api/v1/company/settings/regos-defaults", headers=emp_headers)
    assert fetched.status_code == 200
    assert fetched.json()["defaults"]["price_type"]["name"] == "Retail"

    denied = await client.patch(
        "/api/v1/company/settings/regos-defaults",
        headers=emp_headers,
        json={"partner_id": None},
    )
    assert denied.status_code == 403


@patch("app.services.regos_fields.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_get_doc_payment_sale_id_field_not_configured(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.return_value = {"ok": True, "result": []}

    reg = await register_owner(client, email="field-get@test.com", company_name="Field Get Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.get("/api/v1/regos/fields/doc-payment-sale-id", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is False
    assert data["field"] is None

    first_payload = mock_regos.call_args_list[0][0][3]
    assert first_payload["entity_type"] == "DocPayment"
    assert first_payload["keys"] == ["sale_id", "field_sale_id"]
    assert mock_regos.call_count == 2


@patch("app.services.regos_fields.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_get_doc_payment_sale_id_field_treats_tariff_error_as_unconfigured(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    from app.core.exceptions import AppError

    mock_regos.side_effect = AppError(
        400,
        "REGOS API error: 7501 - Ошибка тарифа: доступ к данному функционалу возможен только при улучшении тарифа. Подробнее: Работа с доп. полями",
        "REGOS_API_ERROR",
    )

    reg = await register_owner(client, email="field-tariff@test.com", company_name="Field Tariff Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.get("/api/v1/regos/fields/doc-payment-sale-id", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is False
    assert data["field"] is None


@patch("app.services.regos_fields.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_get_payment_linking_survives_custom_field_tariff_error(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    from app.core.exceptions import AppError

    mock_regos.side_effect = AppError(
        400,
        "REGOS API error: 7501 - Ошибка тарифа: доступ к данному функционалу возможен только при улучшении тарифа. Подробнее: Работа с доп. полями",
        "REGOS_API_ERROR",
    )

    reg = await register_owner(
        client, email="plink-tariff@test.com", company_name="PLink Tariff Co"
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.get("/api/v1/regos/payment-linking", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "document_description"
    assert data["sale_id_field_configured"] is False
    assert data["sale_id_field"] is None


@patch("app.services.regos_fields.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_create_doc_payment_sale_id_field(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.side_effect = [
        {"ok": True, "result": []},
        {"ok": True, "result": []},
        {"ok": True, "result": {"new_id": 201}},
        {
            "ok": True,
            "result": [
                {
                    "id": 201,
                    "key": "field_sale_id",
                    "name": "Sale ID",
                    "entity_type": "DocPayment",
                    "data_type": "string",
                }
            ],
        },
    ]

    reg = await register_owner(client, email="field-create@test.com", company_name="Field Create Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.post("/api/v1/regos/fields/doc-payment-sale-id", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is True
    assert data["created"] is True
    assert data["field"]["key"] == "field_sale_id"

    add_payload = mock_regos.call_args_list[2][0][3]
    assert add_payload == {
        "key": "sale_id",
        "name": "Sale ID",
        "entity_type": "DocPayment",
        "data_type": "string",
        "required": False,
    }


@patch("app.services.regos_fields.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_create_doc_payment_sale_id_field_when_key_already_exists(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    from app.core.exceptions import AppError

    existing_field = {
        "id": 201,
        "key": "field_sale_id",
        "name": "Sale ID",
        "entity_type": "DocPayment",
        "data_type": "string",
    }
    mock_regos.side_effect = [
        {"ok": True, "result": []},
        {"ok": True, "result": []},
        AppError(
            400,
            "REGOS API error: 1008 - Ошибка проверки входных данных: параметры указаны неверно. Подробнее: key exists in entyty_type DocPayment",
            "REGOS_API_ERROR",
        ),
        {"ok": True, "result": [existing_field]},
    ]

    reg = await register_owner(
        client, email="field-exists@test.com", company_name="Field Exists Co"
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.post("/api/v1/regos/fields/doc-payment-sale-id", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is True
    assert data["created"] is False
    assert data["field"]["key"] == "field_sale_id"


@patch(
    "app.services.regos_payment_linking.regos_fields_service.get_doc_payment_sale_id_field_status",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_get_payment_linking_defaults_to_document_description(
    mock_sale_id_status: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_sale_id_status.return_value = {"configured": False, "field": None, "created": False}

    reg = await register_owner(client, email="plink-get@test.com", company_name="PLink Get Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.get("/api/v1/regos/payment-linking", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "document_description"
    assert data["sale_id_field_configured"] is False


@patch(
    "app.services.regos_payment_linking.regos_fields_service.get_doc_payment_sale_id_field_status",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_patch_payment_linking_rejects_sale_id_field_without_field(
    mock_sale_id_status: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_sale_id_status.return_value = {"configured": False, "field": None, "created": False}

    reg = await register_owner(client, email="plink-patch@test.com", company_name="PLink Patch Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.patch(
        "/api/v1/regos/payment-linking",
        headers=headers,
        json={"mode": "sale_id_field"},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "PAYMENT_LINKING_SALE_ID_FIELD_REQUIRED"


@patch(
    "app.services.regos_payment_linking.regos_fields_service.get_doc_payment_sale_id_field_status",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_patch_payment_linking_sale_id_field_mode(
    mock_sale_id_status: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_sale_id_status.return_value = {
        "configured": True,
        "field": {
            "id": 901,
            "key": "field_sale_id",
            "name": "Sale ID",
            "entity_type": "DocPayment",
            "data_type": "string",
        },
        "created": False,
    }

    reg = await register_owner(client, email="plink-set@test.com", company_name="PLink Set Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    response = await client.patch(
        "/api/v1/regos/payment-linking",
        headers=headers,
        json={"mode": "sale_id_field"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "sale_id_field"
    assert data["sale_id_field_configured"] is True
    assert data["sale_id_field"]["key"] == "field_sale_id"
