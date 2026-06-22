import pytest
from httpx import AsyncClient

from helpers import register_owner


@pytest.mark.asyncio
async def test_manager_can_configure_user_pos_settings(client: AsyncClient) -> None:
    reg = await register_owner(client, email="mgr-pos@test.com", company_name="Mgr POS Co")
    owner_token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {owner_token}"}

    await client.patch(
        "/api/v1/company/settings/pos",
        headers=headers,
        json={"allow_out_of_stock": True, "tendered_quick_amounts": [100.0, 200.0]},
    )

    await client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "login": "cashier",
            "password": "employee123",
            "display_name": "Cashier",
            "role": "employee",
        },
    )

    users = await client.get("/api/v1/users", headers=headers)
    employee_id = next(u["id"] for u in users.json() if u["login"] == "cashier")

    initial = await client.get(f"/api/v1/users/{employee_id}/settings/pos", headers=headers)
    assert initial.status_code == 200
    assert initial.json()["settings"]["allow_out_of_stock"] is True
    assert initial.json()["settings"]["tendered_quick_amounts"] == [100.0, 200.0]

    patched = await client.patch(
        f"/api/v1/users/{employee_id}/settings/pos",
        headers=headers,
        json={
            "allow_out_of_stock": False,
            "tendered_quick_amounts": [10.0, 20.0],
            "default_category": {"mode": "featured", "group_id": None},
        },
    )
    assert patched.status_code == 200
    assert patched.json()["settings"]["allow_out_of_stock"] is False
    assert patched.json()["settings"]["tendered_quick_amounts"] == [10.0, 20.0]
    assert patched.json()["settings"]["default_category"]["mode"] == "featured"

    cleared = await client.delete(f"/api/v1/users/{employee_id}/settings/pos", headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["settings"]["allow_out_of_stock"] is True
    assert cleared.json()["settings"]["tendered_quick_amounts"] == [100.0, 200.0]

    emp_login = await client.post(
        "/api/v1/auth/login",
        json={"login": "cashier", "password": "employee123"},
    )
    emp_headers = {"Authorization": f"Bearer {emp_login.json()['access_token']}"}

    denied = await client.patch(
        f"/api/v1/users/{employee_id}/settings/pos",
        headers=emp_headers,
        json={"allow_out_of_stock": False},
    )
    assert denied.status_code == 403
