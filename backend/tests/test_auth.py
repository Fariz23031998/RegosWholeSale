import pytest
from httpx import AsyncClient

from helpers import TEST_VERIFICATION_CODE, register_owner


@pytest.mark.asyncio
async def test_register_and_login(client: AsyncClient) -> None:
    reg = await register_owner(
        client,
        email="owner@test.com",
        display_name="Owner User",
        company_name="Test Co",
    )
    assert reg.status_code == 200
    data = reg.json()
    assert data["access_token"]
    assert data["user"]["role"] == "owner"
    assert data["user"]["company"]["slug"] == "test-co"

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "owner@test.com", "password": "password123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "owner@test.com"
    assert "users.manage" in me.json()["permissions"]


@pytest.mark.asyncio
async def test_register_requires_verification_code(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "noverify@test.com",
            "password": "password123",
            "display_name": "Owner",
            "company_name": "No Verify Co",
            "verification_code": "000000",
        },
    )
    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_VERIFICATION_CODE"


@pytest.mark.asyncio
async def test_send_verification_code_register(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/send-verification-code",
        json={"email": "new@test.com", "type": "register"},
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    await register_owner(client, email="new@test.com", company_name="New Co")
    duplicate = await client.post(
        "/api/v1/auth/send-verification-code",
        json={"email": "new@test.com", "type": "register"},
    )
    assert duplicate.status_code == 400
    assert duplicate.json()["code"] == "EMAIL_EXISTS"


@pytest.mark.asyncio
async def test_reset_password_flow(client: AsyncClient) -> None:
    reg = await register_owner(client, email="reset@test.com", company_name="Reset Co")
    assert reg.status_code == 200

    send = await client.post(
        "/api/v1/auth/send-verification-code",
        json={"email": "reset@test.com", "type": "reset_password"},
    )
    assert send.status_code == 200

    reset = await client.post(
        "/api/v1/auth/reset-password",
        json={
            "email": "reset@test.com",
            "verification_code": TEST_VERIFICATION_CODE,
            "new_password": "newpassword99",
        },
    )
    assert reset.status_code == 200

    old_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "reset@test.com", "password": "password123"},
    )
    assert old_login.status_code == 401

    new_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "reset@test.com", "password": "newpassword99"},
    )
    assert new_login.status_code == 200


@pytest.mark.asyncio
async def test_create_employee_and_login(client: AsyncClient) -> None:
    reg = await register_owner(
        client,
        email="boss@test.com",
        display_name="Boss",
        company_name="Retail Inc",
    )
    owner_token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {owner_token}"}

    create = await client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "login": "alice",
            "password": "employee123",
            "display_name": "Alice",
            "role": "employee",
            "permission_rules": [
                {"code": "pos.access", "effect": "allow"},
                {"code": "sales.read", "effect": "allow"},
            ],
        },
    )
    assert create.status_code == 201

    emp_login = await client.post(
        "/api/v1/auth/login",
        json={
            "login": "alice",
            "password": "employee123",
        },
    )
    assert emp_login.status_code == 200
    assert emp_login.json()["user"]["login"] == "alice"


@pytest.mark.asyncio
async def test_login_schedule_blocks_outside_window(client: AsyncClient) -> None:
    from datetime import datetime, timezone
    from unittest.mock import patch

    reg = await register_owner(
        client,
        email="sched@test.com",
        display_name="Sched Owner",
        company_name="Sched Co",
    )
    owner_token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {owner_token}"}

    await client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "login": "bob",
            "password": "employee123",
            "display_name": "Bob",
            "role": "employee",
            "schedules": [{"day_of_week": 0, "start_time": "09:00", "end_time": "17:00"}],
        },
    )

    fake_now = datetime(2026, 5, 16, 20, 0, 0, tzinfo=timezone.utc)
    with patch("app.services.schedules.datetime") as mock_dt:
        mock_dt.now.return_value = fake_now
        blocked = await client.post(
            "/api/v1/auth/login",
            json={"login": "bob", "password": "employee123"},
        )
    assert blocked.status_code == 403
    assert blocked.json()["code"] == "OUTSIDE_LOGIN_SCHEDULE"


@pytest.mark.asyncio
async def test_permission_denied_without_users_manage(client: AsyncClient) -> None:
    reg = await register_owner(client, email="perm@test.com", company_name="Perm Co")
    owner_token = reg.json()["access_token"]

    await client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "login": "emp",
            "password": "employee123",
            "display_name": "Emp",
            "role": "employee",
        },
    )

    emp_login = await client.post(
        "/api/v1/auth/login",
        json={"login": "emp", "password": "employee123"},
    )
    emp_token = emp_login.json()["access_token"]

    denied = await client.get(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {emp_token}"},
    )
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_company_settings(client: AsyncClient) -> None:
    reg = await register_owner(client, email="settings@test.com", company_name="Settings Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    patch = await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={"settings": {"tax_rate": 0.1, "currency": "USD"}},
    )
    assert patch.status_code == 200
    assert patch.json()["settings"]["tax_rate"] == 0.1

    get = await client.get("/api/v1/company/settings", headers=headers)
    assert get.json()["settings"]["currency"] == "USD"


@pytest.mark.asyncio
async def test_login_globally_unique_across_companies(client: AsyncClient) -> None:
    reg_a = await register_owner(client, email="owner-a@test.com", company_name="Company A")
    reg_b = await register_owner(client, email="owner-b@test.com", company_name="Company B")
    token_a = reg_a.json()["access_token"]
    token_b = reg_b.json()["access_token"]

    create_a = await client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {token_a}"},
        json={
            "login": "shared-user",
            "password": "employee123",
            "display_name": "User A",
            "role": "employee",
        },
    )
    assert create_a.status_code == 201

    duplicate = await client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {token_b}"},
        json={
            "login": "shared-user",
            "password": "employee123",
            "display_name": "User B",
            "role": "employee",
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "LOGIN_EXISTS"


@pytest.mark.asyncio
async def test_update_user_login(client: AsyncClient) -> None:
    reg = await register_owner(
        client,
        email="owner-login@test.com",
        display_name="Owner",
        company_name="Login Co",
    )
    owner_token = reg.json()["access_token"]
    owner_id = reg.json()["user"]["id"]
    headers = {"Authorization": f"Bearer {owner_token}"}

    create = await client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "login": "alice",
            "password": "employee123",
            "display_name": "Alice",
            "role": "employee",
        },
    )
    assert create.status_code == 201
    user_id = create.json()["id"]

    patch = await client.patch(
        f"/api/v1/users/{user_id}",
        headers=headers,
        json={"login": "alice-renamed"},
    )
    assert patch.status_code == 200
    assert patch.json()["login"] == "alice-renamed"

    old_login = await client.post(
        "/api/v1/auth/login",
        json={"login": "alice", "password": "employee123"},
    )
    assert old_login.status_code == 401

    new_login = await client.post(
        "/api/v1/auth/login",
        json={"login": "alice-renamed", "password": "employee123"},
    )
    assert new_login.status_code == 200

    owner_patch = await client.patch(
        f"/api/v1/users/{owner_id}",
        headers=headers,
        json={"login": "owner-user"},
    )
    assert owner_patch.status_code == 200
    assert owner_patch.json()["login"] == "owner-user"

    owner_username_login = await client.post(
        "/api/v1/auth/login",
        json={"login": "owner-user", "password": "password123"},
    )
    assert owner_username_login.status_code == 200
