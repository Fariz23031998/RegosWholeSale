import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError, bad_request
from app.core.regos_api import regos_async_api_request_for_company
from app.services import regos_defaults as regos_defaults_service

# VAT included in line prices (Regos: "Exclude" / "В сумме").
DEFAULT_VAT_CALCULATION_TYPE = "Exclude"


async def complete_checkout(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    defaults = await regos_defaults_service.get_stored_regos_defaults(session, company_id)
    defaults = await regos_defaults_service.enrich_checkout_defaults(
        session, company_id, defaults, refresh=True
    )
    regos_defaults_service.validate_checkout_defaults(defaults)

    items = payload["items"]
    discount = float(payload.get("discount") or 0)
    payment_type_id = int(payload["payment_type_id"])
    total = float(payload["total"])
    tendered = payload.get("tendered")
    change = payload.get("change")
    description = payload.get("description")

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

    doc_id: int | None = None
    try:
        wholesale_doc = await _add_wholesale_document(session, company_id, defaults, description)
        doc_id = int(wholesale_doc["id"])

        await _regos_call(session, company_id, "docwholesale/lock", {"ids": [doc_id]})
        try:
            await _add_wholesale_operations(session, company_id, doc_id, lines)
        finally:
            await _regos_call(session, company_id, "docwholesale/unlock", {"ids": [doc_id]})

        performed_doc = await _regos_call(
            session, company_id, "docwholesale/perform", {"id": doc_id}
        )
        wholesale_code = _extract_code(performed_doc, doc_id)

        document_type_id = await regos_defaults_service.get_doc_wholesale_document_type_id(
            session, company_id
        )
        payment_doc = await _add_payment_document(
            session,
            company_id,
            defaults,
            wholesale_doc_id=doc_id,
            document_type_id=document_type_id,
            payment_type_id=payment_type_id,
            amount=total,
        )
        payment_doc_id = int(payment_doc["id"])

        await _regos_call(session, company_id, "docpayment/perform", {"id": payment_doc_id})

        return {
            "wholesale_doc_id": doc_id,
            "wholesale_code": wholesale_code,
            "payment_doc_id": payment_doc_id,
            "performed_at": datetime.now(timezone.utc),
            "lines": lines,
            "payment": {
                "payment_type_id": payment_type_id,
                "payment_doc_id": payment_doc_id,
                "amount": total,
                "tendered": tendered,
                "change": change,
            },
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
    start_date: int | None = None,
    end_date: int | None = None,
    partner_ids: list[int] | None = None,
    stock_ids: list[int] | None = None,
    offset: int = 0,
    limit: int = 50,
) -> dict[str, Any]:
    defaults = await regos_defaults_service.get_regos_defaults(session, company_id)
    warehouse = defaults.get("warehouse")
    partner = defaults.get("partner")

    payload: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "sort_orders": [{"column": "Date", "direction": "desc"}],
    }
    if start_date is not None:
        payload["start_date"] = start_date
    if end_date is not None:
        payload["end_date"] = end_date
    if partner_ids:
        payload["partner_ids"] = partner_ids
    elif partner:
        payload["partner_ids"] = [partner["id"]]
    if stock_ids:
        payload["stock_ids"] = stock_ids
    elif warehouse:
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
        "vat_calculation_type": DEFAULT_VAT_CALCULATION_TYPE,
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


async def _add_payment_document(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    *,
    wholesale_doc_id: int,
    document_type_id: int,
    payment_type_id: int,
    amount: float,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type_id": payment_type_id,
        "document": wholesale_doc_id,
        "document_type_id": document_type_id,
        "firm_id": defaults["firm"]["id"],
        "partner_id": defaults["partner"]["id"],
        "category_id": defaults["payment_category"]["id"],
        "amount": amount,
        "exchange_rate": 1,
    }
    attached_user = defaults.get("attached_user")
    if attached_user:
        payload["attached_user_id"] = attached_user["id"]

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


def _map_wholesale_document(item: dict[str, Any]) -> dict[str, Any]:
    partner = item.get("partner") if isinstance(item.get("partner"), dict) else {}
    stock = item.get("stock") if isinstance(item.get("stock"), dict) else {}
    return {
        "id": int(item.get("id") or 0),
        "code": str(item.get("code") or item.get("id") or ""),
        "date": int(item.get("date") or 0),
        "partner_id": partner.get("id") if isinstance(partner.get("id"), int) else None,
        "partner_name": partner.get("name") if isinstance(partner.get("name"), str) else None,
        "stock_id": stock.get("id") if isinstance(stock.get("id"), int) else None,
        "stock_name": stock.get("name") if isinstance(stock.get("name"), str) else None,
        "amount": float(item["amount"]) if item.get("amount") is not None else None,
        "performed": bool(item.get("performed", False)),
    }


def _map_wholesale_operation(item: dict[str, Any]) -> dict[str, Any]:
    product = item.get("item") if isinstance(item.get("item"), dict) else {}
    qty = item.get("quantity", item.get("qty", 0))
    price = item.get("price", 0)
    price2 = item.get("price2")
    amount = item.get("amount")
    if amount is None and qty is not None and price is not None:
        amount = float(qty) * float(price)
    return {
        "id": int(item.get("id") or 0),
        "document_id": int(item.get("document_id") or 0),
        "item_id": int(product.get("id") or item.get("item_id") or 0),
        "item_name": product.get("name") if isinstance(product.get("name"), str) else None,
        "quantity": float(qty or 0),
        "price": float(price or 0),
        "price2": float(price2) if price2 is not None else None,
        "amount": float(amount) if amount is not None else None,
    }
