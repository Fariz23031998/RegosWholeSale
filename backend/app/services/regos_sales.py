import asyncio
import re
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError, bad_request, forbidden
from app.core.regos_api import regos_async_api_request_for_company
from app.core.regos_batch import regos_batch_request_chunks_for_company, regos_batch_request_for_company
from app.services import pos_settings as pos_settings_service
from app.services import regos_defaults as regos_defaults_service
from app.services.regos_defaults import _extract_currency_reference, _normalize_option
from app.services import regos_fields as regos_fields_service
from app.services import regos_payment_linking as regos_payment_linking_service
from app.services import regos_payment_types as regos_payment_types_service
from app.services import regos_products as regos_products_service
from app.regos.doc_order_from_partner_statuses import (
    DOC_ORDER_FROM_PARTNER_CONTINUABLE_STATUS_IDS,
    DOC_ORDER_FROM_PARTNER_DEFAULT_STATUS_ID,
    DOC_ORDER_FROM_PARTNER_STATUS_FINISHED,
)
from app.utils.currency_conversion import convert_between_rates, parse_exchange_rate, same_currency

WHOLESALE_RETURN_SOURCE_PREFIX = "pulse:ws:"
WHOLESALE_RETURN_MANUAL_PREFIX = "pulse:manual"


async def complete_checkout(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    payload: dict[str, Any],
    *,
    permissions: set[str] | None = None,
) -> dict[str, Any]:
    perms = permissions or set()
    _validate_sale_restrictions(payload, perms)
    session_overrides = _extract_session_overrides(payload, perms)
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

    pos_settings = await pos_settings_service.get_effective_pos_settings(
        session, user_id, company_id
    )
    cross_currency_payment_mode = pos_settings.get(
        "cross_currency_payment_mode", "payment_currency"
    )

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
        await _validate_cart_item_prices(
            session,
            company_id,
            user_id,
            payload,
            session_overrides,
            permissions=perms,
        )
        doc_id, lines, subtotal, discount, total = await _upsert_wholesale_draft(
            session,
            company_id,
            defaults,
            payload,
            wholesale_doc_id=payload.get("wholesale_doc_id"),
            payments_input=payments_input,
        )

        document_type_id = await regos_defaults_service.get_doc_wholesale_document_type_id(
            session, company_id
        )
        linking_settings = await regos_payment_linking_service.get_payment_linking_settings(
            session, company_id
        )
        use_description_linking = linking_settings["mode"] == "document_description"
        sale_date, payment_dates = _allocate_checkout_dates(
            payment_count=_positive_payment_count(payments_input)
        )

        if use_description_linking:
            await _set_source_document_date(
                session, company_id, doc_id, sale_date, is_return=False
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
                    payment_dates=payment_dates,
                    defer_perform=True,
                    cross_currency_payment_mode=cross_currency_payment_mode,
                )
            )
            if payment_results:
                await regos_payment_linking_service.link_payments_to_source_document(
                    session,
                    company_id,
                    source_document_id=doc_id,
                    is_return=False,
                    payment_doc_ids=[result["payment_doc_id"] for result in payment_results],
                )
            await _regos_call(session, company_id, "docwholesale/perform", {"id": doc_id})
            if payment_results:
                await _perform_payment_documents(
                    session,
                    company_id,
                    [result["payment_doc_id"] for result in payment_results],
                )
                await _perform_pending_account_transfers(
                    session, company_id, defaults, payment_results
                )
        else:
            await _set_source_document_date(
                session, company_id, doc_id, sale_date, is_return=False
            )
            await _regos_call(session, company_id, "docwholesale/perform", {"id": doc_id})
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
                    payment_dates=payment_dates,
                    cross_currency_payment_mode=cross_currency_payment_mode,
                )
            )

        order_from_partner_doc_id = payload.get("order_from_partner_doc_id")
        if (
            order_from_partner_doc_id is not None
            and pos_settings.get("postpone_document_type", "doc_wholesale")
            == "doc_order_from_partner"
        ):
            await _finish_order_from_partner_document(
                session, company_id, int(order_from_partner_doc_id)
            )

        wholesale_code = str(doc_id)

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
    permissions: set[str] | None = None,
) -> dict[str, Any]:
    perms = permissions or set()
    _validate_sale_restrictions(payload, perms)
    session_overrides = _extract_session_overrides(payload, perms)
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
    document_type = "doc_wholesale"
    try:
        await _validate_cart_item_prices(
            session,
            company_id,
            user_id,
            payload,
            session_overrides,
            permissions=perms,
        )
        company_pos = await pos_settings_service.get_pos_settings(session, company_id)
        postpone_doc_type = company_pos.get("postpone_document_type", "doc_wholesale")
        if postpone_doc_type == "doc_order_from_partner":
            document_type = "doc_order_from_partner"
            doc_id, lines, subtotal, discount, total = await _upsert_order_from_partner_draft(
                session,
                company_id,
                defaults,
                payload,
                wholesale_doc_id=payload.get("wholesale_doc_id"),
                booked=bool(company_pos.get("postpone_order_booked", True)),
            )
        else:
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
            "document_type": document_type,
        }
    except AppError as exc:
        if doc_id is not None and isinstance(exc.detail, dict):
            original = exc.detail.get("detail", "")
            exc.detail = {
                **exc.detail,
                "detail": f"{original} (wholesale_doc_id={doc_id})",
            }
        raise


async def _build_filtered_document_list_payload(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    *,
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
    return payload


async def _build_order_document_list_payload(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    *,
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
    return payload


def _parse_document_list_response(
    response: dict[str, Any],
    mapper: Any,
) -> dict[str, Any]:
    raw_items = response.get("result") or []
    documents = [mapper(item) for item in raw_items if isinstance(item, dict)]
    next_offset = int(response.get("next_offset") or 0)
    total = int(response.get("total") or len(documents))
    return {"documents": documents, "next_offset": next_offset, "total": total}


async def fetch_period_document_lists_batch(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    *,
    start_date: int | None = None,
    end_date: int | None = None,
    partner_ids: list[int] | None = None,
    all_partners: bool = True,
    stock_ids: list[int] | None = None,
    all_stocks: bool = True,
    limit: int = 200,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    payload = await _build_filtered_document_list_payload(
        session,
        company_id,
        user_id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
        limit=limit,
    )
    responses = await regos_batch_request_for_company(
        session,
        company_id,
        [
            {"key": "sales", "path": "docwholesale/get", "payload": payload},
            {"key": "returns", "path": "docwholesalereturn/get", "payload": payload},
            {"key": "payments", "path": "docpayment/get", "payload": payload},
        ],
    )
    return (
        _parse_document_list_response(responses["sales"], _map_wholesale_document),
        _parse_document_list_response(responses["returns"], _map_wholesale_return_document),
        _parse_document_list_response(responses["payments"], _map_payment_document),
    )


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
    payload = await _build_filtered_document_list_payload(
        session,
        company_id,
        user_id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
        performed=performed,
        offset=offset,
        limit=limit,
    )

    response = await _regos_call(session, company_id, "docwholesale/get", payload)
    return _parse_document_list_response(response, _map_wholesale_document)


async def list_order_from_partner_documents(
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
    continuable_only: bool = False,
) -> dict[str, Any]:
    payload = await _build_order_document_list_payload(
        session,
        company_id,
        user_id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
        offset=offset,
        limit=limit,
    )

    response = await _regos_call(session, company_id, "docorderfrompartner/get", payload)
    data = _parse_document_list_response(response, _map_order_from_partner_document)
    if continuable_only:
        documents = [
            document
            for document in data["documents"]
            if document.get("status_id") in DOC_ORDER_FROM_PARTNER_CONTINUABLE_STATUS_IDS
        ]
        data["documents"] = documents
        data["total"] = len(documents)
    return data


async def list_wholesale_operations(
    session: AsyncSession,
    company_id: int,
    document_id: int,
) -> dict[str, Any]:
    if document_id <= 0:
        raise bad_request("Invalid wholesale document id.", "INVALID_DOCUMENT_ID")
    return await list_wholesale_operations_batch(session, company_id, [document_id])


async def list_order_from_partner_operations(
    session: AsyncSession,
    company_id: int,
    document_id: int,
) -> dict[str, Any]:
    if document_id <= 0:
        raise bad_request("Invalid order document id.", "INVALID_DOCUMENT_ID")
    return await list_order_from_partner_operations_batch(session, company_id, [document_id])


async def list_wholesale_document_payments(
    session: AsyncSession,
    company_id: int,
    document_id: int,
) -> dict[str, Any]:
    if document_id <= 0:
        raise bad_request("Invalid wholesale document id.", "INVALID_DOCUMENT_ID")

    raw_items = await regos_payment_linking_service.list_payments_for_source_document(
        session,
        company_id,
        source_document_id=document_id,
        is_return=False,
    )
    payments = [_map_payment_document(item) for item in raw_items if isinstance(item, dict)]
    return {"payments": payments}


async def list_wholesale_return_document_payments(
    session: AsyncSession,
    company_id: int,
    document_id: int,
) -> dict[str, Any]:
    if document_id <= 0:
        raise bad_request("Invalid wholesale return document id.", "INVALID_DOCUMENT_ID")

    raw_items = await regos_payment_linking_service.list_payments_for_source_document(
        session,
        company_id,
        source_document_id=document_id,
        is_return=True,
    )
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

    if len(unique_ids) == 1:
        document_id = unique_ids[0]
        response = await _regos_call(
            session,
            company_id,
            "wholesaleoperation/get",
            {"document_ids": [document_id], "limit": 1000, "offset": 0},
        )
        raw_items = response.get("result") or []
        operations = [
            _map_wholesale_operation(item)
            for item in raw_items
            if isinstance(item, dict)
        ]
        return {"operations": operations}

    steps = [
        {
            "key": f"doc_{document_id}",
            "path": "wholesaleoperation/get",
            "payload": {"document_ids": [document_id], "limit": 1000, "offset": 0},
        }
        for document_id in unique_ids
    ]
    responses = await regos_batch_request_chunks_for_company(session, company_id, steps)
    operations: list[dict[str, Any]] = []
    for document_id in unique_ids:
        response = responses[f"doc_{document_id}"]
        raw_items = response.get("result") or []
        operations.extend(
            _map_wholesale_operation(item)
            for item in raw_items
            if isinstance(item, dict)
        )
    return {"operations": operations}


async def list_order_from_partner_operations_batch(
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

    if len(unique_ids) == 1:
        document_id = unique_ids[0]
        response = await _regos_call(
            session,
            company_id,
            "orderfrompartneroperation/get",
            {"document_ids": [document_id], "limit": 1000, "offset": 0},
        )
        raw_items = response.get("result") or []
        operations = [
            _map_wholesale_operation(item)
            for item in raw_items
            if isinstance(item, dict)
        ]
        return {"operations": operations}

    steps = [
        {
            "key": f"doc_{document_id}",
            "path": "orderfrompartneroperation/get",
            "payload": {"document_ids": [document_id], "limit": 1000, "offset": 0},
        }
        for document_id in unique_ids
    ]
    responses = await regos_batch_request_chunks_for_company(session, company_id, steps)
    operations: list[dict[str, Any]] = []
    for document_id in unique_ids:
        response = responses[f"doc_{document_id}"]
        raw_items = response.get("result") or []
        operations.extend(
            _map_wholesale_operation(item)
            for item in raw_items
            if isinstance(item, dict)
        )
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
    payload = await _build_filtered_document_list_payload(
        session,
        company_id,
        user_id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
        performed=True,
        offset=offset,
        limit=limit,
    )

    response = await _regos_call(session, company_id, "docpayment/get", payload)
    return _parse_document_list_response(response, _map_payment_document)


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
    payload = await _build_filtered_document_list_payload(
        session,
        company_id,
        user_id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
        performed=True,
        offset=offset,
        limit=limit,
    )

    response = await _regos_call(session, company_id, "docwholesalereturn/get", payload)
    return _parse_document_list_response(response, _map_wholesale_return_document)


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

    if len(unique_ids) == 1:
        document_id = unique_ids[0]
        response = await _regos_call(
            session,
            company_id,
            "wholesalereturnoperation/get",
            {"document_ids": [document_id], "limit": 1000, "offset": 0},
        )
        raw_items = response.get("result") or []
        operations = [
            _map_wholesale_return_operation(item)
            for item in raw_items
            if isinstance(item, dict)
        ]
        return {"operations": operations}

    steps = [
        {
            "key": f"doc_{document_id}",
            "path": "wholesalereturnoperation/get",
            "payload": {"document_ids": [document_id], "limit": 1000, "offset": 0},
        }
        for document_id in unique_ids
    ]
    responses = await regos_batch_request_chunks_for_company(session, company_id, steps)
    operations: list[dict[str, Any]] = []
    for document_id in unique_ids:
        response = responses[f"doc_{document_id}"]
        raw_items = response.get("result") or []
        operations.extend(
            _map_wholesale_return_operation(item)
            for item in raw_items
            if isinstance(item, dict)
        )
    return {"operations": operations}


async def fetch_period_operations_batch(
    session: AsyncSession,
    company_id: int,
    document_ids: list[int],
    return_document_ids: list[int],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sale_ids = sorted({doc_id for doc_id in document_ids if doc_id > 0})
    return_ids = sorted({doc_id for doc_id in return_document_ids if doc_id > 0})
    if len(sale_ids) > 200 or len(return_ids) > 200:
        raise bad_request(
            "Cannot fetch operations for more than 200 documents at once.",
            "TOO_MANY_DOCUMENT_IDS",
        )

    steps = [
        {
            "key": f"sale_{document_id}",
            "path": "wholesaleoperation/get",
            "payload": {"document_ids": [document_id], "limit": 1000, "offset": 0},
        }
        for document_id in sale_ids
    ]
    steps.extend(
        {
            "key": f"return_{document_id}",
            "path": "wholesalereturnoperation/get",
            "payload": {"document_ids": [document_id], "limit": 1000, "offset": 0},
        }
        for document_id in return_ids
    )
    if not steps:
        return [], []

    if len(steps) == 1:
        step = steps[0]
        response = await _regos_call(session, company_id, step["path"], step["payload"])
        raw_items = response.get("result") or []
        if step["key"].startswith("sale_"):
            operations = [
                _map_wholesale_operation(item)
                for item in raw_items
                if isinstance(item, dict)
            ]
            return operations, []
        return_operations = [
            _map_wholesale_return_operation(item)
            for item in raw_items
            if isinstance(item, dict)
        ]
        return [], return_operations

    responses = await regos_batch_request_chunks_for_company(session, company_id, steps)
    operations: list[dict[str, Any]] = []
    return_operations: list[dict[str, Any]] = []

    for document_id in sale_ids:
        response = responses[f"sale_{document_id}"]
        raw_items = response.get("result") or []
        operations.extend(
            _map_wholesale_operation(item)
            for item in raw_items
            if isinstance(item, dict)
        )

    for document_id in return_ids:
        response = responses[f"return_{document_id}"]
        raw_items = response.get("result") or []
        return_operations.extend(
            _map_wholesale_return_operation(item)
            for item in raw_items
            if isinstance(item, dict)
        )

    return operations, return_operations


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


async def _fetch_wholesale_document_by_id(
    session: AsyncSession,
    company_id: int,
    document_id: int,
) -> dict[str, Any]:
    response = await _regos_call(session, company_id, "docwholesale/get", {"ids": [document_id]})
    result = response.get("result")
    if isinstance(result, list) and result:
        document = result[0]
        if isinstance(document, dict):
            return document
    if isinstance(result, dict) and result.get("id"):
        return result
    raise bad_request(
        f"Wholesale sale {document_id} was not found.",
        "WHOLESALE_DOCUMENT_NOT_FOUND",
    )


async def _apply_source_wholesale_document_defaults(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    source_document: dict[str, Any],
) -> dict[str, Any]:
    updated = dict(defaults)

    currency = _extract_currency_reference(source_document, "currency")
    if currency:
        updated["currency"] = currency

    price_type = _normalize_option(source_document.get("price_type"))
    if price_type:
        updated["price_type"] = price_type
    elif currency and isinstance(currency.get("id"), int):
        matched = await regos_defaults_service.find_price_type_for_currency(
            session,
            company_id,
            int(currency["id"]),
        )
        if matched:
            updated["price_type"] = matched

    stock = source_document.get("stock")
    if isinstance(stock, dict):
        warehouse = _normalize_option(stock)
        if warehouse:
            updated["warehouse"] = warehouse

    return updated


async def complete_wholesale_return(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    payload: dict[str, Any],
    *,
    permissions: set[str] | None = None,
) -> dict[str, Any]:
    perms = permissions or set()
    raw_wholesale_doc_id = payload.get("wholesale_doc_id")
    wholesale_doc_id = int(raw_wholesale_doc_id) if raw_wholesale_doc_id is not None else None
    items = payload["items"]
    reason = payload.get("reason")
    total = float(payload["total"])
    is_manual = wholesale_doc_id is None

    if not items:
        raise bad_request("Return must include at least one item.", "RETURN_EMPTY")

    session_overrides = _extract_return_overrides(
        payload, perms, is_sale_linked=not is_manual
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

    pos_settings = await pos_settings_service.get_effective_pos_settings(
        session, user_id, company_id
    )
    cross_currency_payment_mode = pos_settings.get(
        "cross_currency_payment_mode", "payment_currency"
    )

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
            prices = wholesale_operation_price_fields(
                price,
                price,
                currency=defaults.get("currency"),
            )
            lines.append(
                {
                    "regos_item_id": item_id,
                    "qty": qty,
                    **prices,
                }
            )
        return_description = _build_manual_return_description(reason)
    else:
        assert wholesale_doc_id is not None
        if wholesale_doc_id <= 0:
            raise bad_request("Invalid wholesale document id.", "INVALID_DOCUMENT_ID")

        source_document = await _fetch_wholesale_document_by_id(
            session, company_id, wholesale_doc_id
        )
        defaults = await _apply_source_wholesale_document_defaults(
            session, company_id, defaults, source_document
        )
        sale_currency = defaults.get("currency")

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
            operative_price = operative_operation_price(
                price,
                price2,
                sale_currency,
            )
            expected_total += qty * operative_price
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

        return_document_type_id = (
            await regos_defaults_service.get_doc_wholesale_return_document_type_id(
                session, company_id
            )
        )
        linking_settings = await regos_payment_linking_service.get_payment_linking_settings(
            session, company_id
        )
        use_description_linking = linking_settings["mode"] == "document_description"
        return_date, payment_dates = _allocate_checkout_dates(
            payment_count=_positive_payment_count(payments_input)
        )

        if use_description_linking:
            await _set_source_document_date(
                session, company_id, doc_id, return_date, is_return=True
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
                    payment_dates=payment_dates,
                    defer_perform=True,
                    cross_currency_payment_mode=cross_currency_payment_mode,
                )
            )
            if payment_results:
                await regos_payment_linking_service.link_payments_to_source_document(
                    session,
                    company_id,
                    source_document_id=doc_id,
                    is_return=True,
                    payment_doc_ids=[result["payment_doc_id"] for result in payment_results],
                )
            performed_doc = await _regos_call(
                session, company_id, "docwholesalereturn/perform", {"id": doc_id}
            )
            if payment_results:
                await _perform_payment_documents(
                    session,
                    company_id,
                    [result["payment_doc_id"] for result in payment_results],
                )
                await _perform_pending_account_transfers(
                    session, company_id, defaults, payment_results
                )
        else:
            await _set_source_document_date(
                session, company_id, doc_id, return_date, is_return=True
            )
            performed_doc = await _regos_call(
                session, company_id, "docwholesalereturn/perform", {"id": doc_id}
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
                    payment_dates=payment_dates,
                    cross_currency_payment_mode=cross_currency_payment_mode,
                )
            )

        return_code = _extract_code(performed_doc, doc_id)

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


def _validate_checkout_cart(
    payload: dict[str, Any],
    *,
    document_currency: dict[str, Any] | None = None,
    source_currency: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], float, float, float]:
    items = payload["items"]
    discount = float(payload.get("discount") or 0)
    total = float(payload["total"])

    subtotal = sum(float(item["qty"]) * float(item["price"]) for item in items)
    if subtotal <= 0:
        raise bad_request("Cart subtotal must be greater than zero.", "CHECKOUT_EMPTY")

    lines = _build_operation_lines(
        items,
        discount,
        subtotal,
        document_currency=document_currency,
        source_currency=source_currency,
    )
    expected_total = round(subtotal - discount, 2)
    if abs(expected_total - total) > 0.02:
        raise bad_request(
            f"Checkout total {total} does not match expected {expected_total}.",
            "CHECKOUT_TOTAL_MISMATCH",
        )
    return lines, subtotal, discount, total


async def _resolve_wholesale_document_defaults(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    payments_input: list[dict[str, Any]] | None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    del session, company_id, payments_input
    return defaults, None


async def _upsert_wholesale_draft(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    payload: dict[str, Any],
    *,
    wholesale_doc_id: int | None = None,
    payments_input: list[dict[str, Any]] | None = None,
) -> tuple[int, list[dict[str, Any]], float, float, float]:
    document_defaults, source_currency = await _resolve_wholesale_document_defaults(
        session,
        company_id,
        defaults,
        payments_input,
    )
    lines, subtotal, discount, total = _validate_checkout_cart(
        payload,
        document_currency=document_defaults.get("currency"),
        source_currency=source_currency,
    )
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

    wholesale_doc = await _add_wholesale_document(
        session, company_id, document_defaults, description
    )
    doc_id = int(wholesale_doc["id"])

    await _regos_call(session, company_id, "docwholesale/lock", {"ids": [doc_id]})
    try:
        await _add_wholesale_operations(session, company_id, doc_id, lines)
    finally:
        await _regos_call(session, company_id, "docwholesale/unlock", {"ids": [doc_id]})

    return doc_id, lines, subtotal, discount, total


async def _upsert_order_from_partner_draft(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    payload: dict[str, Any],
    *,
    wholesale_doc_id: int | None = None,
    booked: bool = True,
) -> tuple[int, list[dict[str, Any]], float, float, float]:
    lines, subtotal, discount, total = _validate_checkout_cart(
        payload,
        document_currency=defaults.get("currency"),
        source_currency=None,
    )
    description = payload.get("description")
    raw_doc_id = wholesale_doc_id if wholesale_doc_id is not None else payload.get("wholesale_doc_id")
    existing_doc_id = int(raw_doc_id) if raw_doc_id is not None else None

    if existing_doc_id is not None:
        if existing_doc_id <= 0:
            raise bad_request("Invalid order document id.", "INVALID_DOCUMENT_ID")
        doc_id = existing_doc_id
        await _regos_call(session, company_id, "docorderfrompartner/lock", {"ids": [doc_id]})
        try:
            await _sync_order_from_partner_operations(session, company_id, doc_id, lines)
        finally:
            await _regos_call(session, company_id, "docorderfrompartner/unlock", {"ids": [doc_id]})
        return doc_id, lines, subtotal, discount, total

    order_doc = await _add_order_from_partner_document(
        session, company_id, defaults, description, booked=booked
    )
    doc_id = int(order_doc["id"])

    await _regos_call(session, company_id, "docorderfrompartner/lock", {"ids": [doc_id]})
    try:
        await _add_order_from_partner_operations(session, company_id, doc_id, lines)
    finally:
        await _regos_call(session, company_id, "docorderfrompartner/unlock", {"ids": [doc_id]})

    return doc_id, lines, subtotal, discount, total


def operative_operation_price(
    price: float,
    price2: float | None,
    currency: dict[str, Any] | None,
) -> float:
    del price2, currency
    return price


def wholesale_operation_price_fields(
    actual_price: float,
    list_price: float,
    *,
    currency: dict[str, Any] | None = None,
) -> dict[str, float]:
    del currency
    return {"price": actual_price, "price2": list_price}


def _build_operation_lines(
    items: list[dict[str, Any]],
    discount: float,
    subtotal: float,
    *,
    document_currency: dict[str, Any] | None = None,
    source_currency: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    discount_ratio = (discount / subtotal) if subtotal > 0 and discount > 0 else 0
    document_rate = parse_exchange_rate(
        document_currency.get("exchange_rate") if document_currency else None
    )
    if source_currency:
        source_rate = parse_exchange_rate(source_currency.get("exchange_rate"))
    else:
        source_rate = document_rate
    convert_prices = (
        source_currency is not None
        and document_currency is not None
        and not same_currency(source_currency, document_currency)
    )

    lines: list[dict[str, Any]] = []
    for item in items:
        qty = float(item["qty"])
        list_price = float(item["price"])
        actual_price = round(list_price * (1 - discount_ratio), 2)
        if convert_prices:
            list_price = convert_between_rates(list_price, source_rate, document_rate)
            actual_price = convert_between_rates(actual_price, source_rate, document_rate)
        if actual_price <= 0 and list_price > 0:
            actual_price = list_price
        prices = wholesale_operation_price_fields(
            actual_price,
            list_price,
            currency=document_currency,
        )
        lines.append(
            {
                "regos_item_id": int(item["regos_item_id"]),
                "qty": qty,
                **prices,
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


async def _sync_order_from_partner_operations(
    session: AsyncSession,
    company_id: int,
    document_id: int,
    lines: list[dict[str, Any]],
) -> None:
    existing = await list_order_from_partner_operations(session, company_id, document_id)
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
        await _regos_call(session, company_id, "orderfrompartneroperation/edit", edits)
    if delete_payload:
        await _regos_call(session, company_id, "orderfrompartneroperation/delete", delete_payload)
    if add_lines:
        await _add_order_from_partner_operations(session, company_id, document_id, add_lines)


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
    currency = defaults.get("currency")
    if isinstance(currency, dict):
        exchange_rate = parse_exchange_rate(currency.get("exchange_rate"))
        if exchange_rate != 1.0:
            payload["exchange_rate"] = exchange_rate
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


async def _add_order_from_partner_document(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    description: str | None,
    *,
    booked: bool = True,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "date": int(time.time()),
        "partner_id": defaults["partner"]["id"],
        "stock_id": defaults["warehouse"]["id"],
        "currency_id": defaults["currency"]["id"],
        "status_id": DOC_ORDER_FROM_PARTNER_DEFAULT_STATUS_ID,
        "vat_calculation_type": defaults.get(
            "vat_calculation_type", regos_defaults_service.DEFAULT_VAT_CALCULATION_TYPE
        ),
        "booked": booked,
    }
    currency = defaults.get("currency")
    if isinstance(currency, dict):
        exchange_rate = parse_exchange_rate(currency.get("exchange_rate"))
        if exchange_rate != 1.0:
            payload["exchange_rate"] = exchange_rate
    attached_user = defaults.get("attached_user")
    if attached_user:
        payload["attached_user_id"] = attached_user["id"]
    if description:
        payload["description"] = description

    response = await _regos_call(session, company_id, "docorderfrompartner/add", payload)
    return _extract_new_document(response)


async def _finish_order_from_partner_document(
    session: AsyncSession,
    company_id: int,
    doc_id: int,
) -> None:
    if doc_id <= 0:
        raise bad_request("Invalid order document id.", "INVALID_DOCUMENT_ID")
    await _regos_call(session, company_id, "docorderfrompartner/lock", {"ids": [doc_id]})
    try:
        await _regos_call(
            session,
            company_id,
            "docorderfrompartner/edit",
            {"id": doc_id, "status_id": DOC_ORDER_FROM_PARTNER_STATUS_FINISHED},
        )
    finally:
        await _regos_call(session, company_id, "docorderfrompartner/unlock", {"ids": [doc_id]})


async def _add_order_from_partner_operations(
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
    await _regos_call(session, company_id, "orderfrompartneroperation/add", operations)


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
    price_type = defaults.get("price_type")
    if isinstance(price_type, dict) and price_type.get("id"):
        payload["price_type_id"] = price_type["id"]
    currency = defaults.get("currency")
    if isinstance(currency, dict):
        exchange_rate = parse_exchange_rate(currency.get("exchange_rate"))
        if exchange_rate != 1.0:
            payload["exchange_rate"] = exchange_rate
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
    document_date: int,
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
        "date": document_date,
    }
    attached_user = defaults.get("attached_user")
    if attached_user:
        payload["attached_user_id"] = attached_user["id"]

    linking_settings = await regos_payment_linking_service.get_payment_linking_settings(
        session, company_id
    )
    if linking_settings["mode"] == "sale_id_field":
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


def _validate_sale_restrictions(payload: dict[str, Any], permissions: set[str]) -> None:
    discount = float(payload.get("discount") or 0)
    if discount > 0 and "pos.apply_discount" not in permissions:
        raise forbidden("Missing permission: pos.apply_discount", "FORBIDDEN")


async def _validate_cart_item_prices(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    payload: dict[str, Any],
    session_overrides: dict[str, int],
    *,
    permissions: set[str],
) -> None:
    if "pos.modify_price" in permissions:
        return

    items = payload.get("items") or []
    if not items:
        return

    product_ids = [int(item["regos_item_id"]) for item in items]
    catalog_products = await regos_products_service.get_products_by_ids(
        session,
        company_id,
        user_id,
        product_ids,
        warehouse_id=session_overrides.get("warehouse_id"),
        price_type_id=session_overrides.get("price_type_id"),
    )
    catalog_by_id = {int(product["regos_item_id"]): float(product.get("price") or 0) for product in catalog_products}

    for item in items:
        item_id = int(item["regos_item_id"])
        submitted_price = round(float(item["price"]), 2)
        catalog_price = round(catalog_by_id.get(item_id, submitted_price), 2)
        if abs(submitted_price - catalog_price) > 0.02:
            raise forbidden("Missing permission: pos.modify_price", "FORBIDDEN")


def _extract_session_overrides(
    payload: dict[str, Any], permissions: set[str]
) -> dict[str, int]:
    overrides: dict[str, int] = {}
    if "pos.change_warehouse" in permissions:
        value = payload.get("warehouse_id")
        if value is not None:
            overrides["warehouse_id"] = int(value)
    if "pos.change_price_type" in permissions:
        value = payload.get("price_type_id")
        if value is not None:
            overrides["price_type_id"] = int(value)
    if "pos.change_partner" in permissions:
        value = payload.get("partner_id")
        if value is not None:
            overrides["partner_id"] = int(value)
    return overrides


def _extract_return_overrides(
    payload: dict[str, Any],
    permissions: set[str],
    *,
    is_sale_linked: bool,
) -> dict[str, int]:
    overrides = _extract_session_overrides(payload, permissions)
    if is_sale_linked:
        overrides.pop("price_type_id", None)
        overrides.pop("warehouse_id", None)
    if is_sale_linked and payload.get("partner_id") is not None and "pos.change_partner" in permissions:
        overrides["partner_id"] = int(payload["partner_id"])
    return overrides


def _positive_payment_count(payments_input: list[dict[str, Any]]) -> int:
    return sum(
        1
        for payment in payments_input
        if round(float(payment["amount_paid"]), 2) > 0
    )


def _allocate_checkout_dates(*, payment_count: int) -> tuple[int, list[int]]:
    sale_date = int(time.time())
    payment_dates = [sale_date + 1 + index for index in range(payment_count)]
    return sale_date, payment_dates


async def _set_source_document_date(
    session: AsyncSession,
    company_id: int,
    document_id: int,
    date: int,
    *,
    is_return: bool,
) -> None:
    endpoint = "docwholesalereturn/edit" if is_return else "docwholesale/edit"
    await _regos_call(session, company_id, endpoint, {"id": document_id, "date": date})


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
    payment_dates: list[int] | None = None,
    defer_perform: bool = False,
    cross_currency_payment_mode: str = "payment_currency",
) -> tuple[int | None, list[dict[str, Any]], float, float, bool, dict[str, Any]]:
    amount_paid = round(sum(float(payment["amount_paid"]) for payment in payments_input), 2)
    balance_due = round(max(total - amount_paid, 0), 2)
    is_fully_paid = balance_due <= 0.01
    category_id = _resolve_payment_category_id(defaults, is_return=is_return)

    payment_doc_id: int | None = None
    sale_currency = defaults.get("currency")
    payment_results: list[dict[str, Any]] = []
    payment_date_index = 0

    for payment_input in payments_input:
        line_amount_paid = round(float(payment_input["amount_paid"]), 2)
        if line_amount_paid <= 0:
            continue

        if payment_dates is not None:
            if payment_date_index >= len(payment_dates):
                raise bad_request(
                    "Payment date allocation mismatch.",
                    "CHECKOUT_PAYMENT_DATE_MISMATCH",
                )
            document_date = payment_dates[payment_date_index]
            payment_date_index += 1
        else:
            document_date = int(time.time()) + 1 + payment_date_index
            payment_date_index += 1

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

        posting = await _resolve_payment_posting(
            session,
            company_id,
            selected_payment_type=payment_type,
            sale_currency=sale_currency,
            line_amount_paid=line_amount_paid,
            sale_rate=sale_rate,
            payment_rate=payment_rate,
            cross_currency_payment_mode=cross_currency_payment_mode,
            tendered=tendered,
            change=change,
            is_return=is_return,
            source_document_id=document_id,
            document_date=document_date,
        )

        payment_doc = await _add_payment_document(
            session,
            company_id,
            defaults,
            source_document_id=document_id,
            document_type_id=document_type_id,
            payment_type_id=posting["payment_type_id"],
            amount=posting["payment_doc_amount"],
            exchange_rate=posting["payment_exchange_rate"],
            category_id=category_id,
            document_date=document_date,
        )
        line_payment_doc_id = int(payment_doc["id"])
        if not defer_perform:
            await _regos_call(
                session, company_id, "docpayment/perform", {"id": line_payment_doc_id}
            )
            if posting.get("account_transfer"):
                await _add_account_movement(
                    session,
                    company_id,
                    defaults,
                    **posting["account_transfer"],
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
                "payment_amount": posting["payment_amount"],
                "settlement_payment_type_id": posting.get("settlement_payment_type_id"),
                "account_transfer": posting.get("account_transfer"),
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


async def _resolve_payment_posting(
    session: AsyncSession,
    company_id: int,
    *,
    selected_payment_type: dict[str, Any],
    sale_currency: dict[str, Any] | None,
    line_amount_paid: float,
    sale_rate: float,
    payment_rate: float,
    cross_currency_payment_mode: str,
    tendered: Any,
    change: Any,
    is_return: bool,
    source_document_id: int,
    document_date: int,
) -> dict[str, Any]:
    payment_currency = selected_payment_type.get("currency")
    payment_type_id = int(selected_payment_type["id"])
    payment_doc_amount = convert_between_rates(line_amount_paid, sale_rate, payment_rate)

    use_sale_currency_transfer = (
        cross_currency_payment_mode == "sale_currency_transfer"
        and sale_currency
        and payment_currency
        and not same_currency(sale_currency, payment_currency)
    )

    if not use_sale_currency_transfer:
        return {
            "payment_type_id": payment_type_id,
            "payment_doc_amount": payment_doc_amount,
            "payment_exchange_rate": payment_rate,
            "payment_amount": payment_doc_amount,
        }

    sale_currency_id = sale_currency.get("id")
    if not isinstance(sale_currency_id, int):
        raise bad_request(
            "Sale currency is not configured.",
            "REGOS_SALE_CURRENCY_NOT_CONFIGURED",
        )

    settlement_payment_type = await regos_payment_types_service.find_payment_type_for_currency(
        session,
        company_id,
        currency_id=sale_currency_id,
        is_cash=bool(selected_payment_type.get("is_cash")),
    )
    if settlement_payment_type is None:
        raise bad_request(
            "No payment type is configured for the sale currency with a matching cash type.",
            "REGOS_SALE_CURRENCY_PAYMENT_TYPE_NOT_FOUND",
        )

    selected_account_id = selected_payment_type.get("account_id")
    settlement_account_id = settlement_payment_type.get("account_id")
    if not isinstance(selected_account_id, int) or selected_account_id <= 0:
        raise bad_request(
            "Selected payment type does not have a configured account.",
            "REGOS_PAYMENT_ACCOUNT_NOT_CONFIGURED",
        )
    if not isinstance(settlement_account_id, int) or settlement_account_id <= 0:
        raise bad_request(
            "Sale-currency payment type does not have a configured account.",
            "REGOS_PAYMENT_ACCOUNT_NOT_CONFIGURED",
        )

    amount_in_payment_currency = _resolve_amount_received_in_payment_currency(
        line_amount_paid=line_amount_paid,
        sale_rate=sale_rate,
        payment_rate=payment_rate,
        tendered=tendered,
        change=change,
        is_cash=bool(selected_payment_type.get("is_cash")),
    )

    if is_return:
        account_sender_id = selected_account_id
        account_receiver_id = settlement_account_id
        amount_sended = amount_in_payment_currency
        amount_received = line_amount_paid
    else:
        account_sender_id = settlement_account_id
        account_receiver_id = selected_account_id
        amount_sended = line_amount_paid
        amount_received = amount_in_payment_currency

    description = (
        f"POS return #{source_document_id}"
        if is_return
        else f"POS sale #{source_document_id}"
    )

    return {
        "payment_type_id": int(settlement_payment_type["id"]),
        "payment_doc_amount": line_amount_paid,
        "payment_exchange_rate": sale_rate,
        "payment_amount": amount_in_payment_currency,
        "settlement_payment_type_id": int(settlement_payment_type["id"]),
        "account_transfer": {
            "account_sender_id": account_sender_id,
            "account_receiver_id": account_receiver_id,
            "amount_sended": amount_sended,
            "amount_received": amount_received,
            "document_date": document_date,
            "description": description,
        },
    }


def _resolve_amount_received_in_payment_currency(
    *,
    line_amount_paid: float,
    sale_rate: float,
    payment_rate: float,
    tendered: Any,
    change: Any,
    is_cash: bool,
) -> float:
    if is_cash and tendered is not None:
        try:
            tendered_value = float(tendered)
            change_value = float(change) if change is not None else 0.0
            return round(max(tendered_value - change_value, 0), 2)
        except (TypeError, ValueError):
            pass
    return convert_between_rates(line_amount_paid, sale_rate, payment_rate)


async def _add_account_movement(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    *,
    account_sender_id: int,
    account_receiver_id: int,
    amount_sended: float,
    amount_received: float,
    document_date: int,
    description: str,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "date": document_date,
        "firm_id": defaults["firm"]["id"],
        "account_sender_id": account_sender_id,
        "account_receiver_id": account_receiver_id,
        "amount_sended": amount_sended,
        "amount_received": amount_received,
        "description": description,
    }
    attached_user = defaults.get("attached_user")
    if attached_user:
        payload["attached_user_id"] = attached_user["id"]

    response = await _regos_call(session, company_id, "docaccountmovement/add", payload)
    movement = _extract_new_document(response)
    await _regos_call(
        session, company_id, "docaccountmovement/perform", {"id": movement["id"]}
    )
    return movement


async def _perform_pending_account_transfers(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    payment_results: list[dict[str, Any]],
) -> None:
    for payment_result in payment_results:
        transfer = payment_result.get("account_transfer")
        if not isinstance(transfer, dict):
            continue
        await _add_account_movement(session, company_id, defaults, **transfer)


async def _perform_payment_documents(
    session: AsyncSession,
    company_id: int,
    payment_doc_ids: list[int],
) -> None:
    for payment_doc_id in payment_doc_ids:
        if payment_doc_id > 0:
            await _regos_call(session, company_id, "docpayment/perform", {"id": payment_doc_id})


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


def _resolve_payment_document_currency(item: dict[str, Any]) -> dict[str, Any] | None:
    currency = _extract_currency_reference(item, "currency")
    if currency:
        return currency
    payment_type = item.get("type")
    if isinstance(payment_type, dict):
        account = payment_type.get("account")
        if isinstance(account, dict):
            return _extract_currency_reference(account, "currency")
    return None


def _resolve_payment_exchange_rate(
    item: dict[str, Any],
    currency: dict[str, Any] | None,
) -> float | None:
    raw_rate = item.get("exchange_rate")
    if raw_rate is not None:
        try:
            return float(raw_rate)
        except (TypeError, ValueError):
            pass
    if isinstance(currency, dict) and currency.get("exchange_rate") is not None:
        try:
            return float(currency["exchange_rate"])
        except (TypeError, ValueError):
            return None
    return None


def _map_payment_document(item: dict[str, Any]) -> dict[str, Any]:
    partner = item.get("partner") if isinstance(item.get("partner"), dict) else {}
    category = item.get("category") if isinstance(item.get("category"), dict) else {}
    payment_type = item.get("type") if isinstance(item.get("type"), dict) else {}
    attached_user_id, attached_user_name = _attached_user_fields(item)
    currency = _resolve_payment_document_currency(item)
    mapped: dict[str, Any] = {
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
        "attached_user_id": attached_user_id,
        "attached_user_name": attached_user_name,
        "exchange_rate": _resolve_payment_exchange_rate(item, currency),
    }
    if currency:
        mapped["currency"] = currency
    return mapped


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


def _partner_phone_from_row(partner: dict[str, Any]) -> str | None:
    phone = partner.get("phone")
    if isinstance(phone, str) and phone.strip():
        return phone.strip()
    phones = partner.get("phones")
    if isinstance(phones, list):
        return next(
            (str(entry).strip() for entry in phones if isinstance(entry, str) and entry.strip()),
            None,
        )
    if isinstance(phones, str) and phones.strip():
        return phones.strip()
    return None


def _extract_document_status_id(item: dict[str, Any]) -> int | None:
    status_id = item.get("status_id")
    if isinstance(status_id, int) and status_id > 0:
        return status_id
    status = item.get("status")
    if isinstance(status, dict):
        raw_id = status.get("id")
        if isinstance(raw_id, int) and raw_id > 0:
            return raw_id
    return None


def _map_order_from_partner_document(item: dict[str, Any]) -> dict[str, Any]:
    mapped = _map_wholesale_document(item)
    mapped["performed"] = False
    status_id = _extract_document_status_id(item)
    if status_id is not None:
        mapped["status_id"] = status_id
    return mapped


def _map_wholesale_document(item: dict[str, Any]) -> dict[str, Any]:
    partner = item.get("partner") if isinstance(item.get("partner"), dict) else {}
    stock = item.get("stock") if isinstance(item.get("stock"), dict) else {}
    attached_user_id, attached_user_name = _attached_user_fields(item)
    mapped: dict[str, Any] = {
        "id": int(item.get("id") or 0),
        "code": str(item.get("code") or item.get("id") or ""),
        "date": int(item.get("date") or 0),
        "partner_id": partner.get("id") if isinstance(partner.get("id"), int) else None,
        "partner_name": partner.get("name") if isinstance(partner.get("name"), str) else None,
        "partner_phone": _partner_phone_from_row(partner),
        "stock_id": stock.get("id") if isinstance(stock.get("id"), int) else None,
        "stock_name": stock.get("name") if isinstance(stock.get("name"), str) else None,
        "attached_user_id": attached_user_id,
        "attached_user_name": attached_user_name,
        "amount": float(item["amount"]) if item.get("amount") is not None else None,
        "performed": bool(item.get("performed", False)),
    }
    currency = _extract_currency_reference(item, "currency")
    if currency:
        mapped["currency"] = currency
    return mapped


def _map_wholesale_return_document(item: dict[str, Any]) -> dict[str, Any]:
    partner = item.get("partner") if isinstance(item.get("partner"), dict) else {}
    stock = item.get("stock") if isinstance(item.get("stock"), dict) else {}
    attached_user_id, attached_user_name = _attached_user_fields(item)
    description = item.get("description") if isinstance(item.get("description"), str) else None
    wholesale_doc_id = _parse_wholesale_doc_id_from_description(description)
    reason: str | None = None
    if description and "|" in description:
        reason = description.split("|", 1)[1].strip() or None
    mapped: dict[str, Any] = {
        "id": int(item.get("id") or 0),
        "code": str(item.get("code") or item.get("id") or ""),
        "date": int(item.get("date") or 0),
        "partner_id": partner.get("id") if isinstance(partner.get("id"), int) else None,
        "partner_name": partner.get("name") if isinstance(partner.get("name"), str) else None,
        "partner_phone": _partner_phone_from_row(partner),
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
    currency = _extract_currency_reference(item, "currency")
    if currency:
        mapped["currency"] = currency
    return mapped


def _map_wholesale_return_operation(item: dict[str, Any]) -> dict[str, Any]:
    return _map_wholesale_operation(item)


def _item_brand_from_product(product: dict[str, Any]) -> str | None:
    producer = product.get("producer") if isinstance(product.get("producer"), dict) else {}
    if isinstance(producer.get("name"), str) and producer["name"].strip():
        return producer["name"].strip()
    for key in ("brand", "model", "marka"):
        value = product.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    department = product.get("department") if isinstance(product.get("department"), dict) else {}
    if isinstance(department.get("name"), str) and department["name"].strip():
        return department["name"].strip()
    return None


def _coerce_operation_text(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def _nested_operation_name(value: Any) -> str | None:
    if isinstance(value, dict):
        return _coerce_operation_text(value.get("name"))
    return _coerce_operation_text(value)


def _map_operation_item(product: dict[str, Any]) -> dict[str, Any]:
    color = product.get("color") if isinstance(product.get("color"), dict) else {}
    size = product.get("size") if isinstance(product.get("size"), dict) else {}
    producer = product.get("producer") if isinstance(product.get("producer"), dict) else {}
    country = product.get("country") if isinstance(product.get("country"), dict) else {}
    department = product.get("department") if isinstance(product.get("department"), dict) else {}
    vat = product.get("vat") if isinstance(product.get("vat"), dict) else {}

    vat_value = vat.get("value")
    if vat_value is None:
        vat_value = vat.get("rate")
    parsed_vat_value: float | None
    if isinstance(vat_value, (int, float)) and not isinstance(vat_value, bool):
        parsed_vat_value = float(vat_value)
    else:
        parsed_vat_value = None

    return {
        "fullname": _coerce_operation_text(product.get("fullname")),
        "description": _coerce_operation_text(product.get("description")),
        "articul": _coerce_operation_text(product.get("articul")),
        "color": {"name": _nested_operation_name(color)},
        "size": {"name": _nested_operation_name(size)},
        "producer": {"name": _nested_operation_name(producer)},
        "country": {"name": _nested_operation_name(country)},
        "icps": _coerce_operation_text(product.get("icps")),
        "package_code": _coerce_operation_text(product.get("package_code")),
        "department": {"name": _nested_operation_name(department)},
        "vat": {
            "name": _nested_operation_name(vat),
            "value": parsed_vat_value,
        },
        "base_barcode": _coerce_operation_text(product.get("base_barcode")),
    }


def _map_wholesale_operation(item: dict[str, Any]) -> dict[str, Any]:
    product = item.get("item") if isinstance(item.get("item"), dict) else {}
    group = product.get("group") if isinstance(product.get("group"), dict) else {}
    unit = product.get("unit") if isinstance(product.get("unit"), dict) else {}
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
        "item_group_id": group.get("id") if isinstance(group.get("id"), int) else None,
        "item_group_name": group.get("name") if isinstance(group.get("name"), str) else None,
        "item_unit_name": unit.get("name") if isinstance(unit.get("name"), str) else None,
        "item_brand": _item_brand_from_product(product),
        "quantity": float(qty or 0),
        "price": float(price or 0),
        "price2": float(price2) if price2 is not None else None,
        "amount": float(amount) if amount is not None else None,
        "last_purchase_cost": float(last_purchase_cost)
        if last_purchase_cost is not None
        else None,
        "item": _map_operation_item(product),
    }
