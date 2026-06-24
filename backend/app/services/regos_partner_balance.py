from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.regos_api import regos_async_api_request_for_company
from app.services.regos_defaults import _extract_currency_reference, _extract_nested_reference


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
        doc_type_id = document_type_raw.get("id")
        doc_type_name = document_type_raw.get("name")
        if isinstance(doc_type_id, int) and doc_type_id > 0:
            document_type = {
                "id": doc_type_id,
                "name": _coerce_text(doc_type_name) or f"#{doc_type_id}",
            }

    start_amount = _coerce_float(row.get("start_amount"))
    debit = _coerce_float(row.get("debit"))
    credit = _coerce_float(row.get("credit"))
    end_amount = start_amount + debit - credit

    document_id = row.get("document_id")
    mapped: dict[str, Any] = {
        "id": row_id,
        "date": date,
        "document_code": _coerce_text(row.get("document_code")),
        "document_id": document_id if isinstance(document_id, int) and document_id > 0 else None,
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
