"""Seed company Regos defaults once after an integration token is saved."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request
from app.core.regos_api import regos_async_api_request_for_company
from app.services import regos_defaults as regos_defaults_service
from app.services.settings_change import notify_settings_updated

logger = logging.getLogger("regos.backend")

REGOS_OPTOM_INCOME_NAME = "RegosOptomIncome"
REGOS_OPTOM_REFUND_NAME = "RegosOptomRefund"
SEEDED_VAT_CALCULATION_TYPE = "No"


async def seed_company_regos_defaults_after_token(
    session: AsyncSession,
    company_id: int,
) -> bool:
    """Apply first-time company Regos defaults after a token is configured.

    Returns True when defaults were written. Skips when warehouse or payment
    category is already configured.
    """
    current = await regos_defaults_service.get_stored_regos_defaults(session, company_id)
    if current.get("warehouse") or current.get("payment_category"):
        return False

    income = await _ensure_payment_category(
        session,
        company_id,
        name=REGOS_OPTOM_INCOME_NAME,
        positive=True,
    )
    refund = await _ensure_payment_category(
        session,
        company_id,
        name=REGOS_OPTOM_REFUND_NAME,
        positive=False,
    )

    warehouses = await regos_defaults_service._fetch_reference_options(
        session, company_id, "warehouse"
    )
    price_types = await regos_defaults_service._fetch_reference_options(
        session, company_id, "price_type"
    )
    attached_users = await regos_defaults_service._fetch_reference_options(
        session, company_id, "attached_user"
    )

    patch: dict[str, Any] = {
        "partner_id": None,
        "vat_calculation_type": SEEDED_VAT_CALCULATION_TYPE,
        "payment_category_id": income["id"],
        "refund_payment_category_id": refund["id"],
    }
    if warehouses:
        patch["warehouse_id"] = warehouses[0]["id"]
    if price_types:
        patch["price_type_id"] = price_types[0]["id"]
    if attached_users:
        patch["attached_user_id"] = attached_users[0]["id"]

    await regos_defaults_service.patch_regos_defaults(session, company_id, patch)
    await notify_settings_updated(
        session,
        company_id,
        scope="company",
        namespace="regos_defaults",
    )
    return True


async def _ensure_payment_category(
    session: AsyncSession,
    company_id: int,
    *,
    name: str,
    positive: bool,
) -> dict[str, Any]:
    kind = "payment_category" if positive else "refund_payment_category"
    existing = await regos_defaults_service._fetch_reference_options(
        session, company_id, kind
    )
    for item in existing:
        if item.get("name") == name:
            return item

    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "accountoperationcategory/add",
        {"name": name, "positive": positive},
    )
    result = response.get("result")
    new_id = result.get("new_id") if isinstance(result, dict) else None
    if not isinstance(new_id, int) or new_id <= 0:
        raise bad_request(
            f"Regos did not return a new payment category id for {name}.",
            "REGOS_PAYMENT_CATEGORY_CREATE_FAILED",
        )
    return {"id": new_id, "name": name}
