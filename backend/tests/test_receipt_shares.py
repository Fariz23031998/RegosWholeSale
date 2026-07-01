from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.models.receipt_share import ReceiptShare
from app.services.receipt_shares import (
    clean_expired_receipt_shares,
    storage_root,
    write_pdf_atomically,
)
from helpers import register_owner

MINIMAL_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<<>>endobj\n"
    b"trailer<<>>\n"
    b"%%EOF\n"
)


@pytest.fixture
def receipt_share_storage(tmp_path, monkeypatch):
    storage_dir = tmp_path / "receipt-shares"
    monkeypatch.setenv("RECEIPT_SHARE_STORAGE_DIR", str(storage_dir))
    monkeypatch.setenv("PUBLIC_APP_BASE_URL", "https://example.test")
    get_settings = __import__("app.config", fromlist=["get_settings"]).get_settings
    get_settings.cache_clear()
    yield storage_dir
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_upload_receipt_share(client: AsyncClient, receipt_share_storage: Path) -> None:
    reg = await register_owner(client, email="share-upload@test.com", company_name="Share Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.post(
        "/api/v1/receipts/share",
        headers=headers,
        files={"file": ("receipt-test.pdf", MINIMAL_PDF, "application/pdf")},
        data={"document_code": "WS-001"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["share_id"]
    assert body["url"] == f"https://example.test/api/v1/receipts/share/{body['share_id']}"
    assert body["filename"] == "receipt-test.pdf"
    assert "expires_at" in body

    download = await client.get(f"/api/v1/receipts/share/{body['share_id']}")
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/pdf"
    assert download.content.startswith(b"%PDF-")


@pytest.mark.asyncio
async def test_reject_non_pdf(client: AsyncClient, receipt_share_storage: Path) -> None:
    reg = await register_owner(client, email="share-bad@test.com", company_name="Bad Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.post(
        "/api/v1/receipts/share",
        headers=headers,
        files={"file": ("bad.pdf", b"not-a-pdf", "application/pdf")},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_PDF"


@pytest.mark.asyncio
async def test_reject_oversize_pdf(client: AsyncClient, receipt_share_storage: Path, monkeypatch) -> None:
    monkeypatch.setenv("RECEIPT_SHARE_MAX_BYTES", "10")
    get_settings = __import__("app.config", fromlist=["get_settings"]).get_settings
    get_settings.cache_clear()

    reg = await register_owner(client, email="share-big@test.com", company_name="Big Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.post(
        "/api/v1/receipts/share",
        headers=headers,
        files={"file": ("big.pdf", MINIMAL_PDF, "application/pdf")},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "FILE_TOO_LARGE"
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_expired_share_returns_410(
    client: AsyncClient,
    session_factory,
    receipt_share_storage: Path,
) -> None:
    reg = await register_owner(client, email="share-expired@test.com", company_name="Expired Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    upload = await client.post(
        "/api/v1/receipts/share",
        headers=headers,
        files={"file": ("receipt.pdf", MINIMAL_PDF, "application/pdf")},
    )
    share_id = upload.json()["share_id"]

    async with session_factory() as session:
        result = await session.get(ReceiptShare, 1)
        assert result is not None
        result.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()

    response = await client.get(f"/api/v1/receipts/share/{share_id}")
    assert response.status_code == 410
    assert "expired" in response.text.lower()


@pytest.mark.asyncio
async def test_download_not_found(client: AsyncClient, receipt_share_storage: Path) -> None:
    response = await client.get("/api/v1/receipts/share/00000000-0000-0000-0000-000000000099")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_upload_requires_documents_print(
    client: AsyncClient,
    receipt_share_storage: Path,
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

    response = await client.post(
        "/api/v1/receipts/share",
        headers={"Authorization": f"Bearer {emp_token}"},
        files={"file": ("receipt.pdf", MINIMAL_PDF, "application/pdf")},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_cleanup_deletes_expired_shares(
    session_factory,
    receipt_share_storage: Path,
) -> None:
    relative_path = write_pdf_atomically(1, "cleanup-token", MINIMAL_PDF)
    assert (storage_root() / relative_path).is_file()

    async with session_factory() as session:
        share = ReceiptShare(
            token="cleanup-token",
            company_id=1,
            created_by_user_id=None,
            storage_path=relative_path,
            filename="receipt.pdf",
            file_size=len(MINIMAL_PDF),
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
    assert not (storage_root() / relative_path).is_file()
