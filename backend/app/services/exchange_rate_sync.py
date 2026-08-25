from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import AppError, bad_request, not_found
from app.core.regos_api import regos_async_api_request_for_company
from app.models import Company
from app.services.cbu_exchange_rates import CbuRate, fetch_cbu_rates, get_previous_official_rates
from app.services.exchange_rate_formula import apply_formula, validate_formula
from app.services.regos_credentials import get_regos_api_auth
from app.services.regos_defaults import _map_currency_item, fetch_currency_items_by_ids

logger = logging.getLogger("regos.backend")

EXCHANGE_RATE_SYNC_KEY = "exchange_rate_sync"
DEFAULT_FORMULA = "exchange_rate"
RATE_CHANGE_EPSILON = 0.01
SyncRunStatus = Literal["success", "partial", "failed", "skipped"]
RunTrigger = Literal["scheduled", "manual"]


async def get_exchange_rate_sync_settings(
    session: AsyncSession,
    company_id: int,
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    return _normalize_settings((company.settings or {}).get(EXCHANGE_RATE_SYNC_KEY))


async def patch_exchange_rate_sync_settings(
    session: AsyncSession,
    company_id: int,
    patch: dict[str, Any],
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    current = _normalize_settings((company.settings or {}).get(EXCHANGE_RATE_SYNC_KEY))
    updated = _apply_patch(current, patch)

    if updated.get("rules"):
        await _validate_rules_against_regos(session, company_id, updated["rules"])

    settings = dict(company.settings or {})
    settings[EXCHANGE_RATE_SYNC_KEY] = updated
    company.settings = settings
    await session.flush()
    return updated


async def preview_exchange_rate_formula(
    session: AsyncSession,
    company_id: int,
    *,
    formula: str,
    currency_code: str | None = None,
    sample_rate: float | None = None,
) -> dict[str, Any]:
    validate_formula(formula)

    official_rate: float | None = None
    if sample_rate is not None:
        official_rate = sample_rate
    elif currency_code:
        cbu_rates = await fetch_cbu_rates()
        normalized_code = currency_code.strip().upper()
        cbu_rate = cbu_rates.get(normalized_code)
        if cbu_rate is None:
            raise bad_request(
                f"Currency {normalized_code} was not found in CBU rates.",
                "CBU_CURRENCY_NOT_FOUND",
            )
        official_rate = cbu_rate.rate
    else:
        official_rate = 1000.0

    calculated_rate = apply_formula(formula, official_rate)
    return {
        "formula": formula.strip(),
        "currency_code": currency_code.strip().upper() if currency_code else None,
        "official_rate": official_rate,
        "calculated_rate": calculated_rate,
    }


async def sync_exchange_rates_for_company(
    session: AsyncSession,
    company_id: int,
    *,
    trigger: RunTrigger,
    cbu_rates: dict[str, CbuRate] | None = None,
) -> dict[str, Any]:
    settings = await get_exchange_rate_sync_settings(session, company_id)
    if trigger != "manual" and not settings.get("enabled"):
        return {
            "company_id": company_id,
            "trigger": trigger,
            "status": "skipped",
            "message": "Exchange rate sync is disabled.",
            "results": [],
        }

    enabled_rules = [rule for rule in settings.get("rules", []) if rule.get("enabled")]
    if not enabled_rules:
        return await _persist_run_result(
            session,
            company_id,
            settings,
            trigger=trigger,
            status="skipped",
            results=[],
            message="No enabled exchange rate rules configured.",
        )

    try:
        await get_regos_api_auth(session, company_id)
    except AppError as exc:
        return await _persist_run_result(
            session,
            company_id,
            settings,
            trigger=trigger,
            status="failed",
            results=[],
            message=str(exc.detail.get("detail", "Regos token not configured")),
        )

    try:
        if cbu_rates is None:
            cbu_rates = await fetch_cbu_rates()
    except AppError as exc:
        return await _persist_run_result(
            session,
            company_id,
            settings,
            trigger=trigger,
            status="failed",
            results=[],
            message=str(exc.detail.get("detail", "Failed to load cached CBU rates")),
        )

    currency_ids = [
        int(rule["currency_id"])
        for rule in enabled_rules
        if isinstance(rule.get("currency_id"), int) and rule["currency_id"] > 0
    ]
    regos_currencies = await fetch_currency_items_by_ids(session, company_id, currency_ids)
    base_currency = await _fetch_base_currency(session, company_id)
    if base_currency is None:
        return await _persist_run_result(
            session,
            company_id,
            settings,
            trigger=trigger,
            status="failed",
            results=[],
            message="Could not determine REGOS base currency.",
        )
    if not _is_uzs_base_currency(base_currency):
        return await _persist_run_result(
            session,
            company_id,
            settings,
            trigger=trigger,
            status="failed",
            results=[],
            message="Exchange rate sync currently supports only UZS as the base currency.",
        )

    results: list[dict[str, Any]] = []
    for rule in enabled_rules:
        results.append(
            await _sync_single_rule(
                session,
                company_id,
                rule=rule,
                cbu_rates=cbu_rates,
                regos_currencies=regos_currencies,
            )
        )

    status = _aggregate_status(results)
    return await _persist_run_result(
        session,
        company_id,
        settings,
        trigger=trigger,
        status=status,
        results=results,
    )


async def sync_exchange_rates_for_all_companies(
    session: AsyncSession,
    *,
    trigger: RunTrigger = "scheduled",
) -> list[dict[str, Any]]:
    company_ids = await _list_sync_enabled_company_ids(session)
    if not company_ids:
        return []

    try:
        cbu_rates = await fetch_cbu_rates()
    except AppError:
        logger.error("Failed to load cached CBU rates for sync batch", exc_info=True)
        cbu_rates = None

    run_results: list[dict[str, Any]] = []
    for company_id in company_ids:
        try:
            result = await sync_exchange_rates_for_company(
                session,
                company_id,
                trigger=trigger,
                cbu_rates=cbu_rates,
            )
            await session.commit()
            run_results.append(result)
        except Exception:
            await session.rollback()
            logger.error(
                "Exchange rate sync failed for company %s",
                company_id,
                exc_info=True,
            )
            run_results.append(
                {
                    "company_id": company_id,
                    "trigger": trigger,
                    "status": "failed",
                    "message": "Unexpected error during exchange rate sync.",
                    "results": [],
                }
            )
    return run_results


async def _sync_single_rule(
    session: AsyncSession,
    company_id: int,
    *,
    rule: dict[str, Any],
    cbu_rates: dict[str, CbuRate],
    regos_currencies: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    currency_id = rule.get("currency_id")
    currency_code = str(rule.get("currency_code") or "").strip().upper()
    formula = str(rule.get("formula") or DEFAULT_FORMULA).strip() or DEFAULT_FORMULA

    base_result = {
        "currency_id": currency_id,
        "currency_code": currency_code or None,
        "official_rate": None,
        "calculated_rate": None,
        "status": "failed",
        "message": None,
    }

    if not isinstance(currency_id, int) or currency_id <= 0:
        return {**base_result, "message": "Invalid currency id."}
    if not currency_code:
        return {**base_result, "message": "Currency code is required."}

    regos_currency = regos_currencies.get(currency_id)
    if not regos_currency:
        return {**base_result, "message": "Currency not found in REGOS."}
    if regos_currency.get("deleted"):
        return {**base_result, "status": "skipped", "message": "Currency is deleted in REGOS."}
    if regos_currency.get("is_base"):
        return {**base_result, "status": "skipped", "message": "Base currency rate cannot be changed."}

    regos_code = str(regos_currency.get("code_chr") or "").strip().upper()
    if regos_code and regos_code != currency_code:
        return {
            **base_result,
            "message": f"Currency code mismatch: expected {regos_code}, got {currency_code}.",
        }

    cbu_rate = cbu_rates.get(currency_code)
    if cbu_rate is None:
        return {
            **base_result,
            "status": "skipped",
            "message": f"Currency {currency_code} was not found in CBU rates.",
        }

    official_rate = cbu_rate.rate
    try:
        validate_formula(formula)
        calculated_rate = apply_formula(formula, official_rate)
    except AppError as exc:
        return {
            **base_result,
            "official_rate": official_rate,
            "message": str(exc.detail.get("detail", "Invalid formula.")),
        }

    previous_official_rate = get_previous_official_rates().get(currency_code)
    current_rate = regos_currency.get("exchange_rate")
    if (
        previous_official_rate is not None
        and abs(previous_official_rate - official_rate) < RATE_CHANGE_EPSILON
        and isinstance(current_rate, (int, float))
        and abs(float(current_rate) - calculated_rate) < RATE_CHANGE_EPSILON
    ):
        return {
            **base_result,
            "official_rate": official_rate,
            "calculated_rate": calculated_rate,
            "status": "skipped",
            "message": "Exchange rate is already up to date.",
        }

    if isinstance(current_rate, (int, float)):
        if abs(float(current_rate) - calculated_rate) < RATE_CHANGE_EPSILON:
            return {
                **base_result,
                "official_rate": official_rate,
                "calculated_rate": calculated_rate,
                "status": "skipped",
                "message": "Exchange rate is already up to date.",
            }

    try:
        await regos_async_api_request_for_company(
            session,
            company_id,
            "currency/editexchangerate",
            {"id": currency_id, "exchange_rate": calculated_rate},
        )
    except AppError as exc:
        return {
            **base_result,
            "official_rate": official_rate,
            "calculated_rate": calculated_rate,
            "message": str(exc.detail.get("detail", "Failed to update exchange rate in REGOS.")),
        }

    return {
        **base_result,
        "official_rate": official_rate,
        "calculated_rate": calculated_rate,
        "status": "updated",
    }


async def _validate_rules_against_regos(
    session: AsyncSession,
    company_id: int,
    rules: list[dict[str, Any]],
) -> None:
    currency_ids = [
        int(rule["currency_id"])
        for rule in rules
        if isinstance(rule.get("currency_id"), int) and rule["currency_id"] > 0
    ]
    if not currency_ids:
        return

    try:
        await get_regos_api_auth(session, company_id)
    except AppError:
        return

    regos_currencies = await fetch_currency_items_by_ids(session, company_id, currency_ids)
    for index, rule in enumerate(rules):
        currency_id = rule.get("currency_id")
        currency_code = str(rule.get("currency_code") or "").strip().upper()
        if not isinstance(currency_id, int) or currency_id <= 0:
            raise bad_request(
                f"Rule {index + 1} has an invalid currency id.",
                "EXCHANGE_RATE_SYNC_RULE_INVALID",
            )
        if not currency_code:
            raise bad_request(
                f"Rule {index + 1} requires a currency code.",
                "EXCHANGE_RATE_SYNC_RULE_INVALID",
            )

        regos_currency = regos_currencies.get(currency_id)
        if not regos_currency:
            raise bad_request(
                f"Rule {index + 1} references unknown currency id {currency_id}.",
                "EXCHANGE_RATE_SYNC_RULE_INVALID",
            )
        regos_code = str(regos_currency.get("code_chr") or "").strip().upper()
        if regos_code and regos_code != currency_code:
            raise bad_request(
                f"Rule {index + 1} currency code does not match REGOS ({regos_code}).",
                "EXCHANGE_RATE_SYNC_RULE_INVALID",
            )


async def _list_sync_enabled_company_ids(session: AsyncSession) -> list[int]:
    result = await session.execute(
        select(Company)
        .options(selectinload(Company.regos_token))
        .order_by(Company.id.asc())
    )
    company_ids: list[int] = []
    for company in result.scalars().all():
        settings = _normalize_settings((company.settings or {}).get(EXCHANGE_RATE_SYNC_KEY))
        if not settings.get("enabled"):
            continue
        token = company.regos_token
        if not token or not token.integration_token.strip():
            continue
        company_ids.append(company.id)
    return company_ids


async def _persist_run_result(
    session: AsyncSession,
    company_id: int,
    settings: dict[str, Any],
    *,
    trigger: RunTrigger,
    status: SyncRunStatus,
    results: list[dict[str, Any]],
    message: str | None = None,
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    updated_settings = dict(settings)
    updated_settings["last_run_at"] = datetime.now(UTC).isoformat()
    updated_settings["last_run_status"] = status
    updated_settings["last_run_results"] = results
    updated_settings["last_run_trigger"] = trigger
    if message:
        updated_settings["last_run_message"] = message
    else:
        updated_settings.pop("last_run_message", None)

    company_settings = dict(company.settings or {})
    company_settings[EXCHANGE_RATE_SYNC_KEY] = updated_settings
    company.settings = company_settings
    await session.flush()

    return {
        "company_id": company_id,
        "trigger": trigger,
        "status": status,
        "message": message,
        "results": results,
    }


def _aggregate_status(results: list[dict[str, Any]]) -> SyncRunStatus:
    if not results:
        return "failed"
    statuses = {result.get("status") for result in results}
    if statuses == {"updated"} or statuses == {"updated", "skipped"}:
        return "success"
    if "updated" in statuses:
        return "partial"
    if statuses == {"skipped"}:
        return "skipped"
    return "failed"


async def _fetch_base_currency(
    session: AsyncSession,
    company_id: int,
) -> dict[str, Any] | None:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "currency/get",
        {"limit": 10000},
    )
    result = response.get("result") or []
    for row in result:
        if isinstance(row, dict) and row.get("is_base"):
            return _map_currency_item(row)
    return None


def _is_uzs_base_currency(base_currency: dict[str, Any]) -> bool:
    code = str(base_currency.get("code_chr") or "").strip().upper()
    return code in {"UZS", "СУМ", "SUM"}


def _apply_patch(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    updated = dict(current)
    if "enabled" in patch and patch["enabled"] is not None:
        updated["enabled"] = bool(patch["enabled"])
    if "rules" in patch and patch["rules"] is not None:
        updated["rules"] = _normalize_rules(patch["rules"])
    return updated


def _normalize_settings(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {}
    return {
        "enabled": bool(raw.get("enabled", False)),
        "rules": _normalize_rules(raw.get("rules")),
        "last_run_at": raw.get("last_run_at"),
        "last_run_status": raw.get("last_run_status"),
        "last_run_results": _normalize_last_run_results(raw.get("last_run_results")),
        "last_run_trigger": raw.get("last_run_trigger"),
        "last_run_message": raw.get("last_run_message"),
    }


def _normalize_rules(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    rules: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        currency_id = item.get("currency_id")
        if not isinstance(currency_id, int) or currency_id <= 0:
            raise bad_request("Each rule requires a valid currency id.", "EXCHANGE_RATE_SYNC_RULE_INVALID")
        currency_code = str(item.get("currency_code") or "").strip().upper()
        if not currency_code:
            raise bad_request("Each rule requires a currency code.", "EXCHANGE_RATE_SYNC_RULE_INVALID")
        formula = str(item.get("formula") or DEFAULT_FORMULA).strip() or DEFAULT_FORMULA
        validate_formula(formula)
        rules.append(
            {
                "currency_id": currency_id,
                "currency_code": currency_code,
                "formula": formula,
                "enabled": bool(item.get("enabled", True)),
            }
        )
    return rules


def _normalize_last_run_results(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    results: list[dict[str, Any]] = []
    for item in raw:
        if isinstance(item, dict):
            results.append(item)
    return results


async def _get_company(session: AsyncSession, company_id: int) -> Company:
    result = await session.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        raise not_found("Company not found")
    return company
