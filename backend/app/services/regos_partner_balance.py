from datetime import datetime, time
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.regos_api import regos_async_api_request_for_company
from app.models import Company
from app.services.regos_defaults import _extract_currency_reference, _extract_nested_reference

_FALLBACK_TIMEZONE = "Asia/Tashkent"


async def get_partner_balance(
    session: AsyncSession,
    company_id: int,
    *,
    partner_id: int,
    start_date: int,
    end_date: int,
    firm_id: int | None = None,
    currency_id: int | None = None,
    in_base_currency: bool = False,
) -> dict[str, list[dict[str, Any]]]:
    payload: dict[str, Any] = {
        "partner_id": partner_id,
        "start_date": start_date,
        "end_date": end_date,
    }
    if firm_id is not None and firm_id > 0:
        payload["firm_id"] = firm_id
    if not in_base_currency and currency_id is not None and currency_id > 0:
        payload["currency_id"] = currency_id

    endpoint = (
        "partnerbalance/getinbasecurrency"
        if in_base_currency
        else "partnerbalance/get"
    )
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        endpoint,
        payload,
    )
    result = response.get("result") or []
    rows = [_map_balance_row(row) for row in result if isinstance(row, dict)]
    rows.sort(key=_balance_row_sort_key, reverse=True)
    return {"rows": rows}


def resolve_company_timezone(name: str | None) -> ZoneInfo:
    for candidate in (name, _FALLBACK_TIMEZONE):
        if not isinstance(candidate, str) or not candidate.strip():
            continue
        try:
            return ZoneInfo(candidate.strip())
        except (ZoneInfoNotFoundError, ValueError):
            continue
    return ZoneInfo("UTC")


def company_today_bounds(
    timezone_name: str | None,
    now: datetime | None = None,
) -> tuple[int, int]:
    tz = resolve_company_timezone(timezone_name)
    current = now.astimezone(tz) if now is not None else datetime.now(tz)
    start = datetime.combine(current.date(), time.min, tzinfo=tz)
    end = datetime.combine(current.date(), time(23, 59, 59), tzinfo=tz)
    return int(start.timestamp()), int(end.timestamp())


def extract_partner_debt_lines(rows: list[Any]) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict) or row.get("entity_type") != "Currency":
            continue
        amount = _coerce_float(row.get("end_amount"))
        if amount == 0:
            continue
        currency = row.get("currency") if isinstance(row.get("currency"), dict) else {}
        firm = row.get("firm") if isinstance(row.get("firm"), dict) else {}
        firm_id = firm.get("id")
        currency_id = currency.get("id")
        lines.append(
            {
                "firm_id": firm_id if isinstance(firm_id, int) and firm_id > 0 else None,
                "firm_name": _coerce_text(firm.get("name")),
                "currency_id": currency_id if isinstance(currency_id, int) and currency_id > 0 else None,
                "currency_code": _coerce_text(currency.get("code_chr")),
                "currency_name": _coerce_text(currency.get("name")),
                "exchange_rate": _coerce_positive_float(currency.get("exchange_rate")),
                "amount": amount,
            }
        )
    return lines


async def get_partner_debt(
    session: AsyncSession,
    company_id: int,
    *,
    partner_id: int,
) -> dict[str, list[dict[str, Any]]]:
    result = await session.execute(select(Company.timezone).where(Company.id == company_id))
    timezone_name = result.scalar_one_or_none()
    start_date, end_date = company_today_bounds(timezone_name)
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "partnerbalance/get",
        {
            "partner_id": partner_id,
            "start_date": start_date,
            "end_date": end_date,
            "grouping": True,
            "include_balance_rows": True,
        },
    )
    result_rows = response.get("result") or []
    if not isinstance(result_rows, list):
        result_rows = []
    return {"lines": extract_partner_debt_lines(result_rows)}


def _balance_row_sort_key(row: dict[str, Any]) -> tuple[int, int]:
    date = row.get("date")
    row_id = row.get("id")
    return (
        date if isinstance(date, int) else 0,
        row_id if isinstance(row_id, int) else 0,
    )


def _map_balance_row(row: dict[str, Any]) -> dict[str, Any]:
    row_id = row.get("id")
    if not isinstance(row_id, int) or row_id <= 0:
        row_id = 0

    date = row.get("date")
    if not isinstance(date, int) or date < 0:
        date = 0

    document_type_raw = row.get("document_type")
    document_type = None
    if isinstance(document_type_raw, dict):
        doc_type_id = _coerce_positive_int(document_type_raw.get("id"))
        doc_type_name = document_type_raw.get("name")
        if doc_type_id is not None:
            document_type = {
                "id": doc_type_id,
                "name": _coerce_text(doc_type_name) or f"#{doc_type_id}",
            }

    start_amount = _coerce_float(row.get("start_amount"))
    debit = _coerce_float(row.get("debit"))
    credit = _coerce_float(row.get("credit"))
    end_amount = start_amount + debit - credit

    mapped: dict[str, Any] = {
        "id": row_id,
        "date": date,
        "document_code": _coerce_text(row.get("document_code")),
        "document_id": _coerce_positive_int(row.get("document_id")),
        "document_type": document_type,
        "currency": _extract_currency_reference(row, "currency"),
        "firm": _extract_nested_reference(row, "firm"),
        "exchange_rate": _coerce_positive_float(row.get("exchange_rate")),
        "currency_amount": _coerce_float(row.get("currency_amount")),
        "start_amount": start_amount,
        "debit": debit,
        "credit": credit,
        "end_amount": end_amount,
    }
    return mapped


def _coerce_positive_int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _coerce_float(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _coerce_positive_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _coerce_text(value: Any) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    return None
