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


@pytest.mark.asyncio
async def test_employee_defaults_include_item_mutate_permissions(client: AsyncClient) -> None:
    reg = await register_owner(client, email="item-defaults@test.com", company_name="Item Defaults Co")
    owner_token = reg.json()["access_token"]
    employee = await _create_employee(client, owner_token, login="item-defaults")
    assert "stock.item_create" in employee["permissions"]
    assert "stock.item_edit" in employee["permissions"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "denied_code", "json_body"),
    [
        (
            "POST",
            "/api/v1/regos/items",
            "stock.item_create",
            {
                "name": "Milk",
                "group_id": 1,
                "unit_id": 1,
                "vat_id": 1,
                "type": "Item",
            },
        ),
        (
            "PATCH",
            "/api/v1/regos/items/55",
            "stock.item_edit",
            {"name": "Milk 2%"},
        ),
        (
            "POST",
            "/api/v1/regos/product-groups",
            "stock.item_create",
            {"name": "Dairy", "parent_id": 0},
        ),
        (
            "PATCH",
            "/api/v1/regos/product-groups/10",
            "stock.item_edit",
            {"name": "Dairy updated"},
        ),
    ],
)
async def test_item_mutate_endpoints_require_specific_permissions(
    client: AsyncClient,
    method: str,
    path: str,
    denied_code: str,
    json_body: dict,
) -> None:
    reg = await register_owner(
        client,
        email=f"item-deny-{denied_code.replace('.', '-')}@test.com",
        company_name=f"Item Deny {denied_code}",
    )
    owner_token = reg.json()["access_token"]
    login = f"deny-{denied_code.replace('.', '-')}"
    await _create_employee(
        client,
        owner_token,
        login=login,
        permission_rules=[{"code": denied_code, "effect": "deny"}],
    )
    token = await _login_employee(client, login)
    response = await client.request(
        method,
        path,
        headers={"Authorization": f"Bearer {token}"},
        json=json_body,
    )
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_generate_ean13_requires_item_mutate_permission(client: AsyncClient) -> None:
    reg = await register_owner(
        client,
        email="item-deny-ean13@test.com",
        company_name="Item Deny EAN13",
    )
    owner_token = reg.json()["access_token"]
    await _create_employee(
        client,
        owner_token,
        login="deny-ean13",
        permission_rules=[
            {"code": "stock.item_create", "effect": "deny"},
            {"code": "stock.item_edit", "effect": "deny"},
        ],
    )
    token = await _login_employee(client, "deny-ean13")
    response = await client.post(
        "/api/v1/regos/barcodes/ean13",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_patch_user_permission_rules_appear_in_response(client: AsyncClient) -> None:
    """PATCH must return fresh permission_rules (not a stale ORM collection)."""
    reg = await register_owner(
        client,
        email="patch-rules@test.com",
        company_name="Patch Rules Co",
    )
    owner_token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {owner_token}"}

    employee = await _create_employee(client, owner_token, login="patch-rules-emp")
    assert employee["permission_rules"] == []
    assert "documents.print" not in employee["permissions"]

    patched = await client.patch(
        f"/api/v1/users/{employee['id']}",
        headers=headers,
        json={"permission_rules": [{"code": "documents.print", "effect": "allow"}]},
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["permission_rules"] == [{"code": "documents.print", "effect": "allow"}]
    assert "documents.print" in body["permissions"]

    cleared = await client.patch(
        f"/api/v1/users/{employee['id']}",
        headers=headers,
        json={"permission_rules": []},
    )
    assert cleared.status_code == 200, cleared.text
    cleared_body = cleared.json()
    assert cleared_body["permission_rules"] == []
    assert "documents.print" not in cleared_body["permissions"]
