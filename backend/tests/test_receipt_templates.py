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
    assert receipt["engine"] == "builtin"

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
async def test_patch_receipt_template_amount_in_words_language(client: AsyncClient) -> None:
    reg = await register_owner(
        client, email="receipt-words@test.com", company_name="Words Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    initial = await client.get("/api/v1/company/settings/receipt-templates", headers=headers)
    templates = initial.json()["settings"]["templates"]
    templates[0]["amount_in_words_language"] = "ru"

    patched = await client.patch(
        "/api/v1/company/settings/receipt-templates",
        headers=headers,
        json={"templates": templates},
    )
    assert patched.status_code == 200
    saved = patched.json()["settings"]["templates"][0]
    assert saved["amount_in_words_language"] == "ru"

    cleared = await client.patch(
        "/api/v1/company/settings/receipt-templates",
        headers=headers,
        json={"templates": [{**templates[0], "amount_in_words_language": None}]},
    )
    assert cleared.status_code == 200
    assert cleared.json()["settings"]["templates"][0]["amount_in_words_language"] is None


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
            "permission_rules": [{"code": "documents.print", "effect": "allow"}],
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


@pytest.mark.asyncio
async def test_patch_html_receipt_template_round_trip(client: AsyncClient) -> None:
    reg = await register_owner(
        client, email="receipt-html@test.com", company_name="HTML Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    initial = await client.get("/api/v1/company/settings/receipt-templates", headers=headers)
    templates = initial.json()["settings"]["templates"]
    templates.append(
        {
            "id": "html-template-1",
            "name": "Custom HTML Invoice",
            "format": "a4",
            "engine": "html",
            "is_default": False,
            "header": {
                "company_name": "HTML Co",
                "address": "",
                "phone": "",
                "tax_id": "",
            },
            "invoice_title": "INVOICE",
            "footer_text": "Thanks",
            "sections": templates[0]["sections"],
            "html": "<div>{{document.code}}</div>",
            "css": ".invoice { color: #111; }",
        }
    )

    patched = await client.patch(
        "/api/v1/company/settings/receipt-templates",
        headers=headers,
        json={"templates": templates},
    )
    assert patched.status_code == 200
    saved = next(
        t for t in patched.json()["settings"]["templates"] if t["id"] == "html-template-1"
    )
    assert saved["engine"] == "html"
    assert saved["html"] == "<div>{{document.code}}</div>"
    assert saved["css"] == ".invoice { color: #111; }"


@pytest.mark.asyncio
async def test_patch_rejects_html_template_without_body(client: AsyncClient) -> None:
    reg = await register_owner(
        client, email="receipt-html-empty@test.com", company_name="Empty HTML Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    initial = await client.get("/api/v1/company/settings/receipt-templates", headers=headers)
    templates = initial.json()["settings"]["templates"]
    templates.append(
        {
            "id": "html-empty",
            "name": "Broken HTML",
            "format": "a4",
            "engine": "html",
            "is_default": False,
            "header": templates[0]["header"],
            "invoice_title": "",
            "footer_text": "",
            "sections": templates[0]["sections"],
            "html": "   ",
            "css": "",
        }
    )

    response = await client.patch(
        "/api/v1/company/settings/receipt-templates",
        headers=headers,
        json={"templates": templates},
    )
    assert response.status_code in (400, 422)


@pytest.mark.asyncio
async def test_patch_receipt_template_logos_round_trip(client: AsyncClient) -> None:
    reg = await register_owner(
        client, email="receipt-logos@test.com", company_name="Logo Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    logo_src = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    initial = await client.get("/api/v1/company/settings/receipt-templates", headers=headers)
    templates = initial.json()["settings"]["templates"]
    templates[0]["logos"] = [
        {
            "id": "logo-1",
            "name": "Primary",
            "src": logo_src,
            "max_width": 120,
        }
    ]

    patched = await client.patch(
        "/api/v1/company/settings/receipt-templates",
        headers=headers,
        json={"templates": templates},
    )
    assert patched.status_code == 200
    saved = patched.json()["settings"]["templates"][0]
    assert len(saved["logos"]) == 1
    assert saved["logos"][0]["name"] == "Primary"
    assert saved["logos"][0]["max_width"] == 120


@pytest.mark.asyncio
async def test_patch_rejects_invalid_receipt_template_logo(client: AsyncClient) -> None:
    reg = await register_owner(
        client, email="receipt-logos-bad@test.com", company_name="Bad Logo Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    initial = await client.get("/api/v1/company/settings/receipt-templates", headers=headers)
    templates = initial.json()["settings"]["templates"]
    templates[0]["logos"] = [
        {
            "id": "logo-bad",
            "name": "Bad",
            "src": "data:text/html;base64,PHNjcmlwdD4=",
            "max_width": None,
        }
    ]

    response = await client.patch(
        "/api/v1/company/settings/receipt-templates",
        headers=headers,
        json={"templates": templates},
    )
    assert response.status_code in (400, 422)


@pytest.mark.asyncio
async def test_patch_rejects_script_in_html_template(client: AsyncClient) -> None:
    reg = await register_owner(
        client, email="receipt-html-script@test.com", company_name="Script Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    initial = await client.get("/api/v1/company/settings/receipt-templates", headers=headers)
    templates = initial.json()["settings"]["templates"]
    templates[0]["engine"] = "html"
    templates[0]["html"] = "<script>alert(1)</script><div>ok</div>"

    response = await client.patch(
        "/api/v1/company/settings/receipt-templates",
        headers=headers,
        json={"templates": templates},
    )
    assert response.status_code in (400, 422)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "markup",
    [
        '<img src="x" onerror="alert(1)">',
        "<iframe src=\"https://evil.test\"></iframe>",
        ".bad { @import url('https://evil.test/x.css'); }",
    ],
)
async def test_patch_rejects_dangerous_template_markup(
    client: AsyncClient,
    markup: str,
) -> None:
    reg = await register_owner(
        client,
        email=f"receipt-danger-{abs(hash(markup))}@test.com",
        company_name="Danger Co",
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    initial = await client.get("/api/v1/company/settings/receipt-templates", headers=headers)
    templates = initial.json()["settings"]["templates"]
    templates[0]["engine"] = "html"
    if markup.startswith("."):
        templates[0]["html"] = "<div>ok</div>"
        templates[0]["css"] = markup
    else:
        templates[0]["html"] = markup
        templates[0]["css"] = ""

    response = await client.patch(
        "/api/v1/company/settings/receipt-templates",
        headers=headers,
        json={"templates": templates},
    )
    assert response.status_code in (400, 422)
