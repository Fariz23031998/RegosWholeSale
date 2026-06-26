import pytest
from httpx import AsyncClient

from helpers import TEST_VERIFICATION_CODE, register_owner


async def _create_employee(
    client: AsyncClient,
    owner_token: str,
    *,
    login: str,
    permission_rules: list[dict] | None = None,
) -> dict:
    body: dict = {
        "login": login,
        "password": "password123",
        "display_name": f"Employee {login}",
        "role": "employee",
    }
    if permission_rules is not None:
        body["permission_rules"] = permission_rules
    response = await client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {owner_token}"},
        json=body,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _login_employee(client: AsyncClient, login: str) -> str:
    response = await client.post(
        "/api/v1/auth/login",
        json={"login": login, "password": "password123"},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest.mark.asyncio
async def test_employee_allow_grants_permission(client: AsyncClient) -> None:
    reg = await register_owner(client, email="allow@test.com", company_name="Allow Co")
    owner_token = reg.json()["access_token"]

    employee = await _create_employee(
        client,
        owner_token,
        login="allow-emp",
        permission_rules=[{"code": "documents.print", "effect": "allow"}],
    )
    assert "documents.print" in employee["permissions"]

    token = await _login_employee(client, "allow-emp")
    templates = await client.get(
        "/api/v1/company/settings/receipt-templates",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert templates.status_code == 200


@pytest.mark.asyncio
async def test_employee_deny_strips_default_permission(client: AsyncClient) -> None:
    reg = await register_owner(client, email="deny@test.com", company_name="Deny Co")
    owner_token = reg.json()["access_token"]

    employee = await _create_employee(
        client,
        owner_token,
        login="deny-emp",
        permission_rules=[{"code": "sales.write", "effect": "deny"}],
    )
    assert "sales.write" not in employee["permissions"]
    assert "sales.read" in employee["permissions"]


@pytest.mark.asyncio
async def test_deny_beats_allow(client: AsyncClient) -> None:
    reg = await register_owner(client, email="beat@test.com", company_name="Beat Co")
    owner_token = reg.json()["access_token"]

    employee = await _create_employee(
        client,
        owner_token,
        login="beat-emp",
        permission_rules=[
            {"code": "sales.write", "effect": "allow"},
            {"code": "sales.write", "effect": "deny"},
        ],
    )
    assert "sales.write" not in employee["permissions"]


@pytest.mark.asyncio
async def test_owner_ignores_permission_rules(client: AsyncClient) -> None:
    reg = await register_owner(client, email="owner-rules@test.com", company_name="Owner Rules Co")
    owner = reg.json()["user"]
    assert owner["role"] == "owner"
    assert owner["permission_rules"] == []
    assert "users.manage" in owner["permissions"]


@pytest.mark.asyncio
async def test_employee_without_print_cannot_load_templates(client: AsyncClient) -> None:
    reg = await register_owner(client, email="noprint@test.com", company_name="No Print Co")
    owner_token = reg.json()["access_token"]

    await _create_employee(client, owner_token, login="noprint-emp")
    token = await _login_employee(client, "noprint-emp")

    templates = await client.get(
        "/api/v1/company/settings/receipt-templates",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert templates.status_code == 403


@pytest.mark.asyncio
async def test_postpone_requires_sales_postpone_permission(client: AsyncClient) -> None:
    reg = await register_owner(client, email="postpone@test.com", company_name="Postpone Co")
    owner_token = reg.json()["access_token"]

    await _create_employee(client, owner_token, login="postpone-emp")
    token = await _login_employee(client, "postpone-emp")

    response = await client.post(
        "/api/v1/sales/postpone",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "items": [{"regos_item_id": 1, "qty": 1, "price": 10}],
            "discount": 0,
            "total": 10,
        },
    )
    assert response.status_code == 403
