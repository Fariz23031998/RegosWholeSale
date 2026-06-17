from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import not_found
from app.models import Company

POS_SETTINGS_KEY = "pos"
DEFAULT_TENDERED_QUICK_AMOUNTS = [20.0, 50.0, 100.0]
MAX_TENDERED_QUICK_AMOUNTS = 8


async def get_pos_settings(session: AsyncSession, company_id: int) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    return _normalize_pos_settings((company.settings or {}).get(POS_SETTINGS_KEY))


async def patch_pos_settings(
    session: AsyncSession, company_id: int, patch: dict[str, Any]
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    current = _normalize_pos_settings((company.settings or {}).get(POS_SETTINGS_KEY))

    if patch.get("allow_out_of_stock") is not None:
        current["allow_out_of_stock"] = bool(patch["allow_out_of_stock"])

    if patch.get("tendered_quick_amounts") is not None:
        current["tendered_quick_amounts"] = _normalize_tendered_quick_amounts(
            patch["tendered_quick_amounts"]
        )

    settings = dict(company.settings or {})
    settings[POS_SETTINGS_KEY] = current
    company.settings = settings
    await session.flush()
    return current


def _normalize_pos_settings(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    return {
        "allow_out_of_stock": bool(data.get("allow_out_of_stock", False)),
        "tendered_quick_amounts": _normalize_tendered_quick_amounts(
            data.get("tendered_quick_amounts")
        ),
    }


def _normalize_tendered_quick_amounts(raw: Any) -> list[float]:
    if not isinstance(raw, list):
        return list(DEFAULT_TENDERED_QUICK_AMOUNTS)

    amounts: list[float] = []
    for item in raw:
        if isinstance(item, bool):
            continue
        if isinstance(item, (int, float)):
            value = float(item)
            if value > 0:
                amounts.append(value)

    if not amounts:
        return list(DEFAULT_TENDERED_QUICK_AMOUNTS)

    return amounts[:MAX_TENDERED_QUICK_AMOUNTS]


async def _get_company(session: AsyncSession, company_id: int) -> Company:
    company = await session.get(Company, company_id)
    if not company:
        raise not_found("Company not found")
    return company
