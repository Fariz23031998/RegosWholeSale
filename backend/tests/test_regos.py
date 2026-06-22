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
    assert token_config.json()["token"] == REGOS_TOKEN
    assert token_config.json()["configured"] is True


@pytest.mark.asyncio
async def test_employee_cannot_manage_regos_token(client: AsyncClient) -> None:
    reg = await register_owner(client, email="regos-emp@test.com", company_name="Emp Co")
    owner_token = reg.json()["access_token"]
    company_slug = reg.json()["user"]["company"]["slug"]

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
        json={"company_slug": company_slug, "login": "cashier", "password": "employee123"},
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
    assert data["next_offset"] == 0

    call_args = mock_regos.call_args
    assert call_args[0][2] == "item/getext"
    assert call_args[0][3]["stock_id"] == 11
    assert call_args[0][3]["price_type_id"] == 22
    assert call_args[0][3]["offset"] == 3
    assert call_args[0][3]["limit"] == 25
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
            },
            {
                "id": 2,
                "name": "Uzcard",
                "is_cash": False,
                "enabled": "backoffice",
                "image_url": "",
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
    assert data["payment_types"][1]["id"] == 2
    assert data["payment_types"][1]["is_cash"] is False

    mock_regos.assert_called_once()
    call_args = mock_regos.call_args
    assert call_args[0][2] == "paymenttype/get"
    assert call_args[0][3] == {}


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
        {"ok": True, "result": []},
    ]

    options = await regos_defaults_service.list_reference_options(None, 1)

    assert options["payment_categories"][0]["name"] == "Sales income"
    payment_call = next(
        call
        for call in mock_regos.call_args_list
        if call[0][2] == "accountoperationcategory/get"
    )
    assert payment_call[0][3]["positive"] is True


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
async def test_attached_user_reference_request_uses_valid_user_get_fields(
    mock_regos: AsyncMock,
) -> None:
    mock_regos.side_effect = [
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
        "attached_users": [{"id": 5, "name": "Cashier"}],
    }

    reg = await register_owner(client, email="opts@test.com", company_name="Opts Co")
    owner_token = reg.json()["access_token"]
    company_slug = reg.json()["user"]["company"]["slug"]

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
        json={"company_slug": company_slug, "login": "cashier2", "password": "employee123"},
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
    company_slug = reg.json()["user"]["company"]["slug"]
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
        json={"company_slug": company_slug, "login": "cashier3", "password": "employee123"},
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
