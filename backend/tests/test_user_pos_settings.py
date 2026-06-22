import pytest
from httpx import AsyncClient

from helpers import register_owner


@pytest.mark.asyncio
async def test_user_pos_settings_default_category(client: AsyncClient) -> None:
    reg = await register_owner(client, email="user-pos@test.com", company_name="User POS Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    initial = await client.get("/api/v1/me/settings/pos", headers=headers)
    assert initial.status_code == 200
    assert initial.json()["settings"]["default_category"] == {
        "mode": "all",
        "group_id": None,
    }
    assert initial.json()["settings"]["allow_out_of_stock"] is False
    assert initial.json()["settings"]["auto_open_qty_keypad"] is False
    assert initial.json()["settings"]["tendered_quick_amounts"] == [20.0, 50.0, 100.0]

    patched = await client.patch(
        "/api/v1/me/settings/pos",
        headers=headers,
        json={"default_category": {"mode": "featured", "group_id": None}},
    )
    assert patched.status_code == 200
    assert patched.json()["settings"]["default_category"]["mode"] == "featured"

    group_patch = await client.patch(
        "/api/v1/me/settings/pos",
        headers=headers,
        json={"default_category": {"mode": "group", "group_id": 42}},
    )
    assert group_patch.status_code == 200
    assert group_patch.json()["settings"]["default_category"] == {
        "mode": "group",
        "group_id": 42,
    }

    invalid_group = await client.patch(
        "/api/v1/me/settings/pos",
        headers=headers,
        json={"default_category": {"mode": "group", "group_id": None}},
    )
    assert invalid_group.status_code == 200
    assert invalid_group.json()["settings"]["default_category"]["mode"] == "all"


@pytest.mark.asyncio
async def test_user_pos_settings_fallback_to_company(client: AsyncClient) -> None:
    reg = await register_owner(client, email="user-fallback@test.com", company_name="Fallback Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.patch(
        "/api/v1/company/settings/pos",
        headers=headers,
        json={
            "allow_out_of_stock": True,
            "auto_open_qty_keypad": True,
            "tendered_quick_amounts": [500.0, 1000.0],
        },
    )

    effective = await client.get("/api/v1/me/settings/pos", headers=headers)
    assert effective.status_code == 200
    assert effective.json()["settings"]["allow_out_of_stock"] is True
    assert effective.json()["settings"]["auto_open_qty_keypad"] is True
    assert effective.json()["settings"]["tendered_quick_amounts"] == [500.0, 1000.0]

    user_patch = await client.patch(
        "/api/v1/me/settings/pos",
        headers=headers,
        json={"allow_out_of_stock": False, "auto_open_qty_keypad": False},
    )
    assert user_patch.status_code == 200
    assert user_patch.json()["settings"]["allow_out_of_stock"] is False
    assert user_patch.json()["settings"]["auto_open_qty_keypad"] is False
    assert user_patch.json()["settings"]["tendered_quick_amounts"] == [500.0, 1000.0]

    user_amounts = await client.patch(
        "/api/v1/me/settings/pos",
        headers=headers,
        json={"tendered_quick_amounts": [10.0, 20.0]},
    )
    assert user_amounts.status_code == 200
    assert user_amounts.json()["settings"]["tendered_quick_amounts"] == [10.0, 20.0]
