import asyncio
import re
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError, bad_request
from app.core.regos_api import regos_async_api_request_for_company
from app.services import regos_defaults as regos_defaults_service
from app.services import regos_fields as regos_fields_service
from app.services import regos_payment_types as regos_payment_types_service
from app.utils.currency_conversion import convert_between_rates, parse_exchange_rate

WHOLESALE_RETURN_SOURCE_PREFIX = "pulse:ws:"
WHOLESALE_RETURN_MANUAL_PREFIX = "pulse:manual"


async def complete_checkout(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    payload: dict[str, Any],
    *,
    allow_regos_overrides: bool = False,
) -> dict[str, Any]:
    session_overrides = _extract_session_overrides(payload, allow_regos_overrides)
    defaults = await regos_defaults_service.apply_regos_session_overrides(
        session,
        company_id,
        user_id,
        **session_overrides,
    )
    defaults = await regos_defaults_service.enrich_checkout_defaults(
        session, company_id, defaults, refresh=True
    )
    regos_defaults_service.validate_checkout_defaults(defaults)

    total = float(payload["total"])
    payments_input = _normalize_checkout_payments(payload, total)

    amount_paid = round(sum(float(payment["amount_paid"]) for payment in payments_input), 2)
    if amount_paid > total + 0.02:
        raise bad_request(
            f"Amount paid {amount_paid} cannot exceed total {total}.",
            "CHECKOUT_AMOUNT_PAID_EXCEEDS_TOTAL",
        )
    if amount_paid < 0:
        raise bad_request("Amount paid cannot be negative.", "CHECKOUT_AMOUNT_PAID_INVALID")

    doc_id: int | None = None
    try:
        doc_id, lines, subtotal, discount, total = await _upsert_wholesale_draft(
            session,
            company_id,
            defaults,
            payload,
            wholesale_doc_id=payload.get("wholesale_doc_id"),
        )

        await _regos_call(session, company_id, "docwholesale/perform", {"id": doc_id})
        wholesale_code = str(doc_id)

        document_type_id = await regos_defaults_service.get_doc_wholesale_document_type_id(
            session, company_id
        )

        payment_doc_id, payment_results, amount_paid, balance_due, is_fully_paid, primary_payment = (
            await _perform_payments(
                session,
                company_id,
                defaults,
                document_id=doc_id,
                document_type_id=document_type_id,
                payments_input=payments_input,
                total=total,
                is_return=False,
            )
        )

        return {
            "wholesale_doc_id": doc_id,
            "wholesale_code": wholesale_code,
            "payment_doc_id": payment_doc_id,
            "performed_at": datetime.now(timezone.utc),
            "lines": lines,
            "payment": primary_payment,
            "payments": payment_results,
            "subtotal": round(subtotal, 2),
            "discount": round(discount, 2),
            "total": total,
            "amount_paid": amount_paid,
            "balance_due": balance_due,
            "is_fully_paid": is_fully_paid,
        }
    except AppError as exc:
        if doc_id is not None and isinstance(exc.detail, dict):
            original = exc.detail.get("detail", "")
            exc.detail = {
                **exc.detail,
                "detail": f"{original} (wholesale_doc_id={doc_id})",
            }
        raise


async def postpone_sale(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    payload: dict[str, Any],
    *,
    allow_regos_overrides: bool = False,
) -> dict[str, Any]:
    session_overrides = _extract_session_overrides(payload, allow_regos_overrides)
    defaults = await regos_defaults_service.apply_regos_session_overrides(
        session,
        company_id,
        user_id,
        **session_overrides,
    )
    defaults = await regos_defaults_service.enrich_checkout_defaults(
        session, company_id, defaults, refresh=True
    )
    regos_defaults_service.validate_checkout_defaults(defaults)

    doc_id: int | None = None
    try:
        doc_id, lines, subtotal, discount, total = await _upsert_wholesale_draft(
            session,
            company_id,
            defaults,
            payload,
            wholesale_doc_id=payload.get("wholesale_doc_id"),
        )
        return {
            "wholesale_doc_id": doc_id,
            "wholesale_code": str(doc_id),
            "lines": lines,
            "subtotal": round(subtotal, 2),
            "discount": round(discount, 2),
            "total": total,
        }
    except AppError as exc:
        if doc_id is not None and isinstance(exc.detail, dict):
            original = exc.detail.get("detail", "")
            exc.detail = {
                **exc.detail,
                "detail": f"{original} (wholesale_doc_id={doc_id})",
            }
        raise


async def list_wholesale_documents(
    session: AsyncSession,
    company_id: int,
    *,
    user_id: int,
    start_date: int | None = None,
    end_date: int | None = None,
    partner_ids: list[int] | None = None,
    all_partners: bool = True,
    stock_ids: list[int] | None = None,
    all_stocks: bool = False,
    performed: bool | None = None,
    offset: int = 0,
    limit: int = 50,
) -> dict[str, Any]:
    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=user_id
    )
    warehouse = defaults.get("warehouse")
    partner = defaults.get("partner")

    payload: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "performed": True if performed is None else performed,
        "deleted_mark": False,
        "sort_orders": [{"column": "Date", "direction": "desc"}],
    }
    if start_date is not None:
        payload["start_date"] = start_date
    if end_date is not None:
        payload["end_date"] = end_date
    if partner_ids:
        payload["partner_ids"] = partner_ids
    elif not all_partners and partner:
        payload["partner_ids"] = [partner["id"]]
    if stock_ids:
        payload["stock_ids"] = stock_ids
    elif not all_stocks and warehouse:
        payload["stock_ids"] = [warehouse["id"]]

    response = await _regos_call(session, company_id, "docwholesale/get", payload)
    raw_items = response.get("result") or []
    documents = [_map_wholesale_document(item) for item in raw_items if isinstance(item, dict)]
    next_offset = int(response.get("next_offset") or 0)
    total = int(response.get("total") or len(documents))
    return {"documents": documents, "next_offset": next_offset, "total": total}


async def list_wholesale_operations(
    session: AsyncSession,
    company_id: int,
    document_id: int,
) -> dict[str, Any]:
    if document_id <= 0:
        raise bad_request("Invalid wholesale document id.", "INVALID_DOCUMENT_ID")
    return await list_wholesale_operations_batch(session, company_id, [document_id])


async def list_wholesale_document_payments(
    session: AsyncSession,
    company_id: int,
    document_id: int,
) -> dict[str, Any]:
    if document_id <= 0:
        raise bad_request("Invalid wholesale document id.", "INVALID_DOCUMENT_ID")

    payload: dict[str, Any] = {
        "performed": True,
        "deleted_mark": False,
        "limit": 100,
        "offset": 0,
    }

    sale_id_field_key = await regos_fields_service.get_doc_payment_sale_id_field_key(
        session, company_id
    )
    if sale_id_field_key:
        payload["filters"] = [
            regos_fields_service.build_doc_payment_sale_id_filter(
                sale_id_field_key,
                document_id,
            )
        ]
    else:
        document_type_id = await regos_defaults_service.get_doc_wholesale_document_type_id(
            session, company_id
        )
        payload["document"] = document_id
        payload["document_type_id"] = document_type_id

    response = await _regos_call(session, company_id, "docpayment/get", payload)
    raw_items = response.get("result") or []
    payments = [_map_payment_document(item) for item in raw_items if isinstance(item, dict)]
    return {"payments": payments}


async def list_wholesale_return_document_payments(
    session: AsyncSession,
    company_id: int,
    document_id: int,
) -> dict[str, Any]:
    if document_id <= 0:
        raise bad_request("Invalid wholesale return document id.", "INVALID_DOCUMENT_ID")

    payload: dict[str, Any] = {
        "performed": True,
        "deleted_mark": False,
        "limit": 100,
        "offset": 0,
    }

    sale_id_field_key = await regos_fields_service.get_doc_payment_sale_id_field_key(
        session, company_id
    )
    if sale_id_field_key:
        payload["filters"] = [
            regos_fields_service.build_doc_payment_sale_id_filter(
                sale_id_field_key,
                document_id,
            )
        ]
    else:
        document_type_id = await regos_defaults_service.get_doc_wholesale_return_document_type_id(
            session, company_id
        )
        payload["document"] = document_id
        payload["document_type_id"] = document_type_id

    response = await _regos_call(session, company_id, "docpayment/get", payload)
    raw_items = response.get("result") or []
    payments = [_map_payment_document(item) for item in raw_items if isinstance(item, dict)]
    return {"payments": payments}


async def list_wholesale_operations_batch(
    session: AsyncSession,
    company_id: int,
    document_ids: list[int],
) -> dict[str, Any]:
    unique_ids = sorted({doc_id for doc_id in document_ids if doc_id > 0})
    if not unique_ids:
        return {"operations": []}
    if len(unique_ids) > 200:
        raise bad_request(
            "Cannot fetch operations for more than 200 documents at once.",
            "TOO_MANY_DOCUMENT_IDS",
        )

    semaphore = asyncio.Semaphore(10)

    async def fetch_one(document_id: int) -> list[dict[str, Any]]:
        async with semaphore:
            response = await _regos_call(
                session,
                company_id,
                "wholesaleoperation/get",
                {"document_ids": [document_id], "limit": 1000, "offset": 0},
            )
            raw_items = response.get("result") or []
            return [
                _map_wholesale_operation(item)
                for item in raw_items
                if isinstance(item, dict)
            ]

    batches = await asyncio.gather(*(fetch_one(document_id) for document_id in unique_ids))
    operations = [operation for batch in batches for operation in batch]
    return {"operations": operations}


async def list_payment_documents(
    session: AsyncSession,
    company_id: int,
    *,
    user_id: int,
    start_date: int | None = None,
    end_date: int | None = None,
    partner_ids: list[int] | None = None,
    all_partners: bool = True,
    stock_ids: list[int] | None = None,
    all_stocks: bool = False,
    offset: int = 0,
    limit: int = 50,
) -> dict[str, Any]:
    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=user_id
    )
    warehouse = defaults.get("warehouse")
    partner = defaults.get("partner")

    payload: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "performed": True,
        "deleted_mark": False,
        "sort_orders": [{"column": "Date", "direction": "desc"}],
    }
    if start_date is not None:
        payload["start_date"] = start_date
    if end_date is not None:
        payload["end_date"] = end_date
    if partner_ids:
        payload["partner_ids"] = partner_ids
    elif not all_partners and partner:
        payload["partner_ids"] = [partner["id"]]
    if stock_ids:
        payload["stock_ids"] = stock_ids
    elif not all_stocks and warehouse:
        payload["stock_ids"] = [warehouse["id"]]

    response = await _regos_call(session, company_id, "docpayment/get", payload)
    raw_items = response.get("result") or []
    documents = [_map_payment_document(item) for item in raw_items if isinstance(item, dict)]
    next_offset = int(response.get("next_offset") or 0)
    total = int(response.get("total") or len(documents))
    return {"documents": documents, "next_offset": next_offset, "total": total}


async def list_wholesale_return_documents(
    session: AsyncSession,
    company_id: int,
    *,
    user_id: int,
    start_date: int | None = None,
    end_date: int | None = None,
    partner_ids: list[int] | None = None,
    all_partners: bool = True,
    stock_ids: list[int] | None = None,
    all_stocks: bool = False,
    offset: int = 0,
    limit: int = 50,
) -> dict[str, Any]:
    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=user_id
    )
    warehouse = defaults.get("warehouse")
    partner = defaults.get("partner")

    payload: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "performed": True,
        "deleted_mark": False,
        "sort_orders": [{"column": "Date", "direction": "desc"}],
    }
    if start_date is not None:
        payload["start_date"] = start_date
    if end_date is not None:
        payload["end_date"] = end_date
    if partner_ids:
        payload["partner_ids"] = partner_ids
    elif not all_partners and partner:
        payload["partner_ids"] = [partner["id"]]
    if stock_ids:
        payload["stock_ids"] = stock_ids
    elif not all_stocks and warehouse:
        payload["stock_ids"] = [warehouse["id"]]

    response = await _regos_call(session, company_id, "docwholesalereturn/get", payload)
    raw_items = response.get("result") or []
    documents = [
        _map_wholesale_return_document(item) for item in raw_items if isinstance(item, dict)
    ]
    next_offset = int(response.get("next_offset") or 0)
    total = int(response.get("total") or len(documents))
    return {"documents": documents, "next_offset": next_offset, "total": total}


async def list_wholesale_return_operations(
    session: AsyncSession,
    company_id: int,
    document_id: int,
) -> dict[str, Any]:
    if document_id <= 0:
        raise bad_request("Invalid wholesale return document id.", "INVALID_DOCUMENT_ID")
    return await list_wholesale_return_operations_batch(session, company_id, [document_id])


async def list_wholesale_return_operations_batch(
    session: AsyncSession,
    company_id: int,
    document_ids: list[int],
) -> dict[str, Any]:
    unique_ids = sorted({doc_id for doc_id in document_ids if doc_id > 0})
    if not unique_ids:
        return {"operations": []}
    if len(unique_ids) > 200:
        raise bad_request(
            "Cannot fetch operations for more than 200 return documents at once.",
            "TOO_MANY_DOCUMENT_IDS",
        )

    semaphore = asyncio.Semaphore(10)

    async def fetch_one(document_id: int) -> list[dict[str, Any]]:
        async with semaphore:
            response = await _regos_call(
                session,
                company_id,
                "wholesalereturnoperation/get",
                {"document_ids": [document_id], "limit": 1000, "offset": 0},
            )
            raw_items = response.get("result") or []
            return [
                _map_wholesale_return_operation(item)
                for item in raw_items
                if isinstance(item, dict)
            ]

    batches = await asyncio.gather(*(fetch_one(document_id) for document_id in unique_ids))
    operations = [operation for batch in batches for operation in batch]
    return {"operations": operations}


async def get_wholesale_return_summary(
    session: AsyncSession,
    company_id: int,
    wholesale_doc_id: int,
    *,
    user_id: int,
) -> dict[str, Any]:
    if wholesale_doc_id <= 0:
        raise bad_request("Invalid wholesale document id.", "INVALID_DOCUMENT_ID")

    returns = await list_wholesale_return_documents(
        session,
        company_id,
        user_id=user_id,
        limit=200,
    )
    matching = [
        doc
        for doc in returns["documents"]
        if _parse_wholesale_doc_id_from_description(doc.get("description")) == wholesale_doc_id
    ]

    returned_by_item: dict[int, float] = {}
    for doc in matching:
        ops = await list_wholesale_return_operations(session, company_id, int(doc["id"]))
        for op in ops["operations"]:
            item_id = int(op["item_id"])
            returned_by_item[item_id] = returned_by_item.get(item_id, 0) + float(op["quantity"])

    items = [
        {"item_id": item_id, "returned_qty": round(qty, 4)}
        for item_id, qty in sorted(returned_by_item.items())
    ]
    return {"wholesale_doc_id": wholesale_doc_id, "items": items}


async def complete_wholesale_return(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    payload: dict[str, Any],
    *,
    allow_regos_overrides: bool = False,
) -> dict[str, Any]:
    raw_wholesale_doc_id = payload.get("wholesale_doc_id")
    wholesale_doc_id = int(raw_wholesale_doc_id) if raw_wholesale_doc_id is not None else None
    items = payload["items"]
    reason = payload.get("reason")
    total = float(payload["total"])
    is_manual = wholesale_doc_id is None

    if not items:
        raise bad_request("Return must include at least one item.", "RETURN_EMPTY")

    session_overrides = _extract_return_overrides(
        payload, allow_regos_overrides, is_sale_linked=not is_manual
    )
    partner_override_id = session_overrides.pop("partner_id", None)

    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=user_id
    )
    if session_overrides:
        defaults = await regos_defaults_service.apply_regos_session_overrides(
            session,
            company_id,
            user_id,
            **session_overrides,
        )
    defaults = await regos_defaults_service.enrich_checkout_defaults(
        session, company_id, defaults, refresh=True
    )
    if partner_override_id is not None:
        current_partner_id = defaults.get("partner", {}).get("id")
        if current_partner_id != partner_override_id:
            defaults = await regos_defaults_service.apply_regos_session_overrides(
                session,
                company_id,
                user_id,
                partner_id=partner_override_id,
            )
            defaults = await regos_defaults_service.enrich_checkout_defaults(
                session, company_id, defaults, refresh=True
            )
    regos_defaults_service.validate_checkout_defaults(defaults)

    payments_input = _normalize_checkout_payments(payload, total)
    amount_paid = round(sum(float(payment["amount_paid"]) for payment in payments_input), 2)
    if amount_paid > total + 0.02:
        raise bad_request(
            f"Refund amount {amount_paid} cannot exceed total {total}.",
            "RETURN_AMOUNT_PAID_EXCEEDS_TOTAL",
        )
    if amount_paid < 0:
        raise bad_request("Refund amount cannot be negative.", "RETURN_AMOUNT_PAID_INVALID")

    lines: list[dict[str, Any]] = []
    expected_total = 0.0

    if is_manual:
        for item in items:
            item_id = int(item["regos_item_id"])
            qty = float(item["qty"])
            if qty <= 0:
                raise bad_request("Return quantity must be greater than zero.", "RETURN_QTY_INVALID")
            if item.get("price") is None:
                raise bad_request(
                    f"Price is required for manual return item {item_id}.",
                    "RETURN_PRICE_REQUIRED",
                )
            price = float(item["price"])
            expected_total += qty * price
            lines.append(
                {
                    "regos_item_id": item_id,
                    "qty": qty,
                    "price": price,
                    "price2": price,
                }
            )
        return_description = _build_manual_return_description(reason)
    else:
        assert wholesale_doc_id is not None
        if wholesale_doc_id <= 0:
            raise bad_request("Invalid wholesale document id.", "INVALID_DOCUMENT_ID")

        sale_ops = await list_wholesale_operations(session, company_id, wholesale_doc_id)
        sold_by_item = {
            int(op["item_id"]): op for op in sale_ops["operations"] if int(op["item_id"]) > 0
        }
        if not sold_by_item:
            raise bad_request("Wholesale sale has no line items.", "WHOLESALE_SALE_EMPTY")

        summary = await get_wholesale_return_summary(
            session, company_id, wholesale_doc_id, user_id=user_id
        )
        already_returned = {
            int(item["item_id"]): float(item["returned_qty"]) for item in summary["items"]
        }

        for item in items:
            item_id = int(item["regos_item_id"])
            qty = float(item["qty"])
            if qty <= 0:
                raise bad_request("Return quantity must be greater than zero.", "RETURN_QTY_INVALID")

            sale_line = sold_by_item.get(item_id)
            if sale_line is None:
                raise bad_request(
                    f"Item {item_id} is not part of wholesale sale {wholesale_doc_id}.",
                    "RETURN_ITEM_NOT_IN_SALE",
                )

            sold_qty = float(sale_line["quantity"])
            returned_qty = already_returned.get(item_id, 0)
            remaining = sold_qty - returned_qty
            if qty > remaining + 0.0001:
                raise bad_request(
                    f"Return quantity {qty} exceeds remaining {remaining} for item {item_id}.",
                    "RETURN_QTY_EXCEEDS_REMAINING",
                )

            price = float(sale_line["price"])
            price2 = float(sale_line["price2"] if sale_line.get("price2") is not None else price)
            expected_total += qty * price
            lines.append(
                {
                    "regos_item_id": item_id,
                    "qty": qty,
                    "price": price,
                    "price2": price2,
                }
            )
        return_description = _build_return_description(wholesale_doc_id, reason)

    expected_total = round(expected_total, 2)
    if abs(expected_total - total) > 0.02:
        raise bad_request(
            f"Return total {total} does not match expected {expected_total}.",
            "RETURN_TOTAL_MISMATCH",
        )

    doc_id: int | None = None
    try:
        return_doc = await _add_wholesale_return_document(
            session,
            company_id,
            defaults,
            description=return_description,
        )
        doc_id = int(return_doc["id"])

        await _regos_call(session, company_id, "docwholesalereturn/lock", {"ids": [doc_id]})
        try:
            await _add_wholesale_return_operations(session, company_id, doc_id, lines)
        finally:
            await _regos_call(session, company_id, "docwholesalereturn/unlock", {"ids": [doc_id]})

        performed_doc = await _regos_call(
            session, company_id, "docwholesalereturn/perform", {"id": doc_id}
        )
        return_code = _extract_code(performed_doc, doc_id)

        return_document_type_id = (
            await regos_defaults_service.get_doc_wholesale_return_document_type_id(
                session, company_id
            )
        )
        payment_doc_id, payment_results, amount_paid, balance_due, is_fully_paid, primary_payment = (
            await _perform_payments(
                session,
                company_id,
                defaults,
                document_id=doc_id,
                document_type_id=return_document_type_id,
                payments_input=payments_input,
                total=total,
                is_return=True,
            )
        )

        return {
            "wholesale_return_doc_id": doc_id,
            "wholesale_return_code": return_code,
            "wholesale_doc_id": wholesale_doc_id,
            "performed_at": datetime.now(timezone.utc),
            "lines": lines,
            "total": total,
            "reason": reason.strip() if isinstance(reason, str) and reason.strip() else None,
            "payment_doc_id": payment_doc_id,
            "payment": primary_payment,
            "payments": payment_results,
            "amount_paid": amount_paid,
            "balance_due": balance_due,
            "is_fully_paid": is_fully_paid,
        }
    except AppError as exc:
        if doc_id is not None and isinstance(exc.detail, dict):
            original = exc.detail.get("detail", "")
            exc.detail = {
                **exc.detail,
                "detail": f"{original} (wholesale_return_doc_id={doc_id})",
            }
        raise


def _normalize_checkout_payments(payload: dict[str, Any], total: float) -> list[dict[str, Any]]:
    raw_payments = payload.get("payments")
    if isinstance(raw_payments, list) and raw_payments:
        return [
            {
                "payment_type_id": int(payment["payment_type_id"]),
                "amount_paid": float(payment["amount_paid"]),
                "tendered": payment.get("tendered"),
                "change": payment.get("change"),
            }
            for payment in raw_payments
        ]

    payment_type_id = int(payload["payment_type_id"])
    amount_paid_raw = payload.get("amount_paid")
    return [
        {
            "payment_type_id": payment_type_id,
            "amount_paid": float(amount_paid_raw if amount_paid_raw is not None else total),
            "tendered": payload.get("tendered"),
            "change": payload.get("change"),
        }
    ]


def _validate_checkout_cart(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], float, float, float]:
    items = payload["items"]
    discount = float(payload.get("discount") or 0)
    total = float(payload["total"])

    subtotal = sum(float(item["qty"]) * float(item["price"]) for item in items)
    if subtotal <= 0:
        raise bad_request("Cart subtotal must be greater than zero.", "CHECKOUT_EMPTY")

    lines = _build_operation_lines(items, discount, subtotal)
    expected_total = round(subtotal - discount, 2)
    if abs(expected_total - total) > 0.02:
        raise bad_request(
            f"Checkout total {total} does not match expected {expected_total}.",
            "CHECKOUT_TOTAL_MISMATCH",
        )
    return lines, subtotal, discount, total


async def _upsert_wholesale_draft(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    payload: dict[str, Any],
    *,
    wholesale_doc_id: int | None = None,
) -> tuple[int, list[dict[str, Any]], float, float, float]:
    lines, subtotal, discount, total = _validate_checkout_cart(payload)
    description = payload.get("description")
    raw_doc_id = wholesale_doc_id if wholesale_doc_id is not None else payload.get("wholesale_doc_id")
    existing_doc_id = int(raw_doc_id) if raw_doc_id is not None else None

    if existing_doc_id is not None:
        if existing_doc_id <= 0:
            raise bad_request("Invalid wholesale document id.", "INVALID_DOCUMENT_ID")
        doc_id = existing_doc_id
        await _regos_call(session, company_id, "docwholesale/lock", {"ids": [doc_id]})
        try:
            await _sync_wholesale_operations(session, company_id, doc_id, lines)
        finally:
            await _regos_call(session, company_id, "docwholesale/unlock", {"ids": [doc_id]})
        return doc_id, lines, subtotal, discount, total

    wholesale_doc = await _add_wholesale_document(session, company_id, defaults, description)
    doc_id = int(wholesale_doc["id"])

    await _regos_call(session, company_id, "docwholesale/lock", {"ids": [doc_id]})
    try:
        await _add_wholesale_operations(session, company_id, doc_id, lines)
    finally:
        await _regos_call(session, company_id, "docwholesale/unlock", {"ids": [doc_id]})

    return doc_id, lines, subtotal, discount, total


def _build_operation_lines(
    items: list[dict[str, Any]], discount: float, subtotal: float
) -> list[dict[str, Any]]:
    discount_ratio = (discount / subtotal) if subtotal > 0 and discount > 0 else 0
    lines: list[dict[str, Any]] = []
    for item in items:
        qty = float(item["qty"])
        original_price = float(item["price"])
        discounted_price = round(original_price * (1 - discount_ratio), 2)
        lines.append(
            {
                "regos_item_id": int(item["regos_item_id"]),
                "qty": qty,
                "price": discounted_price,
                "price2": original_price,
            }
        )
    return lines


def _merge_desired_wholesale_lines(
    lines: list[dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    merged: dict[int, dict[str, Any]] = {}
    for line in lines:
        item_id = int(line["regos_item_id"])
        qty = float(line["qty"])
        if item_id in merged:
            merged[item_id]["qty"] += qty
            continue
        merged[item_id] = {
            "regos_item_id": item_id,
            "qty": qty,
            "price": float(line["price"]),
            "price2": float(line["price2"]),
        }
    return merged


async def _sync_wholesale_operations(
    session: AsyncSession,
    company_id: int,
    document_id: int,
    lines: list[dict[str, Any]],
) -> None:
    existing = await list_wholesale_operations(session, company_id, document_id)
    existing_by_item: dict[int, dict[str, Any]] = {}
    for operation in existing.get("operations", []):
        if not isinstance(operation, dict):
            continue
        operation_id = int(operation.get("id") or 0)
        item_id = int(operation.get("item_id") or 0)
        if operation_id <= 0 or item_id <= 0:
            continue
        existing_by_item[item_id] = operation

    desired_by_item = _merge_desired_wholesale_lines(lines)

    edits: list[dict[str, Any]] = []
    for item_id, line in desired_by_item.items():
        existing_operation = existing_by_item.get(item_id)
        if existing_operation is None:
            continue
        edits.append(
            {
                "id": int(existing_operation["id"]),
                "quantity": line["qty"],
                "price": line["price"],
                "price2": line["price2"],
            }
        )

    delete_payload = [
        {"id": int(existing_operation["id"])}
        for item_id, existing_operation in existing_by_item.items()
        if item_id not in desired_by_item
    ]

    add_lines = [
        line for item_id, line in desired_by_item.items() if item_id not in existing_by_item
    ]

    if edits:
        await _regos_call(session, company_id, "wholesaleoperation/edit", edits)
    if delete_payload:
        await _regos_call(session, company_id, "wholesaleoperation/delete", delete_payload)
    if add_lines:
        await _add_wholesale_operations(session, company_id, document_id, add_lines)


async def _add_wholesale_document(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    description: str | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "date": int(time.time()),
        "partner_id": defaults["partner"]["id"],
        "stock_id": defaults["warehouse"]["id"],
        "currency_id": defaults["currency"]["id"],
        "price_type_id": defaults["price_type"]["id"],
        "vat_calculation_type": defaults.get(
            "vat_calculation_type", regos_defaults_service.DEFAULT_VAT_CALCULATION_TYPE
        ),
    }
    attached_user = defaults.get("attached_user")
    if attached_user:
        payload["attached_user_id"] = attached_user["id"]
    if description:
        payload["description"] = description

    response = await _regos_call(session, company_id, "docwholesale/add", payload)
    return _extract_new_document(response)


async def _add_wholesale_operations(
    session: AsyncSession,
    company_id: int,
    document_id: int,
    lines: list[dict[str, Any]],
) -> None:
    operations = [
        {
            "document_id": document_id,
            "item_id": line["regos_item_id"],
            "quantity": line["qty"],
            "price": line["price"],
            "price2": line["price2"],
        }
        for line in lines
    ]
    await _regos_call(session, company_id, "wholesaleoperation/add", operations)


async def _add_wholesale_return_document(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    *,
    description: str,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "date": int(time.time()),
        "partner_id": defaults["partner"]["id"],
        "stock_id": defaults["warehouse"]["id"],
        "currency_id": defaults["currency"]["id"],
        "vat_calculation_type": defaults.get(
            "vat_calculation_type", regos_defaults_service.DEFAULT_VAT_CALCULATION_TYPE
        ),
        "description": description,
    }
    attached_user = defaults.get("attached_user")
    if attached_user:
        payload["attached_user_id"] = attached_user["id"]

    response = await _regos_call(session, company_id, "docwholesalereturn/add", payload)
    return _extract_new_document(response)


async def _add_wholesale_return_operations(
    session: AsyncSession,
    company_id: int,
    document_id: int,
    lines: list[dict[str, Any]],
) -> None:
    operations = [
        {
            "document_id": document_id,
            "item_id": line["regos_item_id"],
            "quantity": line["qty"],
            "price": line["price"],
            "price2": line["price2"],
        }
        for line in lines
    ]
    await _regos_call(session, company_id, "wholesalereturnoperation/add", operations)


async def _add_payment_document(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    *,
    source_document_id: int,
    document_type_id: int,
    payment_type_id: int,
    amount: float,
    exchange_rate: float,
    category_id: int,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type_id": payment_type_id,
        "document": source_document_id,
        "document_type_id": document_type_id,
        "firm_id": defaults["firm"]["id"],
        "partner_id": defaults["partner"]["id"],
        "category_id": category_id,
        "amount": amount,
        "exchange_rate": exchange_rate,
        "description": str(source_document_id),
    }
    attached_user = defaults.get("attached_user")
    if attached_user:
        payload["attached_user_id"] = attached_user["id"]

    sale_id_fields = await regos_fields_service.build_doc_payment_sale_id_fields(
        session,
        company_id,
        source_document_id=source_document_id,
    )
    if sale_id_fields:
        payload["fields"] = sale_id_fields

    response = await _regos_call(session, company_id, "docpayment/add", payload)
    return _extract_new_document(response)


async def _regos_call(
    session: AsyncSession,
    company_id: int,
    endpoint: str,
    payload: dict | list,
) -> dict[str, Any]:
    response = await regos_async_api_request_for_company(
        session, company_id, endpoint, payload
    )
    return response


def _extract_new_document(response: dict[str, Any]) -> dict[str, Any]:
    result = response.get("result")
    if isinstance(result, dict) and result.get("new_id"):
        return {"id": int(result["new_id"]), "code": result.get("code")}
    if isinstance(result, list) and result:
        first = result[0]
        if isinstance(first, dict) and first.get("new_id"):
            return {"id": int(first["new_id"]), "code": first.get("code")}
    raise bad_request("Regos did not return a new document id.", "REGOS_DOCUMENT_CREATE_FAILED")


def _extract_code(response: dict[str, Any], doc_id: int) -> str:
    result = response.get("result")
    if isinstance(result, dict):
        code = result.get("code")
        if isinstance(code, str) and code.strip():
            return code.strip()
    return str(doc_id)


def _extract_session_overrides(
    payload: dict[str, Any], allow_regos_overrides: bool
) -> dict[str, int]:
    if not allow_regos_overrides:
        return {}

    overrides: dict[str, int] = {}
    for key in ("warehouse_id", "price_type_id", "partner_id"):
        value = payload.get(key)
        if value is not None:
            overrides[key] = int(value)
    return overrides


def _extract_return_overrides(
    payload: dict[str, Any],
    allow_regos_overrides: bool,
    *,
    is_sale_linked: bool,
) -> dict[str, int]:
    overrides = _extract_session_overrides(payload, allow_regos_overrides)
    if is_sale_linked and payload.get("partner_id") is not None:
        overrides["partner_id"] = int(payload["partner_id"])
    return overrides


async def _perform_payments(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    *,
    document_id: int,
    document_type_id: int,
    payments_input: list[dict[str, Any]],
    total: float,
    is_return: bool = False,
) -> tuple[int | None, list[dict[str, Any]], float, float, bool, dict[str, Any]]:
    amount_paid = round(sum(float(payment["amount_paid"]) for payment in payments_input), 2)
    balance_due = round(max(total - amount_paid, 0), 2)
    is_fully_paid = balance_due <= 0.01
    category_id = _resolve_payment_category_id(defaults, is_return=is_return)

    payment_doc_id: int | None = None
    sale_currency = defaults.get("currency")
    payment_results: list[dict[str, Any]] = []

    for payment_input in payments_input:
        line_amount_paid = round(float(payment_input["amount_paid"]), 2)
        if line_amount_paid <= 0:
            continue

        payment_type_id = int(payment_input["payment_type_id"])
        tendered = payment_input.get("tendered")
        change = payment_input.get("change")
        payment_type = await regos_payment_types_service.get_payment_type_by_id(
            session, company_id, payment_type_id
        )
        payment_currency = payment_type.get("currency")

        sale_rate = parse_exchange_rate(
            sale_currency.get("exchange_rate") if sale_currency else None
        )
        payment_rate = parse_exchange_rate(
            payment_currency.get("exchange_rate") if payment_currency else None
        )
        payment_doc_amount = convert_between_rates(line_amount_paid, sale_rate, payment_rate)
        payment_doc = await _add_payment_document(
            session,
            company_id,
            defaults,
            source_document_id=document_id,
            document_type_id=document_type_id,
            payment_type_id=payment_type_id,
            amount=payment_doc_amount,
            exchange_rate=payment_rate,
            category_id=category_id,
        )
        line_payment_doc_id = int(payment_doc["id"])
        await _regos_call(
            session, company_id, "docpayment/perform", {"id": line_payment_doc_id}
        )
        if payment_doc_id is None:
            payment_doc_id = line_payment_doc_id

        payment_results.append(
            {
                "payment_type_id": payment_type_id,
                "payment_doc_id": line_payment_doc_id,
                "amount": line_amount_paid,
                "amount_paid": line_amount_paid,
                "balance_due": balance_due,
                "is_fully_paid": is_fully_paid,
                "tendered": tendered,
                "change": change,
                "sale_currency": sale_currency,
                "payment_currency": payment_currency,
                "payment_amount": payment_doc_amount,
            }
        )

    if payment_results:
        primary_payment: dict[str, Any] = {
            **payment_results[0],
            "amount": total,
            "amount_paid": amount_paid,
            "balance_due": balance_due,
            "is_fully_paid": is_fully_paid,
        }
    else:
        first_payment_type_id = int(payments_input[0]["payment_type_id"])
        first_payment_type = await regos_payment_types_service.get_payment_type_by_id(
            session, company_id, first_payment_type_id
        )
        primary_payment = {
            "payment_type_id": first_payment_type_id,
            "payment_doc_id": None,
            "amount": total,
            "amount_paid": amount_paid,
            "balance_due": balance_due,
            "is_fully_paid": is_fully_paid,
            "tendered": payments_input[0].get("tendered"),
            "change": payments_input[0].get("change"),
            "sale_currency": sale_currency,
            "payment_currency": first_payment_type.get("currency"),
            "payment_amount": None,
        }

    return payment_doc_id, payment_results, amount_paid, balance_due, is_fully_paid, primary_payment


def _build_return_description(wholesale_doc_id: int, reason: str | None) -> str:
    base = f"{WHOLESALE_RETURN_SOURCE_PREFIX}{wholesale_doc_id}"
    if isinstance(reason, str) and reason.strip():
        return f"{base}|{reason.strip()}"
    return base


def _build_manual_return_description(reason: str | None) -> str:
    base = WHOLESALE_RETURN_MANUAL_PREFIX
    if isinstance(reason, str) and reason.strip():
        return f"{base}|{reason.strip()}"
    return base


def _parse_wholesale_doc_id_from_description(description: str | None) -> int | None:
    if not isinstance(description, str) or not description.strip():
        return None
    match = re.match(rf"^{re.escape(WHOLESALE_RETURN_SOURCE_PREFIX)}(\d+)", description.strip())
    if not match:
        return None
    return int(match.group(1))


def _resolve_payment_category_id(defaults: dict[str, Any], *, is_return: bool) -> int:
    if is_return:
        refund_category = defaults.get("refund_payment_category")
        if isinstance(refund_category, dict) and refund_category.get("id"):
            return int(refund_category["id"])
    payment_category = defaults.get("payment_category")
    if not isinstance(payment_category, dict) or not payment_category.get("id"):
        raise bad_request(
            "Regos payment category is not configured.",
            "REGOS_PAYMENT_CATEGORY_NOT_CONFIGURED",
        )
    return int(payment_category["id"])


def _map_payment_document(item: dict[str, Any]) -> dict[str, Any]:
    partner = item.get("partner") if isinstance(item.get("partner"), dict) else {}
    category = item.get("category") if isinstance(item.get("category"), dict) else {}
    payment_type = item.get("type") if isinstance(item.get("type"), dict) else {}
    return {
        "id": int(item.get("id") or 0),
        "code": str(item.get("code") or item.get("id") or ""),
        "date": int(item.get("date") or 0),
        "amount": float(item["amount"]) if item.get("amount") is not None else None,
        "category_id": category.get("id") if isinstance(category.get("id"), int) else None,
        "category_name": category.get("name") if isinstance(category.get("name"), str) else None,
        "payment_type_name": payment_type.get("name")
        if isinstance(payment_type.get("name"), str)
        else None,
        "partner_id": partner.get("id") if isinstance(partner.get("id"), int) else None,
        "partner_name": partner.get("name") if isinstance(partner.get("name"), str) else None,
    }


def _attached_user_fields(item: dict[str, Any]) -> tuple[int | None, str | None]:
    attached_user = item.get("attached_user")
    if not isinstance(attached_user, dict):
        attached_user = item.get("user")
    if not isinstance(attached_user, dict):
        return None, None

    user_id = attached_user.get("id")
    if not isinstance(user_id, int):
        return None, None

    full_name = attached_user.get("full_name")
    if isinstance(full_name, str) and full_name.strip():
        return user_id, full_name.strip()

    parts = [
        part
        for part in (attached_user.get("first_name"), attached_user.get("last_name"))
        if isinstance(part, str) and part.strip()
    ]
    if parts:
        return user_id, " ".join(parts)

    name = attached_user.get("name")
    if isinstance(name, str) and name.strip():
        return user_id, name.strip()

    return user_id, f"#{user_id}"


def _map_wholesale_document(item: dict[str, Any]) -> dict[str, Any]:
    partner = item.get("partner") if isinstance(item.get("partner"), dict) else {}
    stock = item.get("stock") if isinstance(item.get("stock"), dict) else {}
    attached_user_id, attached_user_name = _attached_user_fields(item)
    return {
        "id": int(item.get("id") or 0),
        "code": str(item.get("code") or item.get("id") or ""),
        "date": int(item.get("date") or 0),
        "partner_id": partner.get("id") if isinstance(partner.get("id"), int) else None,
        "partner_name": partner.get("name") if isinstance(partner.get("name"), str) else None,
        "stock_id": stock.get("id") if isinstance(stock.get("id"), int) else None,
        "stock_name": stock.get("name") if isinstance(stock.get("name"), str) else None,
        "attached_user_id": attached_user_id,
        "attached_user_name": attached_user_name,
        "amount": float(item["amount"]) if item.get("amount") is not None else None,
        "performed": bool(item.get("performed", False)),
    }


def _map_wholesale_return_document(item: dict[str, Any]) -> dict[str, Any]:
    partner = item.get("partner") if isinstance(item.get("partner"), dict) else {}
    stock = item.get("stock") if isinstance(item.get("stock"), dict) else {}
    attached_user_id, attached_user_name = _attached_user_fields(item)
    description = item.get("description") if isinstance(item.get("description"), str) else None
    wholesale_doc_id = _parse_wholesale_doc_id_from_description(description)
    reason: str | None = None
    if description and "|" in description:
        reason = description.split("|", 1)[1].strip() or None
    return {
        "id": int(item.get("id") or 0),
        "code": str(item.get("code") or item.get("id") or ""),
        "date": int(item.get("date") or 0),
        "partner_id": partner.get("id") if isinstance(partner.get("id"), int) else None,
        "partner_name": partner.get("name") if isinstance(partner.get("name"), str) else None,
        "stock_id": stock.get("id") if isinstance(stock.get("id"), int) else None,
        "stock_name": stock.get("name") if isinstance(stock.get("name"), str) else None,
        "attached_user_id": attached_user_id,
        "attached_user_name": attached_user_name,
        "amount": float(item["amount"]) if item.get("amount") is not None else None,
        "performed": bool(item.get("performed", False)),
        "description": description,
        "wholesale_doc_id": wholesale_doc_id,
        "reason": reason,
    }


def _map_wholesale_return_operation(item: dict[str, Any]) -> dict[str, Any]:
    return _map_wholesale_operation(item)


def _map_wholesale_operation(item: dict[str, Any]) -> dict[str, Any]:
    product = item.get("item") if isinstance(item.get("item"), dict) else {}
    qty = item.get("quantity", item.get("qty", 0))
    price = item.get("price", 0)
    price2 = item.get("price2")
    amount = item.get("amount")
    if amount is None and qty is not None and price is not None:
        amount = float(qty) * float(price)
    last_purchase_cost = item.get("last_purchase_cost")
    return {
        "id": int(item.get("id") or 0),
        "document_id": int(item.get("document_id") or 0),
        "item_id": int(product.get("id") or item.get("item_id") or 0),
        "item_code": str(product.get("code") or "") or None,
        "item_name": product.get("name") if isinstance(product.get("name"), str) else None,
        "quantity": float(qty or 0),
        "price": float(price or 0),
        "price2": float(price2) if price2 is not None else None,
        "amount": float(amount) if amount is not None else None,
        "last_purchase_cost": float(last_purchase_cost)
        if last_purchase_cost is not None
        else None,
    }
