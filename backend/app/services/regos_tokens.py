from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RegosToken


async def get_token_config(session: AsyncSession, company_id: int) -> dict:
    result = await session.execute(
        select(RegosToken).where(RegosToken.company_id == company_id)
    )
    row = result.scalar_one_or_none()
    if not row or not row.integration_token.strip():
        return {"configured": False, "token": "", "is_replicable": False}
    return {
        "configured": True,
        "token": row.integration_token,
        "is_replicable": bool(row.is_replicable),
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
    integration_token: str,
    is_replicable: bool,
) -> RegosToken:
    result = await session.execute(
        select(RegosToken).where(RegosToken.company_id == company_id)
    )
    row = result.scalar_one_or_none()
    if row:
        row.integration_token = integration_token
        row.is_replicable = is_replicable
    else:
        row = RegosToken(
            company_id=company_id,
            integration_token=integration_token,
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
