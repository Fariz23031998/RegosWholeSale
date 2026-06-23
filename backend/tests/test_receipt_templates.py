import pytest
from httpx import AsyncClient

from helpers import register_owner


@pytest.mark.asyncio
async def test_get_seeds_default_receipt_templates(client: AsyncClient) -> None:
    reg = await register_owner(
        client, email="receipt-tpl@test.com", company_name="Receipt Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.get("/api/v1/company/settings/receipt-templates", headers=headers)
    assert response.status_code == 200
    data = response.json()["settings"]
    assert len(data["templates"]) == 2
    assert data["default_template_id"] is not None

    formats = {t["format"] for t in data["templates"]}
    assert formats == {"80mm", "a4"}

    receipt = next(t for t in data["templates"] if t["format"] == "80mm")
    assert receipt["header"]["company_name"] == "Receipt Co"
    assert receipt["is_default"] is True
    assert receipt["sections"]["partner"] is False

    invoice = next(t for t in data["templates"] if t["format"] == "a4")
    assert invoice["invoice_title"] == "INVOICE"
    assert invoice["sections"]["partner"] is True


@pytest.mark.asyncio
async def test_patch_receipt_templates(client: AsyncClient) -> None:
    reg = await register_owner(
        client, email="receipt-patch@test.com", company_name="Patch Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    initial = await client.get("/api/v1/company/settings/receipt-templates", headers=headers)
    templates = initial.json()["settings"]["templates"]
    invoice = next(t for t in templates if t["format"] == "a4")

    for template in templates:
        template["is_default"] = template["id"] == invoice["id"]

    patched = await client.patch(
        "/api/v1/company/settings/receipt-templates",
        headers=headers,
        json={
            "templates": templates,
            "default_template_id": invoice["id"],
        },
    )
    assert patched.status_code == 200
    result = patched.json()["settings"]
    assert result["default_template_id"] == invoice["id"]
    default_tpl = next(t for t in result["templates"] if t["is_default"])
    assert default_tpl["id"] == invoice["id"]


@pytest.mark.asyncio
async def test_patch_rejects_invalid_format(client: AsyncClient) -> None:
    reg = await register_owner(
        client, email="receipt-bad@test.com", company_name="Bad Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    initial = await client.get("/api/v1/company/settings/receipt-templates", headers=headers)
    templates = initial.json()["settings"]["templates"]
    templates[0]["format"] = "letter"

    response = await client.patch(
        "/api/v1/company/settings/receipt-templates",
        headers=headers,
        json={"templates": templates},
    )
    assert response.status_code in (400, 422)


@pytest.mark.asyncio
async def test_employee_can_read_but_not_patch_receipt_templates(
    client: AsyncClient,
) -> None:
    reg = await register_owner(
        client, email="receipt-emp@test.com", company_name="Emp Co"
    )
    owner_token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {owner_token}"}

    await client.get("/api/v1/company/settings/receipt-templates", headers=headers)

    await client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "login": "cashier2",
            "password": "employee123",
            "display_name": "Cashier",
            "role": "employee",
        },
    )

    emp_login = await client.post(
        "/api/v1/auth/login",
        json={"login": "cashier2", "password": "employee123"},
    )
    emp_token = emp_login.json()["access_token"]
    emp_headers = {"Authorization": f"Bearer {emp_token}"}

    read = await client.get(
        "/api/v1/company/settings/receipt-templates", headers=emp_headers
    )
    assert read.status_code == 200
    assert len(read.json()["settings"]["templates"]) == 2

    denied = await client.patch(
        "/api/v1/company/settings/receipt-templates",
        headers=emp_headers,
        json={"default_template_id": "x"},
    )
    assert denied.status_code == 403
