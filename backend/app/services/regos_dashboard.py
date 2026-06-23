from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import regos_defaults as regos_defaults_service
from app.services import regos_products as regos_products_service
from app.services import regos_sales as regos_sales_service

DAY_SECONDS = 24 * 60 * 60
DASHBOARD_PRODUCTS_PAGE_SIZE = 50


async def get_dashboard_stats(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    *,
    start_date: int | None = None,
    end_date: int | None = None,
    stock_ids: list[int] | None = None,
    all_stocks: bool = True,
) -> dict[str, Any]:
    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=user_id
    )
    income_category = defaults.get("payment_category")
    outcome_category = defaults.get("refund_payment_category")
    income_category_id = (
        int(income_category["id"])
        if isinstance(income_category, dict) and income_category.get("id")
        else None
    )
    outcome_category_id = (
        int(outcome_category["id"])
        if isinstance(outcome_category, dict) and outcome_category.get("id")
        else None
    )

    income_category_name = (
        income_category.get("name")
        if isinstance(income_category, dict) and isinstance(income_category.get("name"), str)
        else None
    )
    outcome_category_name = (
        outcome_category.get("name")
        if isinstance(outcome_category, dict) and isinstance(outcome_category.get("name"), str)
        else None
    )

    now = int(datetime.now(timezone.utc).timestamp())
    end = end_date if end_date is not None else now

    period = await _load_period_data(
        session,
        company_id,
        user_id=user_id,
        start_date=start_date,
        end_date=end,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    documents = period["documents"]
    return_documents = period["return_documents"]
    payment_documents = period["payment_documents"]
    operations = period["operations"]
    return_operations = period["return_operations"]
    sales_data = period["sales_data"]

    sales_total = sum(float(doc.get("amount") or 0) for doc in documents)
    refunds_total = sum(float(doc.get("amount") or 0) for doc in return_documents)
    cost_total = _sum_operation_cost(operations)
    refunds_cost_total = _sum_operation_cost(return_operations)
    gross_profit = round(sales_total - cost_total, 2)
    net_sales_total = round(sales_total - refunds_total, 2)
    net_cost_total = round(cost_total - refunds_cost_total, 2)
    net_gross_profit = round(net_sales_total - net_cost_total, 2)
    transaction_count = len(documents)
    items_sold = sum(float(op.get("quantity") or 0) for op in operations)

    income_payments = [
        payment
        for payment in payment_documents
        if income_category_id is not None and payment.get("category_id") == income_category_id
    ]
    outcome_payments = [
        payment
        for payment in payment_documents
        if outcome_category_id is not None and payment.get("category_id") == outcome_category_id
    ]

    return {
        "sales_total": round(sales_total, 2),
        "cost_total": round(cost_total, 2),
        "gross_profit": gross_profit,
        "refunds_cost_total": refunds_cost_total,
        "net_sales_total": net_sales_total,
        "net_cost_total": net_cost_total,
        "net_gross_profit": net_gross_profit,
        "transaction_count": transaction_count,
        "items_sold": round(items_sold, 2),
        "avg_basket": round(sales_total / transaction_count, 2) if transaction_count else 0.0,
        "refunds_total": round(refunds_total, 2),
        "refund_count": len(return_documents),
        "income_payments_total": round(
            sum(float(payment.get("amount") or 0) for payment in income_payments),
            2,
        ),
        "outcome_payments_total": round(
            sum(float(payment.get("amount") or 0) for payment in outcome_payments),
            2,
        ),
        "income_payment_category_name": income_category_name,
        "outcome_payment_category_name": outcome_category_name,
        "income_payments": income_payments[:20],
        "outcome_payments": outcome_payments[:20],
        "days": _build_daily_series(documents, operations, start_date, end),
        "top_products": _top_products(operations),
        "top_partners": _top_partners(documents),
        "sales_count_total": int(sales_data.get("total") or transaction_count),
    }


async def get_dashboard_products(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    *,
    start_date: int | None = None,
    end_date: int | None = None,
    stock_ids: list[int] | None = None,
    all_stocks: bool = True,
    offset: int = 0,
    limit: int = DASHBOARD_PRODUCTS_PAGE_SIZE,
) -> dict[str, Any]:
    now = int(datetime.now(timezone.utc).timestamp())
    end = end_date if end_date is not None else now
    safe_offset = max(0, offset)
    safe_limit = max(1, min(limit, 200))

    period = await _load_period_data(
        session,
        company_id,
        user_id=user_id,
        start_date=start_date,
        end_date=end,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    operations = period["operations"]
    return_operations = period["return_operations"]
    stats_by_id = _build_product_stats_map(operations, return_operations)
    active_ids = sorted(
        [
            item_id
            for item_id, stats in stats_by_id.items()
            if _has_period_activity(stats)
        ],
        key=lambda item_id: _product_sort_key(item_id, {}, stats_by_id),
    )
    total = len(active_ids)
    page_ids = active_ids[safe_offset : safe_offset + safe_limit]
    next_offset = safe_offset + len(page_ids) if safe_offset + len(page_ids) < total else 0

    catalog_products: list[dict[str, Any]] = []
    if page_ids:
        catalog_products = await regos_products_service.get_products_by_ids(
            session,
            company_id,
            user_id,
            page_ids,
        )

    rows = _build_product_rows(
        catalog_products,
        operations,
        return_operations,
        item_ids=page_ids,
    )

    return {
        "products": rows,
        "next_offset": next_offset,
        "total": total,
    }


async def _load_period_data(
    session: AsyncSession,
    company_id: int,
    *,
    user_id: int,
    start_date: int | None,
    end_date: int,
    stock_ids: list[int] | None = None,
    all_stocks: bool = True,
) -> dict[str, Any]:
    sales_data, returns_data, payments_data = await asyncio.gather(
        regos_sales_service.list_wholesale_documents(
            session,
            company_id,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            stock_ids=stock_ids,
            all_stocks=all_stocks,
            limit=200,
        ),
        regos_sales_service.list_wholesale_return_documents(
            session,
            company_id,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            stock_ids=stock_ids,
            all_stocks=all_stocks,
            limit=200,
        ),
        regos_sales_service.list_payment_documents(
            session,
            company_id,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            stock_ids=stock_ids,
            all_stocks=all_stocks,
            limit=200,
        ),
    )

    documents = sales_data["documents"]
    return_documents = returns_data["documents"]
    doc_ids = [doc["id"] for doc in documents if doc["id"] > 0]
    return_doc_ids = [doc["id"] for doc in return_documents if doc["id"] > 0]

    operations: list[dict[str, Any]] = []
    return_operations: list[dict[str, Any]] = []
    ops_tasks: list[Any] = []
    if doc_ids:
        ops_tasks.append(
            regos_sales_service.list_wholesale_operations_batch(session, company_id, doc_ids)
        )
    if return_doc_ids:
        ops_tasks.append(
            regos_sales_service.list_wholesale_return_operations_batch(
                session, company_id, return_doc_ids
            )
        )

    if ops_tasks:
        results = await asyncio.gather(*ops_tasks)
        result_index = 0
        if doc_ids:
            operations = results[result_index]["operations"]
            result_index += 1
        if return_doc_ids:
            return_operations = results[result_index]["operations"]

    return {
        "sales_data": sales_data,
        "documents": documents,
        "return_documents": return_documents,
        "payment_documents": payments_data["documents"],
        "operations": operations,
        "return_operations": return_operations,
    }


def _sum_operation_cost(operations: list[dict[str, Any]]) -> float:
    total = 0.0
    for operation in operations:
        unit_cost = operation.get("last_purchase_cost")
        if unit_cost is None:
            continue
        total += float(unit_cost) * float(operation.get("quantity") or 0)
    return round(total, 2)


def _build_daily_series(
    documents: list[dict[str, Any]],
    operations: list[dict[str, Any]],
    start_date: int | None,
    end_date: int,
) -> list[dict[str, Any]]:
    if start_date is None:
        if documents:
            earliest = min(doc["date"] for doc in documents if doc.get("date"))
            start = int(earliest)
        else:
            start = end_date - 6 * DAY_SECONDS
    else:
        start = start_date

    start_dt = datetime.fromtimestamp(start, tz=timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    end_dt = datetime.fromtimestamp(end_date, tz=timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    day_count = max(1, min(31, (end_dt - start_dt).days + 1))

    cost_by_doc_id: dict[int, float] = {}
    for operation in operations:
        doc_id = int(operation.get("document_id") or 0)
        unit_cost = operation.get("last_purchase_cost")
        if unit_cost is None:
            continue
        line_cost = float(unit_cost) * float(operation.get("quantity") or 0)
        cost_by_doc_id[doc_id] = round(cost_by_doc_id.get(doc_id, 0.0) + line_cost, 2)

    buckets: list[dict[str, Any]] = []
    for offset in range(day_count):
        day_start = start_dt + timedelta(days=offset)
        day_end = day_start + timedelta(days=1)
        start_ts = int(day_start.timestamp())
        end_ts = int(day_end.timestamp())

        day_sales = 0.0
        day_cost = 0.0
        for doc in documents:
            doc_date = int(doc.get("date") or 0)
            if start_ts <= doc_date < end_ts:
                day_sales += float(doc.get("amount") or 0)
                day_cost += cost_by_doc_id.get(doc["id"], 0.0)

        buckets.append(
            {
                "day": day_start.strftime("%a"),
                "sales": round(day_sales, 2),
                "cost": round(day_cost, 2),
                "profit": round(day_sales - day_cost, 2),
            }
        )
    return buckets


def _top_products(operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    product_map: dict[int, dict[str, Any]] = {}
    for operation in operations:
        item_id = int(operation.get("item_id") or 0)
        if item_id <= 0:
            continue
        current = product_map.get(item_id) or {
            "item_id": item_id,
            "name": operation.get("item_name") or f"Item #{item_id}",
            "qty": 0.0,
            "revenue": 0.0,
        }
        qty = float(operation.get("quantity") or 0)
        amount = operation.get("amount")
        revenue = float(amount) if amount is not None else qty * float(operation.get("price") or 0)
        current["qty"] = round(current["qty"] + qty, 2)
        current["revenue"] = round(current["revenue"] + revenue, 2)
        product_map[item_id] = current

    return sorted(product_map.values(), key=lambda item: item["revenue"], reverse=True)[:5]


def _top_partners(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    partner_map: dict[str, int] = {}
    for doc in documents:
        name = doc.get("partner_name") or "Unknown"
        partner_map[name] = partner_map.get(name, 0) + 1
    return [
        {"name": name, "count": count}
        for name, count in sorted(partner_map.items(), key=lambda item: item[1], reverse=True)[:5]
    ]


def _empty_product_stats() -> dict[str, Any]:
    return {
        "sold_quantity": 0.0,
        "sold_purchase_cost": 0.0,
        "sold_total": 0.0,
        "refund_quantity": 0.0,
        "refund_purchase_cost": 0.0,
        "refund_total": 0.0,
        "purchase_cost": None,
        "item_name": None,
    }


def _accumulate_product_stats(
    stats: dict[str, Any],
    operation: dict[str, Any],
    *,
    is_refund: bool,
) -> None:
    qty = float(operation.get("quantity") or 0)
    amount = operation.get("amount")
    revenue = float(amount) if amount is not None else qty * float(operation.get("price") or 0)
    unit_cost = operation.get("last_purchase_cost")
    line_cost = float(unit_cost) * qty if unit_cost is not None else 0.0

    if is_refund:
        stats["refund_quantity"] = round(stats["refund_quantity"] + qty, 2)
        stats["refund_purchase_cost"] = round(stats["refund_purchase_cost"] + line_cost, 2)
        stats["refund_total"] = round(stats["refund_total"] + revenue, 2)
    else:
        stats["sold_quantity"] = round(stats["sold_quantity"] + qty, 2)
        stats["sold_purchase_cost"] = round(stats["sold_purchase_cost"] + line_cost, 2)
        stats["sold_total"] = round(stats["sold_total"] + revenue, 2)

    if unit_cost is not None:
        stats["purchase_cost"] = float(unit_cost)
    item_name = operation.get("item_name")
    if isinstance(item_name, str) and item_name.strip():
        stats["item_name"] = item_name.strip()


def _build_product_stats_map(
    sales_operations: list[dict[str, Any]],
    return_operations: list[dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    stats_by_id: dict[int, dict[str, Any]] = {}

    for operation in sales_operations:
        item_id = int(operation.get("item_id") or 0)
        if item_id <= 0:
            continue
        current = stats_by_id.get(item_id) or _empty_product_stats()
        _accumulate_product_stats(current, operation, is_refund=False)
        stats_by_id[item_id] = current

    for operation in return_operations:
        item_id = int(operation.get("item_id") or 0)
        if item_id <= 0:
            continue
        current = stats_by_id.get(item_id) or _empty_product_stats()
        _accumulate_product_stats(current, operation, is_refund=True)
        stats_by_id[item_id] = current

    return stats_by_id


def _has_period_activity(stats: dict[str, Any]) -> bool:
    return float(stats.get("sold_quantity") or 0) > 0 or float(stats.get("refund_quantity") or 0) > 0


def _average_sell_price(
    *,
    sold_qty: float,
    sold_total: float,
    refund_qty: float,
    refund_total: float,
    catalog_price: float,
) -> float:
    if sold_qty > 0:
        return round(sold_total / sold_qty, 2)
    if refund_qty > 0:
        return round(refund_total / refund_qty, 2)
    return catalog_price


def _build_product_rows(
    catalog_products: list[dict[str, Any]],
    sales_operations: list[dict[str, Any]],
    return_operations: list[dict[str, Any]],
    *,
    item_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    product_by_id = {
        int(product["regos_item_id"]): product
        for product in catalog_products
        if isinstance(product.get("regos_item_id"), int)
    }
    stats_by_id = _build_product_stats_map(sales_operations, return_operations)

    if item_ids is not None:
        all_item_ids = item_ids
    elif catalog_products:
        all_item_ids = sorted(
            product_by_id.keys(),
            key=lambda value: _product_sort_key(value, product_by_id, stats_by_id),
        )
    else:
        all_item_ids = sorted(
            stats_by_id.keys(),
            key=lambda value: _product_sort_key(value, product_by_id, stats_by_id),
        )

    rows: list[dict[str, Any]] = []

    for item_id in all_item_ids:
        product = product_by_id.get(item_id)
        stats = stats_by_id.get(item_id) or _empty_product_stats()
        sold_qty = float(stats["sold_quantity"])
        sold_total = float(stats["sold_total"])
        refund_qty = float(stats["refund_quantity"])
        sold_purchase_cost = float(stats["sold_purchase_cost"])
        refund_purchase_cost = float(stats["refund_purchase_cost"])
        refund_total = float(stats["refund_total"])
        net_qty = round(sold_qty - refund_qty, 2)
        net_purchase_cost = round(sold_purchase_cost - refund_purchase_cost, 2)
        net_total_sells = round(sold_total - refund_total, 2)
        catalog_price = float(product.get("price") or 0) if product else 0.0

        rows.append(
            {
                "item_id": item_id,
                "code": str(product.get("code") or "") if product else "",
                "name": (
                    str(product.get("name") or "")
                    if product
                    else stats.get("item_name") or f"Item #{item_id}"
                ),
                "category": str(product.get("category") or "") if product else "",
                "purchase_cost": stats.get("purchase_cost"),
                "average_price": _average_sell_price(
                    sold_qty=sold_qty,
                    sold_total=sold_total,
                    refund_qty=refund_qty,
                    refund_total=refund_total,
                    catalog_price=catalog_price,
                ),
                "sold_quantity": sold_qty,
                "sold_purchase_cost": sold_purchase_cost,
                "sold_total": sold_total,
                "refund_quantity": refund_qty,
                "refund_purchase_cost": refund_purchase_cost,
                "refund_total": refund_total,
                "net_sold_quantity": net_qty,
                "net_purchase_cost": net_purchase_cost,
                "net_total_sells": net_total_sells,
                "net_gross_profit": round(net_total_sells - net_purchase_cost, 2),
            }
        )

    return rows


def _product_sort_key(
    item_id: int,
    product_by_id: dict[int, dict[str, Any]],
    stats_by_id: dict[int, dict[str, Any]],
) -> str:
    product = product_by_id.get(item_id)
    if product and isinstance(product.get("name"), str):
        return product["name"].casefold()
    stats = stats_by_id.get(item_id)
    if stats and isinstance(stats.get("item_name"), str):
        return stats["item_name"].casefold()
    return f"item #{item_id}".casefold()
