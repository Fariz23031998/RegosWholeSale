from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import bad_request
from app.models import RegosToken


def regos_webhook_url() -> str | None:
    return get_settings().regos_webhook_url


def _mask_token(token: str) -> str:
    trimmed = token.strip()
    if len(trimmed) <= 4:
        return "****"
    return f"****{trimmed[-4:]}"


async def get_token_config(session: AsyncSession, company_id: int) -> dict:
    result = await session.execute(
        select(RegosToken).where(RegosToken.company_id == company_id)
    )
    row = result.scalar_one_or_none()
    if not row or not row.integration_token.strip():
        return {
            "configured": False,
            "token_masked": "",
            "is_replicable": False,
            "webhook_url": regos_webhook_url(),
        }
    return {
        "configured": True,
        "token_masked": _mask_token(row.integration_token),
        "is_replicable": bool(row.is_replicable),
        "webhook_url": regos_webhook_url(),
    }


async def get_token_status(session: AsyncSession, company_id: int) -> dict:
    result = await session.execute(
        select(RegosToken).where(RegosToken.company_id == company_id)
    )
    row = result.scalar_one_or_none()
    if not row or not row.integration_token.strip():
        return {"configured": False, "is_replicable": False}
    return {"configured": True, "is_replicable": bool(row.is_replicable)}


async def upsert_token(
    session: AsyncSession,
    company_id: int,
    integration_token: str | None,
    is_replicable: bool,
) -> RegosToken:
    result = await session.execute(
        select(RegosToken).where(RegosToken.company_id == company_id)
    )
    row = result.scalar_one_or_none()
    next_token = integration_token.strip() if integration_token else ""
    if row:
        if next_token:
            row.integration_token = next_token
        row.is_replicable = is_replicable
    else:
        if not next_token:
            raise bad_request(
                "Regos integration token is required",
                "REGOS_TOKEN_REQUIRED",
            )
        row = RegosToken(
            company_id=company_id,
            integration_token=next_token,
            is_replicable=is_replicable,
        )
        session.add(row)
    await session.flush()
    return row


async def delete_token(session: AsyncSession, company_id: int) -> bool:
    result = await session.execute(
        select(RegosToken).where(RegosToken.company_id == company_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        return False
    await session.delete(row)
    await session.flush()
    return True
