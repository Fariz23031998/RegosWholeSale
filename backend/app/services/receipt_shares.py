import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import bad_request, forbidden, gone, not_found
from app.models.receipt_share import ReceiptShare
from app.schemas.receipt_templates import ReceiptTemplate


def build_public_template_url(public_token: str) -> str:
    settings = get_settings()
    base = settings.public_base_url
    path = f"/public/templates/{public_token}"
    if base:
        return f"{base}{path}"
    return path


def validate_share_payload(
    template: ReceiptTemplate,
    context: dict[str, Any],
    *,
    max_bytes: int,
) -> None:
    if not context:
        raise bad_request("Receipt context is required", "EMPTY_CONTEXT")
    try:
        payload_size = len(
            json.dumps(
                {"template": template.model_dump(), "context": context},
                ensure_ascii=False,
            ).encode("utf-8")
        )
    except (TypeError, ValueError) as exc:
        raise bad_request("Invalid receipt payload", "INVALID_PAYLOAD") from exc
    if payload_size > max_bytes:
        raise bad_request("Receipt payload too large", "PAYLOAD_TOO_LARGE")


async def count_recent_uploads(session: AsyncSession, company_id: int, *, hours: int = 1) -> int:
    since = datetime.now(UTC) - timedelta(hours=hours)
    result = await session.scalar(
        select(func.count())
        .select_from(ReceiptShare)
        .where(ReceiptShare.company_id == company_id, ReceiptShare.created_at >= since)
    )
    return int(result or 0)


async def create_public_template_share(
    session: AsyncSession,
    *,
    company_id: int,
    created_by_user_id: int | None,
    template: ReceiptTemplate,
    context: dict[str, Any],
    document_code: str | None,
) -> ReceiptShare:
    settings = get_settings()
    validate_share_payload(template, context, max_bytes=settings.receipt_share_max_bytes)

    recent = await count_recent_uploads(session, company_id)
    if recent >= settings.receipt_share_hourly_upload_limit:
        raise bad_request("Upload rate limit exceeded", "RATE_LIMIT_EXCEEDED")

    public_token = str(uuid4())
    expires_at = datetime.now(UTC) + timedelta(hours=settings.receipt_share_ttl_hours)

    share = ReceiptShare(
        token=public_token,
        company_id=company_id,
        created_by_user_id=created_by_user_id,
        is_public=True,
        template_snapshot=template.model_dump(),
        render_context=context,
        storage_path=None,
        filename=None,
        file_size=None,
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


async def get_public_template_share(
    session: AsyncSession,
    public_token: str,
) -> tuple[ReceiptShare, ReceiptTemplate, dict[str, Any]]:
    share = await get_receipt_share_by_token(session, public_token)
    if share is None:
        raise not_found("Public template not found", "PUBLIC_TEMPLATE_NOT_FOUND")
    if not share.is_public:
        raise forbidden("This template link is private", "PUBLIC_TEMPLATE_PRIVATE")
    if is_share_expired(share):
        raise gone("This template link has expired", "PUBLIC_TEMPLATE_EXPIRED")
    if not share.template_snapshot or not share.render_context:
        raise not_found("Public template not found", "PUBLIC_TEMPLATE_NOT_FOUND")

    template = ReceiptTemplate.model_validate(share.template_snapshot)
    return share, template, share.render_context


async def increment_view_count(session: AsyncSession, share: ReceiptShare) -> None:
    share.download_count += 1
    await session.flush()


async def clean_expired_receipt_shares(session: AsyncSession) -> int:
    now = datetime.now(UTC)
    result = await session.execute(delete(ReceiptShare).where(ReceiptShare.expires_at < now))
    return int(result.rowcount or 0)
