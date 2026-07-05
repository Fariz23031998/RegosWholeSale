from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import AppError, bad_request, not_found
from app.core.regos_api import regos_async_api_request_for_company
from app.models import RegosToken

REGOS_INTEGRATION_NAME = "Regos Optom"

REQUIRED_INTEGRATION_WEBHOOKS: list[str] = [
    "DocChequeCanceled",
    "DocChequeClosed",
    "DocInOutPerformCanceled",
    "DocInOutPerformed",
    "DocMovementPerformCanceled",
    "DocMovementPerformed",
    "DocPaymentPerformCanceled",
    "DocPaymentPerformed",
    "DocPurchasePerformCanceled",
    "DocPurchasePerformed",
    "DocReturnsToPartnerPerformCanceled",
    "DocReturnsToPartnerPerformed",
    "DocSessionClosed",
    "DocSessionOpened",
    "DocWholeSalePerformCanceled",
    "DocWholeSalePerformed",
    "DocWholeSaleReturnPerformCanceled",
    "DocWholeSaleReturnPerformed",
    "POSChequePayDebt",
]


def regos_webhook_url() -> str | None:
    url = get_settings().regos_webhook_url.strip()
    return url or None


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


def _find_connected_integration(
    integrations: list[Any],
    integration_token: str,
) -> dict[str, Any] | None:
    token = integration_token.strip()
    for item in integrations:
        if not isinstance(item, dict):
            continue
        connected_id = item.get("connected_integration_id")
        if connected_id is not None and str(connected_id).strip() == token:
            return item
    return None


async def update_integration(session: AsyncSession, company_id: int) -> dict[str, str]:
    result = await session.execute(
        select(RegosToken).where(RegosToken.company_id == company_id)
    )
    row = result.scalar_one_or_none()
    if not row or not row.integration_token.strip():
        raise not_found(
            "Regos integration token not configured for this company",
            "REGOS_TOKEN_NOT_CONFIGURED",
        )

    if row.is_replicable:
        raise bad_request(
            "Integration update is only available for non-replicable tokens",
            "REGOS_INTEGRATION_NOT_LOCAL",
        )

    endpoint = regos_webhook_url()
    if not endpoint:
        raise bad_request(
            "REGOS webhook URL is not configured on the server (REGOS_WEBHOOK_URL)",
            "REGOS_WEBHOOK_URL_NOT_CONFIGURED",
        )

    get_response = await regos_async_api_request_for_company(
        session,
        company_id,
        "connectedintegration/get",
        {"is_public": False},
    )
    integrations = get_response.get("result", [])
    if not isinstance(integrations, list):
        raise AppError(
            502,
            "Invalid connected integrations response from REGOS API",
            "REGOS_API_ERROR",
        )

    matched = _find_connected_integration(integrations, row.integration_token)
    if not matched:
        raise not_found(
            "No connected integration matches the saved token",
            "REGOS_CONNECTED_INTEGRATION_NOT_FOUND",
        )

    key = matched.get("key")
    if not isinstance(key, str) or not key.strip():
        raise AppError(
            502,
            "Connected integration is missing a key",
            "REGOS_INTEGRATION_KEY_MISSING",
        )

    await regos_async_api_request_for_company(
        session,
        company_id,
        "integration/edit",
        {
            "key": key.strip(),
            "name": REGOS_INTEGRATION_NAME,
            "endpoint": endpoint,
            "webhooks": REQUIRED_INTEGRATION_WEBHOOKS,
        },
    )

    return {"message": "Regos integration updated successfully"}
