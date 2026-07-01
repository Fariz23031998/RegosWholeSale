from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from app.models.receipt_share import ReceiptShare
from app.services.receipt_shares import clean_expired_receipt_shares
from helpers import register_owner

SAMPLE_CONTEXT = {
    "kind": "sale",
    "document": {
        "id": 1,
        "code": "WS-001",
        "date": 1719859200,
        "partner_id": None,
        "partner_name": "Test Buyer",
        "stock_id": None,
        "stock_name": "Main",
        "attached_user_id": None,
        "attached_user_name": "Cashier",
        "amount": 100.0,
        "performed": True,
        "currency": None,
    },
    "operations": [
        {
            "id": 1,
            "document_id": 1,
            "item_id": 1,
            "item_code": "SKU-1",
            "item_name": "Widget",
            "quantity": 2,
            "price": 50.0,
            "price2": 50.0,
            "amount": 100.0,
            "item": None,
        }
    ],
    "operation_groups": [],
    "totals": {"quantity": 2, "amount": 100.0, "amount_gross": 100.0, "discount": 0.0},
    "payments": [],
    "sale": {
        "id": "WS-001",
        "type": "sale",
        "items": [{"productId": "1", "name": "Widget", "qty": 2, "price": 50.0}],
        "total": 100.0,
        "createdAt": "2026-07-01T12:00:00.000Z",
        "cashierId": "1",
        "cashierName": "Cashier",
        "payments": [],
        "amountPaid": 100.0,
        "balanceDue": 0.0,
    },
    "partner_name": "Test Buyer",
    "stock_name": "Main",
    "document_code": "WS-001",
}


async def _fetch_default_template(client: AsyncClient, headers: dict[str, str]) -> dict:
    response = await client.get("/api/v1/company/settings/receipt-templates", headers=headers)
    assert response.status_code == 200
    templates = response.json()["settings"]["templates"]
    return templates[0]


@pytest.fixture
def receipt_share_storage(tmp_path, monkeypatch):
    monkeypatch.setenv("RECEIPT_SHARE_STORAGE_DIR", str(tmp_path / "receipt-shares"))
    monkeypatch.setenv("PUBLIC_APP_BASE_URL", "https://example.test")
    get_settings = __import__("app.config", fromlist=["get_settings"]).get_settings
    get_settings.cache_clear()
    yield tmp_path / "receipt-shares"
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_create_public_template_share(client: AsyncClient, receipt_share_storage) -> None:
    reg = await register_owner(client, email="share-upload@test.com", company_name="Share Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    template = await _fetch_default_template(client, headers)

    response = await client.post(
        "/api/v1/receipts/share",
        headers=headers,
        json={
            "template": template,
            "context": SAMPLE_CONTEXT,
            "document_code": "WS-001",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["public_token"]
    assert body["url"] == f"https://example.test/public/templates/{body['public_token']}"
    assert body["is_public"] is True
    assert "public_expires_at" in body

    public = await client.get(f"/api/v1/public/templates/{body['public_token']}")
    assert public.status_code == 200
    payload = public.json()
    assert payload["template"]["id"] == template["id"]
    assert payload["context"]["document"]["code"] == "WS-001"
    assert payload["document_code"] == "WS-001"


@pytest.mark.asyncio
async def test_reject_empty_context(client: AsyncClient, receipt_share_storage) -> None:
    reg = await register_owner(client, email="share-empty@test.com", company_name="Empty Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    template = await _fetch_default_template(client, headers)

    response = await client.post(
        "/api/v1/receipts/share",
        headers=headers,
        json={"template": template, "context": {}},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "EMPTY_CONTEXT"


@pytest.mark.asyncio
async def test_reject_oversize_payload(client: AsyncClient, receipt_share_storage, monkeypatch) -> None:
    monkeypatch.setenv("RECEIPT_SHARE_MAX_BYTES", "100")
    get_settings = __import__("app.config", fromlist=["get_settings"]).get_settings
    get_settings.cache_clear()

    reg = await register_owner(client, email="share-big@test.com", company_name="Big Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    template = await _fetch_default_template(client, headers)

    response = await client.post(
        "/api/v1/receipts/share",
        headers=headers,
        json={"template": template, "context": SAMPLE_CONTEXT},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "PAYLOAD_TOO_LARGE"
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_expired_public_template_returns_410(
    client: AsyncClient,
    session_factory,
    receipt_share_storage,
) -> None:
    reg = await register_owner(client, email="share-expired@test.com", company_name="Expired Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    template = await _fetch_default_template(client, headers)

    upload = await client.post(
        "/api/v1/receipts/share",
        headers=headers,
        json={"template": template, "context": SAMPLE_CONTEXT},
    )
    public_token = upload.json()["public_token"]

    async with session_factory() as session:
        result = await session.get(ReceiptShare, 1)
        assert result is not None
        result.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()

    response = await client.get(f"/api/v1/public/templates/{public_token}")
    assert response.status_code == 410
    assert response.json()["code"] == "PUBLIC_TEMPLATE_EXPIRED"


@pytest.mark.asyncio
async def test_private_public_template_returns_403(
    client: AsyncClient,
    session_factory,
    receipt_share_storage,
) -> None:
    reg = await register_owner(client, email="share-private@test.com", company_name="Private Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    template = await _fetch_default_template(client, headers)

    upload = await client.post(
        "/api/v1/receipts/share",
        headers=headers,
        json={"template": template, "context": SAMPLE_CONTEXT},
    )
    public_token = upload.json()["public_token"]

    async with session_factory() as session:
        result = await session.get(ReceiptShare, 1)
        assert result is not None
        result.is_public = False
        await session.commit()

    response = await client.get(f"/api/v1/public/templates/{public_token}")
    assert response.status_code == 403
    assert response.json()["code"] == "PUBLIC_TEMPLATE_PRIVATE"


@pytest.mark.asyncio
async def test_public_template_not_found(client: AsyncClient, receipt_share_storage) -> None:
    response = await client.get("/api/v1/public/templates/00000000-0000-0000-0000-000000000099")
    assert response.status_code == 404
    assert response.json()["code"] == "PUBLIC_TEMPLATE_NOT_FOUND"


@pytest.mark.asyncio
async def test_upload_requires_documents_print(
    client: AsyncClient,
    receipt_share_storage,
) -> None:
    owner_reg = await register_owner(
        client, email="share-owner@test.com", company_name="Perm Co"
    )
    owner_token = owner_reg.json()["access_token"]

    employee = await client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "login": "employee-share",
            "password": "password123",
            "display_name": "Employee",
            "role": "employee",
            "permission_rules": [],
        },
    )
    assert employee.status_code == 201

    login = await client.post(
        "/api/v1/auth/login",
        json={"login": "employee-share", "password": "password123"},
    )
    emp_token = login.json()["access_token"]

    template = await _fetch_default_template(client, {"Authorization": f"Bearer {owner_token}"})

    response = await client.post(
        "/api/v1/receipts/share",
        headers={"Authorization": f"Bearer {emp_token}"},
        json={"template": template, "context": SAMPLE_CONTEXT},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_cleanup_deletes_expired_shares(
    session_factory,
    receipt_share_storage,
) -> None:
    async with session_factory() as session:
        share = ReceiptShare(
            token="cleanup-token",
            company_id=1,
            created_by_user_id=None,
            is_public=True,
            template_snapshot={"id": "tpl", "name": "Test", "format": "80mm", "engine": "builtin"},
            render_context=SAMPLE_CONTEXT,
            storage_path=None,
            filename=None,
            file_size=None,
            document_code=None,
            expires_at=datetime.now(UTC) - timedelta(hours=1),
            download_count=0,
        )
        session.add(share)
        await session.commit()

    async with session_factory() as session:
        deleted = await clean_expired_receipt_shares(session)
        await session.commit()
    assert deleted == 1
