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
