from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError, not_found
from app.core.regos_oauth import regos_oauth_configured, regos_oauth_service
from app.models import RegosToken


@dataclass(frozen=True)
class RegosApiAuth:
    integration_token: str
    bearer_token: str | None


async def get_regos_api_auth(session: AsyncSession, company_id: int) -> RegosApiAuth:
    result = await session.execute(
        select(RegosToken).where(RegosToken.company_id == company_id)
    )
    row = result.scalar_one_or_none()
    if not row or not row.integration_token.strip():
        raise not_found("Regos integration token not configured for this company", "REGOS_TOKEN_NOT_CONFIGURED")

    bearer_token: str | None = None
    if row.is_replicable:
        if not regos_oauth_configured():
            raise AppError(
                503,
                "Replicable Regos integration requires OAuth (REGOS_CLIENT_ID / REGOS_CLIENT_SECRET)",
                "REGOS_OAUTH_NOT_CONFIGURED",
            )
        bearer_token = await regos_oauth_service.acquire_access_token()

    return RegosApiAuth(
        integration_token=row.integration_token,
        bearer_token=bearer_token,
    )
