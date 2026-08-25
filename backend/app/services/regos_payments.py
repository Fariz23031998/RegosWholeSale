"""Standalone REGOS DocPayment list/create/lifecycle operations."""

from __future__ import annotations

import time
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request
from app.services import pos_settings as pos_settings_service
from app.services import regos_defaults as regos_defaults_service
from app.services import regos_payment_types as regos_payment_types_service
from app.services.regos_sales import (
    _add_account_movement,
    _add_payment_document,
    _map_payment_document,
    _parse_document_list_response,
    _regos_call,
    _resolve_payment_category_id,
    _resolve_payment_posting,
)
from app.utils.currency_conversion import parse_exchange_rate

PaymentDirection = Literal["income", "outcome"]


def map_payment_document(item: dict[str, Any]) -> dict[str, Any]:
    mapped = _map_payment_document(item)
    firm = item.get("firm") if isinstance(item.get("firm"), dict) else {}
    payment_type = item.get("type") if isinstance(item.get("type"), dict) else {}
    category = item.get("category") if isinstance(item.get("category"), dict) else {}

    mapped["performed"] = bool(item.get("performed", False))
    mapped["deleted_mark"] = bool(item.get("deleted_mark", False))
    mapped["description"] = (
        str(item["description"]).strip()
        if isinstance(item.get("description"), str) and item["description"].strip()
        else None
    )
    firm_id = firm.get("id")
    mapped["firm_id"] = firm_id if isinstance(firm_id, int) else None
    mapped["firm_name"] = firm.get("name") if isinstance(firm.get("name"), str) else None
    type_id = payment_type.get("id")
    mapped["payment_type_id"] = type_id if isinstance(type_id, int) else None

    direction = _direction_from_item(item, category)
    if direction:
        mapped["payment_direction"] = direction
    return mapped


def _direction_from_item(
    item: dict[str, Any],
    category: dict[str, Any],
) -> PaymentDirection | None:
    raw = item.get("payment_direction")
    if isinstance(raw, str):
        normalized = raw.strip().lower()
        if normalized in {"income", "1"}:
            return "income"
        if normalized in {"outcome", "2"}:
            return "outcome"
    if isinstance(raw, int):
        if raw == 1:
            return "income"
        if raw == 2:
            return "outcome"
    positive = category.get("positive")
    if isinstance(positive, bool):
        return "income" if positive else "outcome"
    return None


def _regos_direction(direction: PaymentDirection) -> str:
    return "Income" if direction == "income" else "Outcome"


async def list_payments(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    *,
    start_date: int | None = None,
    end_date: int | None = None,
    partner_ids: list[int] | None = None,
    all_partners: bool = True,
    firm_ids: list[int] | None = None,
    direction: PaymentDirection | None = None,
    performed: bool | None = None,
    deleted_mark: bool | None = False,
    search: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> dict[str, Any]:
    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=user_id
    )
    partner = defaults.get("partner")

    payload: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "sort_orders": [{"column": "Date", "direction": "desc"}],
    }
    if performed is not None:
        payload["performed"] = performed
    if deleted_mark is not None:
        payload["deleted_mark"] = deleted_mark
    if start_date is not None:
        payload["start_date"] = start_date
    if end_date is not None:
        payload["end_date"] = end_date
    if partner_ids:
        payload["partner_ids"] = partner_ids
    elif not all_partners and isinstance(partner, dict) and partner.get("id"):
        payload["partner_ids"] = [partner["id"]]
    if firm_ids:
        payload["firm_ids"] = firm_ids
    if direction:
        payload["payment_direction"] = _regos_direction(direction)
    if search and search.strip():
        payload["search"] = search.strip()

    response = await _regos_call(session, company_id, "docpayment/get", payload)
    return _parse_document_list_response(response, map_payment_document)


async def get_payment(
    session: AsyncSession,
    company_id: int,
    payment_id: int,
) -> dict[str, Any]:
    response = await _regos_call(
        session,
        company_id,
        "docpayment/get",
        {"ids": [payment_id], "limit": 1},
    )
    result = response.get("result") or []
    if not isinstance(result, list) or not result:
        raise bad_request("Payment document not found.", "PAYMENT_NOT_FOUND")
    first = result[0]
    if not isinstance(first, dict):
        raise bad_request("Payment document not found.", "PAYMENT_NOT_FOUND")
    return map_payment_document(first)


async def create_payment(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    *,
    firm_id: int,
    partner_id: int,
    direction: PaymentDirection,
    payment_type_id: int,
    amount: float,
    exchange_rate: float | None = None,
    category_id: int | None = None,
    description: str | None = None,
    date: int | None = None,
) -> dict[str, Any]:
    amount = round(float(amount), 2)
    if amount <= 0:
        raise bad_request("Payment amount must be greater than zero.", "PAYMENT_INVALID_AMOUNT")

    defaults = await regos_defaults_service.apply_regos_session_overrides(
        session,
        company_id,
        user_id,
        partner_id=partner_id,
    )
    defaults = await regos_defaults_service.enrich_checkout_defaults(
        session, company_id, defaults, refresh=False
    )

    defaults = dict(defaults)
    partner = defaults.get("partner")
    if not isinstance(partner, dict) or int(partner.get("id") or 0) != partner_id:
        defaults["partner"] = {"id": partner_id, "name": str(partner_id)}
    firm = defaults.get("firm")
    if not isinstance(firm, dict) or int(firm.get("id") or 0) != firm_id:
        defaults["firm"] = {"id": firm_id, "name": str(firm_id)}

    if category_id is not None:
        resolved_category_id = category_id
    else:
        resolved_category_id = _resolve_payment_category_id(
            defaults, is_return=(direction == "outcome")
        )

    payment_type = await regos_payment_types_service.get_payment_type_by_id(
        session, company_id, payment_type_id
    )
    payment_currency = payment_type.get("currency")
    payment_rate = parse_exchange_rate(
        exchange_rate
        if exchange_rate is not None
        else (payment_currency.get("exchange_rate") if payment_currency else None)
    )

    pos_settings = await pos_settings_service.get_pos_settings(session, company_id)
    cross_currency_payment_mode = pos_settings.get(
        "cross_currency_payment_mode", "payment_currency"
    )

    document_date = int(date) if date is not None else int(time.time())
    sale_currency = (
        dict(payment_currency)
        if isinstance(payment_currency, dict)
        else {"id": 0, "exchange_rate": payment_rate}
    )
    if exchange_rate is not None:
        sale_currency = {**sale_currency, "exchange_rate": payment_rate}

    posting = await _resolve_payment_posting(
        session,
        company_id,
        selected_payment_type=payment_type,
        sale_currency=sale_currency if isinstance(sale_currency.get("id"), int) else None,
        line_amount_paid=amount,
        sale_rate=payment_rate,
        payment_rate=payment_rate,
        cross_currency_payment_mode=cross_currency_payment_mode,
        tendered=None,
        change=None,
        is_return=(direction == "outcome"),
        source_document_id=0,
        document_date=document_date,
        transfer_description=description,
    )

    payment_doc = await _add_payment_document(
        session,
        company_id,
        defaults,
        source_document_id=None,
        document_type_id=None,
        payment_type_id=posting["payment_type_id"],
        amount=posting["payment_doc_amount"],
        exchange_rate=posting["payment_exchange_rate"],
        category_id=resolved_category_id,
        document_date=document_date,
        description=description or "",
    )
    payment_doc_id = int(payment_doc["id"])
    await _regos_call(session, company_id, "docpayment/perform", {"id": payment_doc_id})

    if posting.get("account_transfer"):
        await _add_account_movement(
            session,
            company_id,
            defaults,
            **posting["account_transfer"],
        )

    return await get_payment(session, company_id, payment_doc_id)


async def edit_payment(
    session: AsyncSession,
    company_id: int,
    payment_id: int,
    body: dict[str, Any],
) -> dict[str, Any]:
    existing = await get_payment(session, company_id, payment_id)
    if existing.get("performed"):
        raise bad_request(
            "Cannot edit a performed payment document.",
            "PAYMENT_EDIT_PERFORMED",
        )

    payload: dict[str, Any] = {"id": payment_id}
    if body.get("date") is not None:
        payload["date"] = int(body["date"])
    if body.get("payment_type_id") is not None:
        payload["type_id"] = int(body["payment_type_id"])
    if body.get("firm_id") is not None:
        payload["firm_id"] = int(body["firm_id"])
    if body.get("partner_id") is not None:
        payload["partner_id"] = int(body["partner_id"])
    if body.get("category_id") is not None:
        payload["category_id"] = int(body["category_id"])
    if body.get("amount") is not None:
        payload["amount"] = round(float(body["amount"]), 2)
    if body.get("exchange_rate") is not None:
        payload["exchange_rate"] = parse_exchange_rate(body["exchange_rate"])
    if "description" in body and body["description"] is not None:
        payload["description"] = str(body["description"])

    if len(payload) == 1:
        raise bad_request("No payment fields to update.", "PAYMENT_EDIT_EMPTY")

    response = await _regos_call(session, company_id, "docpayment/edit", payload)
    _row_affected(response)
    return await get_payment(session, company_id, payment_id)


async def perform_payment(
    session: AsyncSession,
    company_id: int,
    payment_id: int,
) -> dict[str, int]:
    response = await _regos_call(
        session, company_id, "docpayment/perform", {"id": payment_id}
    )
    return {"row_affected": _row_affected(response)}


async def perform_cancel_payment(
    session: AsyncSession,
    company_id: int,
    payment_id: int,
) -> dict[str, int]:
    response = await _regos_call(
        session, company_id, "docpayment/performcancel", {"id": payment_id}
    )
    return {"row_affected": _row_affected(response)}


async def delete_mark_payment(
    session: AsyncSession,
    company_id: int,
    payment_id: int,
) -> dict[str, int]:
    response = await _regos_call(
        session, company_id, "docpayment/deletemark", {"id": payment_id}
    )
    return {"row_affected": _row_affected(response)}


async def delete_payment(
    session: AsyncSession,
    company_id: int,
    payment_id: int,
) -> dict[str, int]:
    existing = await get_payment(session, company_id, payment_id)
    if not existing.get("deleted_mark"):
        raise bad_request(
            "Payment must be marked for deletion before permanent delete.",
            "PAYMENT_DELETE_REQUIRES_MARK",
        )
    response = await _regos_call(
        session, company_id, "docpayment/delete", {"id": payment_id}
    )
    return {"row_affected": _row_affected(response)}


def _row_affected(response: dict[str, Any]) -> int:
    result = response.get("result") or {}
    row_affected = result.get("row_affected") if isinstance(result, dict) else 0
    if not isinstance(row_affected, int) or row_affected < 0:
        return 0
    return row_affected
