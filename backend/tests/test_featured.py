import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock, patch

from helpers import register_owner

REGOS_TOKEN = "b" * 32


async def _configure_regos_defaults(client: AsyncClient, token: str) -> None:
    response = await client.patch(
        "/api/v1/company/settings",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "settings": {
                "regos_defaults": {
                    "warehouse": {"id": 11, "name": "Main warehouse"},
                    "price_type": {"id": 22, "name": "Retail"},
                }
            }
        },
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_featured_products_crud(client: AsyncClient) -> None:
    reg = await register_owner(client, email="featured@test.com", company_name="Featured Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    empty = await client.get("/api/v1/me/featured-products", headers=headers)
    assert empty.status_code == 200
    assert empty.json()["product_ids"] == []

    add = await client.put("/api/v1/me/featured-products/101", headers=headers)
    assert add.status_code == 200
    assert add.json()["featured"] is True
    assert add.json()["product_ids"] == [101]

    add_again = await client.put("/api/v1/me/featured-products/101", headers=headers)
    assert add_again.status_code == 200
    assert add_again.json()["product_ids"] == [101]

    add_second = await client.put("/api/v1/me/featured-products/202", headers=headers)
    assert add_second.status_code == 200
    assert add_second.json()["product_ids"] == [202, 101]

    listed = await client.get("/api/v1/me/featured-products", headers=headers)
    assert listed.json()["product_ids"] == [202, 101]

    remove = await client.delete("/api/v1/me/featured-products/101", headers=headers)
    assert remove.status_code == 200
    assert remove.json()["featured"] is False
    assert remove.json()["product_ids"] == [202]


@patch("app.services.regos_products.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_products_featured_only_uses_saved_ids(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "item": {"id": 202, "name": "Tea", "articul": "SKU-202", "group": {"name": "Drinks"}},
                "quantity": {"allowed": 4},
                "price": 15000,
            },
            {
                "item": {"id": 101, "name": "Cola", "articul": "SKU-101", "group": {"name": "Drinks"}},
                "quantity": {"allowed": 7},
                "price": 22000,
            },
        ],
        "next_offset": 0,
        "total": 2,
    }

    reg = await register_owner(client, email="featured-products@test.com", company_name="Featured Products Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await _configure_regos_defaults(client, token)

    await client.put("/api/v1/me/featured-products/101", headers=headers)
    await client.put("/api/v1/me/featured-products/202", headers=headers)

    response = await client.get(
        "/api/v1/regos/products",
        headers=headers,
        params={"featured_only": True, "limit": 20, "offset": 0},
    )
    assert response.status_code == 200
    data = response.json()
    assert [item["id"] for item in data["products"]] == ["202", "101"]
    assert data["total"] == 2

    call_args = mock_regos.call_args
    assert call_args[0][2] == "item/getext"
    assert call_args[0][3]["ids"] == [202, 101]


@pytest.mark.asyncio
async def test_featured_products_require_auth(client: AsyncClient) -> None:
    response = await client.get("/api/v1/me/featured-products")
    assert response.status_code == 401
