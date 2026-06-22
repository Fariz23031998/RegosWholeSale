from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from helpers import register_owner

FULL_DEFAULTS = {
    "warehouse": {"id": 1, "name": "Main"},
    "price_type": {"id": 2, "name": "Retail"},
    "partner": {"id": 3, "name": "Walk-in"},
    "currency": {"id": 4, "name": "UZS"},
    "firm": {"id": 5, "name": "Firm"},
    "payment_category": {"id": 6, "name": "Cash"},
    "attached_user": {"id": 7, "name": "Cashier"},
    "zero_quantity": False,
    "zero_price": False,
}


@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_user_regos_defaults_fallback_to_company(
    mock_regos: AsyncMock, client: AsyncClient
) -> None:
    mock_regos.side_effect = [
        {"result": [{"id": 1, "name": "Main", "firm": {"id": 5, "name": "Firm"}}]},
        {"result": [{"id": 2, "name": "Retail", "currency": {"id": 4, "name": "UZS"}}]},
        {"result": [{"id": 10, "name": "Alt WH", "firm": {"id": 50, "name": "Alt Firm"}}]},
        {"result": [{"id": 20, "name": "Alt PT", "currency": {"id": 40, "name": "USD"}}]},
        {"result": [{"id": 10, "name": "Alt WH", "firm": {"id": 50, "name": "Alt Firm"}}]},
        {"result": [{"id": 20, "name": "Alt PT", "currency": {"id": 40, "name": "USD"}}]},
        {"result": [{"id": 1, "name": "Main", "firm": {"id": 5, "name": "Firm"}}]},
        {"result": [{"id": 2, "name": "Retail", "currency": {"id": 4, "name": "UZS"}}]},
    ]

    reg = await register_owner(client, email="user-regos@test.com", company_name="User Regos Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    owner_id = reg.json()["user"]["id"]

    await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={"settings": {"regos_defaults": FULL_DEFAULTS}},
    )

    initial = await client.get(f"/api/v1/users/{owner_id}/settings/regos-defaults", headers=headers)
    assert initial.status_code == 200
    assert initial.json()["defaults"]["warehouse"]["id"] == 1
    assert initial.json()["defaults"]["partner"]["id"] == 3

    patched = await client.patch(
        f"/api/v1/users/{owner_id}/settings/regos-defaults",
        headers=headers,
        json={"warehouse_id": 10, "price_type_id": 20},
    )
    assert patched.status_code == 200
    assert patched.json()["defaults"]["warehouse"]["id"] == 10
    assert patched.json()["defaults"]["price_type"]["id"] == 20
    assert patched.json()["defaults"]["partner"]["id"] == 3

    cleared = await client.delete(
        f"/api/v1/users/{owner_id}/settings/regos-defaults", headers=headers
    )
    assert cleared.status_code == 200
    assert cleared.json()["defaults"]["warehouse"]["id"] == 1
    assert cleared.json()["defaults"]["price_type"]["id"] == 2
