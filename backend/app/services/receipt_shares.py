from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import bad_request, not_found
from app.models.receipt_share import ReceiptShare

PDF_MAGIC = b"%PDF-"


def validate_pdf_bytes(data: bytes, *, max_bytes: int) -> None:
    if len(data) == 0:
        raise bad_request("Empty file", "EMPTY_FILE")
    if len(data) > max_bytes:
        raise bad_request("File too large", "FILE_TOO_LARGE")
    if not data.startswith(PDF_MAGIC):
        raise bad_request("File must be a PDF", "INVALID_PDF")


def storage_root() -> Path:
    settings = get_settings()
    root = Path(settings.receipt_share_storage_dir)
    if not root.is_absolute():
        root = Path.cwd() / root
    return root


def absolute_storage_path(relative_path: str) -> Path:
    return storage_root() / relative_path


def write_pdf_atomically(company_id: int, token: str, data: bytes) -> str:
    relative_dir = f"{company_id}"
    relative_path = f"{relative_dir}/{token}.pdf"
    dest_dir = storage_root() / relative_dir
    dest_dir.mkdir(parents=True, exist_ok=True)
    temp_path = dest_dir / f".{token}.tmp"
    final_path = dest_dir / f"{token}.pdf"
    temp_path.write_bytes(data)
    temp_path.replace(final_path)
    return relative_path


def delete_storage_file(relative_path: str) -> None:
    path = absolute_storage_path(relative_path)
    if path.is_file():
        path.unlink(missing_ok=True)


def build_share_url(token: str) -> str:
    settings = get_settings()
    base = settings.public_base_url
    path = f"/api/v1/receipts/share/{token}"
    if base:
        return f"{base}{path}"
    return path


def sanitize_filename(filename: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in filename.strip())
    return cleaned[:200] or "receipt.pdf"


async def count_recent_uploads(session: AsyncSession, company_id: int, *, hours: int = 1) -> int:
    since = datetime.now(UTC) - timedelta(hours=hours)
    result = await session.scalar(
        select(func.count())
        .select_from(ReceiptShare)
        .where(ReceiptShare.company_id == company_id, ReceiptShare.created_at >= since)
    )
    return int(result or 0)


async def create_receipt_share(
    session: AsyncSession,
    *,
    company_id: int,
    created_by_user_id: int | None,
    pdf_bytes: bytes,
    filename: str,
    document_code: str | None,
) -> ReceiptShare:
    settings = get_settings()
    validate_pdf_bytes(pdf_bytes, max_bytes=settings.receipt_share_max_bytes)

    recent = await count_recent_uploads(session, company_id)
    if recent >= settings.receipt_share_hourly_upload_limit:
        raise bad_request("Upload rate limit exceeded", "RATE_LIMIT_EXCEEDED")

    token = str(uuid4())
    relative_path = write_pdf_atomically(company_id, token, pdf_bytes)
    expires_at = datetime.now(UTC) + timedelta(hours=settings.receipt_share_ttl_hours)

    share = ReceiptShare(
        token=token,
        company_id=company_id,
        created_by_user_id=created_by_user_id,
        storage_path=relative_path,
        filename=sanitize_filename(filename),
        file_size=len(pdf_bytes),
        document_code=document_code,
        expires_at=expires_at,
        download_count=0,
    )
    session.add(share)
    await session.flush()
    return share


async def get_receipt_share_by_token(session: AsyncSession, token: str) -> ReceiptShare | None:
    result = await session.execute(select(ReceiptShare).where(ReceiptShare.token == token))
    return result.scalar_one_or_none()


def is_share_expired(share: ReceiptShare, *, now: datetime | None = None) -> bool:
    current = now or datetime.now(UTC)
    expires = share.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    return current >= expires


async def get_share_file_path(share: ReceiptShare) -> Path:
    path = absolute_storage_path(share.storage_path)
    if not path.is_file():
        raise not_found("Receipt file not found", "RECEIPT_FILE_NOT_FOUND")
    return path


async def increment_download_count(session: AsyncSession, share: ReceiptShare) -> None:
    share.download_count += 1
    await session.flush()


async def clean_expired_receipt_shares(session: AsyncSession) -> int:
    result = await session.execute(select(ReceiptShare))
    shares = list(result.scalars().all())
    expired = [share for share in shares if is_share_expired(share)]
    for share in expired:
        delete_storage_file(share.storage_path)
    if not expired:
        return 0
    tokens = [share.token for share in expired]
    await session.execute(delete(ReceiptShare).where(ReceiptShare.token.in_(tokens)))
    return len(expired)
