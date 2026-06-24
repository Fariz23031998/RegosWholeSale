from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import regos_defaults as regos_defaults_service
from app.services import regos_products as regos_products_service
from app.services import regos_sales as regos_sales_service
from app.utils.currency_conversion import convert_between_rates

DAY_SECONDS = 24 * 60 * 60
DASHBOARD_PRODUCTS_PAGE_SIZE = 50
DASHBOARD_PAYMENTS_PAGE_SIZE = 50
DASHBOARD_STATS_PAYMENTS_PREVIEW_SIZE = 20
PERIOD_CACHE_TTL_SECONDS = 120
UNKNOWN_CURRENCY_KEY = 0
CURRENCY_MODE_ALL = "all"
CURRENCY_MODE_NATIVE = "native"
BASE_COST_EXCHANGE_RATE = 1.0


@dataclass
class _CachedPeriod:
    data: dict[str, Any]
    expires_at: float


_period_cache: dict[str, _CachedPeriod] = {}


def clear_dashboard_period_cache() -> None:
    _period_cache.clear()


def _period_cache_key(
    company_id: int,
    user_id: int,
    *,
    start_date: int | None,
    end_date: int,
    partner_ids: list[int] | None,
    all_partners: bool,
    stock_ids: list[int] | None,
    all_stocks: bool,
) -> str:
    partners = tuple(sorted(partner_ids or []))
    stocks = tuple(sorted(stock_ids or []))
    return (
        f"{company_id}:{user_id}:{start_date}:{end_date}:"
        f"{int(all_partners)}:{partners}:{int(all_stocks)}:{stocks}"
    )


def _currency_key(doc: dict[str, Any]) -> int:
    currency = doc.get("currency")
    if isinstance(currency, dict):
        currency_id = currency.get("id")
        if isinstance(currency_id, int) and currency_id > 0:
            return currency_id
    return UNKNOWN_CURRENCY_KEY


def _sum_by_currency(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals: dict[int, dict[str, Any]] = {}
    for doc in documents:
        amount = float(doc.get("amount") or 0)
        if amount == 0:
            continue
        key = _currency_key(doc)
        current = totals.get(key)
        if current is None:
            currency = doc.get("currency") if isinstance(doc.get("currency"), dict) else None
            current = {"currency": currency, "amount": 0.0}
            totals[key] = current
        current["amount"] = round(current["amount"] + amount, 2)

    return sorted(totals.values(), key=lambda item: item["amount"], reverse=True)


def _subtract_currency_totals(
    positive: list[dict[str, Any]],
    negative: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged: dict[int, dict[str, Any]] = {}

    for item in positive:
        currency = item.get("currency")
        key = currency.get("id") if isinstance(currency, dict) and currency.get("id") else UNKNOWN_CURRENCY_KEY
        merged[key] = {
            "currency": currency if isinstance(currency, dict) else None,
            "amount": float(item.get("amount") or 0),
        }

    for item in negative:
        currency = item.get("currency")
        key = currency.get("id") if isinstance(currency, dict) and currency.get("id") else UNKNOWN_CURRENCY_KEY
        current = merged.get(key)
        if current is None:
            merged[key] = {
                "currency": currency if isinstance(currency, dict) else None,
                "amount": -float(item.get("amount") or 0),
            }
        else:
            current["amount"] = round(current["amount"] - float(item.get("amount") or 0), 2)

    return sorted(
        [
            {"currency": item["currency"], "amount": round(item["amount"], 2)}
            for item in merged.values()
            if round(item["amount"], 2) != 0
        ],
        key=lambda item: item["amount"],
        reverse=True,
    )


def _convert_to_default(
    amount: float,
    currency: dict[str, Any] | None,
    default_currency: dict[str, Any] | None,
) -> float:
    if not default_currency:
        return round(amount, 2)
    from_rate = currency.get("exchange_rate") if isinstance(currency, dict) else None
    to_rate = default_currency.get("exchange_rate")
    return convert_between_rates(amount, from_rate or 1, to_rate or 1)


def _should_convert_costs(display_currency: dict[str, Any] | None) -> bool:
    if not display_currency:
        return False
    rate = display_currency.get("exchange_rate")
    if rate is None:
        return False
    try:
        return float(rate) != BASE_COST_EXCHANGE_RATE
    except (TypeError, ValueError):
        return False


def _convert_base_cost_for_display(
    amount: float,
    display_currency: dict[str, Any] | None,
) -> float:
    """Convert purchase cost from UZS (base) to the dashboard display currency."""
    if not _should_convert_costs(display_currency):
        return round(amount, 2)
    to_rate = display_currency.get("exchange_rate")  # type: ignore[union-attr]
    return convert_between_rates(amount, BASE_COST_EXCHANGE_RATE, to_rate)


def _converted_total(
    by_currency: list[dict[str, Any]],
    default_currency: dict[str, Any] | None,
) -> float:
    return round(
        sum(
            _convert_to_default(float(item.get("amount") or 0), item.get("currency"), default_currency)
            for item in by_currency
        ),
        2,
    )


def _collect_currency_ids(*document_groups: list[dict[str, Any]]) -> set[int]:
    currency_ids: set[int] = set()
    for documents in document_groups:
        for doc in documents:
            key = _currency_key(doc)
            if key != UNKNOWN_CURRENCY_KEY:
                currency_ids.add(key)
    return currency_ids


def _document_currency_map(documents: list[dict[str, Any]]) -> dict[int, dict[str, Any] | None]:
    return {
        int(doc["id"]): doc.get("currency") if isinstance(doc.get("currency"), dict) else None
        for doc in documents
        if doc.get("id")
    }


def _filter_documents_by_currency(
    documents: list[dict[str, Any]],
    currency_id: int,
) -> list[dict[str, Any]]:
    return [doc for doc in documents if _currency_key(doc) == currency_id]


def _filter_operations_by_document_ids(
    operations: list[dict[str, Any]],
    document_ids: set[int],
) -> list[dict[str, Any]]:
    return [
        operation
        for operation in operations
        if int(operation.get("document_id") or 0) in document_ids
    ]


def _collect_currencies_from_documents(
    *document_groups: list[dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    currencies: dict[int, dict[str, Any]] = {}
    for documents in document_groups:
        for doc in documents:
            currency = doc.get("currency")
            if isinstance(currency, dict):
                currency_id = currency.get("id")
                if isinstance(currency_id, int) and currency_id > 0:
                    currencies[currency_id] = currency
    return currencies


def _resolve_currency_by_id(
    currency_id: int,
    defaults: dict[str, Any],
    *document_groups: list[dict[str, Any]],
) -> dict[str, Any] | None:
    default_currency = defaults.get("currency")
    if isinstance(default_currency, dict) and default_currency.get("id") == currency_id:
        return default_currency

    from_documents = _collect_currencies_from_documents(*document_groups)
    return from_documents.get(currency_id)


def _apply_currency_scope(
    *,
    documents: list[dict[str, Any]],
    return_documents: list[dict[str, Any]],
    payment_documents: list[dict[str, Any]],
    operations: list[dict[str, Any]],
    return_operations: list[dict[str, Any]],
    currency_id: int,
    currency_mode: str,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    if currency_mode != CURRENCY_MODE_NATIVE:
        return documents, return_documents, payment_documents, operations, return_operations

    documents = _filter_documents_by_currency(documents, currency_id)
    return_documents = _filter_documents_by_currency(return_documents, currency_id)
    payment_documents = _filter_documents_by_currency(payment_documents, currency_id)

    sales_doc_ids = {int(doc["id"]) for doc in documents if doc.get("id")}
    return_doc_ids = {int(doc["id"]) for doc in return_documents if doc.get("id")}
    operations = _filter_operations_by_document_ids(operations, sales_doc_ids)
    return_operations = _filter_operations_by_document_ids(return_operations, return_doc_ids)
    return documents, return_documents, payment_documents, operations, return_operations


def _single_currency_total(
    amount: float,
    currency: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if round(amount, 2) == 0:
        return []
    return [{"currency": currency, "amount": round(amount, 2)}]


async def get_dashboard_stats(
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
    currency_id: int | None = None,
    currency_mode: str = CURRENCY_MODE_ALL,
) -> dict[str, Any]:
    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=user_id
    )
    now = int(datetime.now(timezone.utc).timestamp())
    end = end_date if end_date is not None else now
    period = await _load_period_data_cached(
        session,
        company_id,
        user_id=user_id,
        start_date=start_date,
        end_date=end,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    return _build_dashboard_stats(
        period,
        defaults,
        start_date=start_date,
        end_date=end,
        currency_id=currency_id,
        currency_mode=currency_mode,
    )


async def get_dashboard_products(
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
    offset: int = 0,
    limit: int = DASHBOARD_PRODUCTS_PAGE_SIZE,
    currency_id: int | None = None,
    currency_mode: str = CURRENCY_MODE_ALL,
) -> dict[str, Any]:
    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=user_id
    )
    now = int(datetime.now(timezone.utc).timestamp())
    end = end_date if end_date is not None else now
    period = await _load_period_data_cached(
        session,
        company_id,
        user_id=user_id,
        start_date=start_date,
        end_date=end,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    return await _build_dashboard_products(
        session,
        company_id,
        user_id,
        period,
        defaults,
        offset=offset,
        limit=limit,
        currency_id=currency_id,
        currency_mode=currency_mode,
    )


async def get_dashboard_payments(
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
    offset: int = 0,
    limit: int = DASHBOARD_PAYMENTS_PAGE_SIZE,
    currency_id: int | None = None,
    currency_mode: str = CURRENCY_MODE_ALL,
) -> dict[str, Any]:
    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=user_id
    )
    now = int(datetime.now(timezone.utc).timestamp())
    end = end_date if end_date is not None else now
    period = await _load_period_data_cached(
        session,
        company_id,
        user_id=user_id,
        start_date=start_date,
        end_date=end,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    return _build_dashboard_payments(
        period,
        defaults,
        offset=offset,
        limit=limit,
        currency_id=currency_id,
        currency_mode=currency_mode,
    )


async def get_dashboard_overview(
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
    offset: int = 0,
    limit: int = DASHBOARD_PRODUCTS_PAGE_SIZE,
    currency_id: int | None = None,
    currency_mode: str = CURRENCY_MODE_ALL,
) -> dict[str, Any]:
    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=user_id
    )
    now = int(datetime.now(timezone.utc).timestamp())
    end = end_date if end_date is not None else now
    period = await _load_period_data_cached(
        session,
        company_id,
        user_id=user_id,
        start_date=start_date,
        end_date=end,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    stats = _build_dashboard_stats(
        period,
        defaults,
        start_date=start_date,
        end_date=end,
        currency_id=currency_id,
        currency_mode=currency_mode,
    )
    products = await _build_dashboard_products(
        session,
        company_id,
        user_id,
        period,
        defaults,
        offset=offset,
        limit=limit,
        currency_id=currency_id,
        currency_mode=currency_mode,
    )
    return {
        "stats": stats,
        "products": products["products"],
        "totals": products["totals"],
        "next_offset": products["next_offset"],
        "total": products["total"],
    }


def _payment_category_context(defaults: dict[str, Any]) -> dict[str, Any]:
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
    return {
        "income_category_id": income_category_id,
        "outcome_category_id": outcome_category_id,
        "income_category_name": income_category_name,
        "outcome_category_name": outcome_category_name,
    }


def _resolve_scoped_payment_lists(
    period: dict[str, Any],
    defaults: dict[str, Any],
    *,
    currency_id: int | None,
    currency_mode: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any] | None]:
    category_context = _payment_category_context(defaults)
    income_category_id = category_context["income_category_id"]
    outcome_category_id = category_context["outcome_category_id"]

    documents = period["documents"]
    return_documents = period["return_documents"]
    payment_documents = period["payment_documents"]
    operations = period["operations"]
    return_operations = period["return_operations"]

    default_currency = defaults.get("currency")
    if not isinstance(default_currency, dict):
        default_currency = None

    target_currency_id = currency_id
    if target_currency_id is None and default_currency:
        target_currency_id = default_currency.get("id")
    if not isinstance(target_currency_id, int) or target_currency_id <= 0:
        target_currency_id = None

    normalized_mode = currency_mode if currency_mode in {CURRENCY_MODE_ALL, CURRENCY_MODE_NATIVE} else CURRENCY_MODE_ALL
    if target_currency_id is not None:
        documents, return_documents, payment_documents, operations, return_operations = _apply_currency_scope(
            documents=documents,
            return_documents=return_documents,
            payment_documents=payment_documents,
            operations=operations,
            return_operations=return_operations,
            currency_id=target_currency_id,
            currency_mode=normalized_mode,
        )

    summary_currency = (
        _resolve_currency_by_id(
            target_currency_id,
            defaults,
            documents,
            return_documents,
            payment_documents,
        )
        if target_currency_id is not None
        else default_currency
    )
    if summary_currency is None:
        summary_currency = default_currency

    conversion_currency = summary_currency if normalized_mode == CURRENCY_MODE_ALL else None

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
    income_payments.sort(key=lambda payment: (payment.get("date") or 0, payment.get("id") or 0), reverse=True)
    outcome_payments.sort(key=lambda payment: (payment.get("date") or 0, payment.get("id") or 0), reverse=True)

    return income_payments, outcome_payments, conversion_currency


def _build_dashboard_payments(
    period: dict[str, Any],
    defaults: dict[str, Any],
    *,
    offset: int,
    limit: int,
    currency_id: int | None,
    currency_mode: str,
) -> dict[str, Any]:
    safe_offset = max(0, offset)
    safe_limit = max(1, min(limit, 200))
    category_context = _payment_category_context(defaults)
    income_payments, outcome_payments, conversion_currency = _resolve_scoped_payment_lists(
        period,
        defaults,
        currency_id=currency_id,
        currency_mode=currency_mode,
    )

    income_total = len(income_payments)
    outcome_total = len(outcome_payments)
    income_page = income_payments[safe_offset : safe_offset + safe_limit]
    outcome_page = outcome_payments[safe_offset : safe_offset + safe_limit]
    has_more = (safe_offset + safe_limit < income_total) or (safe_offset + safe_limit < outcome_total)
    next_offset = safe_offset + safe_limit if has_more else 0

    income_payments_by_currency = _sum_by_currency(income_payments)
    outcome_payments_by_currency = _sum_by_currency(outcome_payments)
    income_payments_total = (
        _converted_total(income_payments_by_currency, conversion_currency)
        if conversion_currency
        else round(sum(float(item.get("amount") or 0) for item in income_payments_by_currency), 2)
    )
    outcome_payments_total = (
        _converted_total(outcome_payments_by_currency, conversion_currency)
        if conversion_currency
        else round(sum(float(item.get("amount") or 0) for item in outcome_payments_by_currency), 2)
    )

    return {
        "income_payments": income_page,
        "outcome_payments": outcome_page,
        "income_payment_category_name": category_context["income_category_name"],
        "outcome_payment_category_name": category_context["outcome_category_name"],
        "income_payments_total": income_payments_total,
        "outcome_payments_total": outcome_payments_total,
        "income_total": income_total,
        "outcome_total": outcome_total,
        "next_offset": next_offset,
    }


def _build_dashboard_stats(
    period: dict[str, Any],
    defaults: dict[str, Any],
    *,
    start_date: int | None,
    end_date: int,
    currency_id: int | None,
    currency_mode: str,
) -> dict[str, Any]:
    category_context = _payment_category_context(defaults)
    income_category_id = category_context["income_category_id"]
    outcome_category_id = category_context["outcome_category_id"]
    income_category_name = category_context["income_category_name"]
    outcome_category_name = category_context["outcome_category_name"]

    documents = period["documents"]
    return_documents = period["return_documents"]
    payment_documents = period["payment_documents"]
    operations = period["operations"]
    return_operations = period["return_operations"]
    sales_data = period["sales_data"]

    default_currency = defaults.get("currency")
    if not isinstance(default_currency, dict):
        default_currency = None

    target_currency_id = currency_id
    if target_currency_id is None and default_currency:
        target_currency_id = default_currency.get("id")
    if not isinstance(target_currency_id, int) or target_currency_id <= 0:
        target_currency_id = None

    normalized_mode = currency_mode if currency_mode in {CURRENCY_MODE_ALL, CURRENCY_MODE_NATIVE} else CURRENCY_MODE_ALL
    if target_currency_id is not None:
        documents, return_documents, payment_documents, operations, return_operations = _apply_currency_scope(
            documents=documents,
            return_documents=return_documents,
            payment_documents=payment_documents,
            operations=operations,
            return_operations=return_operations,
            currency_id=target_currency_id,
            currency_mode=normalized_mode,
        )

    summary_currency = (
        _resolve_currency_by_id(
            target_currency_id,
            defaults,
            documents,
            return_documents,
            payment_documents,
        )
        if target_currency_id is not None
        else default_currency
    )
    if summary_currency is None:
        summary_currency = default_currency

    conversion_currency = summary_currency if normalized_mode == CURRENCY_MODE_ALL else None

    sales_by_currency = _sum_by_currency(documents)
    refunds_by_currency = _sum_by_currency(return_documents)
    net_sales_by_currency = _subtract_currency_totals(sales_by_currency, refunds_by_currency)

    sales_total = (
        _converted_total(sales_by_currency, conversion_currency)
        if conversion_currency
        else round(sum(float(item.get("amount") or 0) for item in sales_by_currency), 2)
    )
    refunds_total = (
        _converted_total(refunds_by_currency, conversion_currency)
        if conversion_currency
        else round(sum(float(item.get("amount") or 0) for item in refunds_by_currency), 2)
    )
    cost_total = _sum_operation_cost(operations, display_currency=summary_currency)
    refunds_cost_total = _sum_operation_cost(return_operations, display_currency=summary_currency)
    gross_profit = round(sales_total - cost_total, 2)
    net_sales_total = (
        _converted_total(net_sales_by_currency, conversion_currency)
        if conversion_currency
        else round(sum(float(item.get("amount") or 0) for item in net_sales_by_currency), 2)
    )
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
    income_payments.sort(key=lambda payment: (payment.get("date") or 0, payment.get("id") or 0), reverse=True)
    outcome_payments.sort(key=lambda payment: (payment.get("date") or 0, payment.get("id") or 0), reverse=True)

    income_payments_by_currency = _sum_by_currency(income_payments)
    outcome_payments_by_currency = _sum_by_currency(outcome_payments)
    income_payments_total = (
        _converted_total(income_payments_by_currency, conversion_currency)
        if conversion_currency
        else round(sum(float(item.get("amount") or 0) for item in income_payments_by_currency), 2)
    )
    outcome_payments_total = (
        _converted_total(outcome_payments_by_currency, conversion_currency)
        if conversion_currency
        else round(sum(float(item.get("amount") or 0) for item in outcome_payments_by_currency), 2)
    )

    doc_currency_by_id = _document_currency_map(documents)

    return {
        "sales_total": sales_total,
        "cost_total": round(cost_total, 2),
        "gross_profit": gross_profit,
        "refunds_cost_total": refunds_cost_total,
        "net_sales_total": net_sales_total,
        "net_cost_total": net_cost_total,
        "net_gross_profit": net_gross_profit,
        "transaction_count": transaction_count,
        "items_sold": round(items_sold, 2),
        "avg_basket": round(sales_total / transaction_count, 2) if transaction_count else 0.0,
        "refunds_total": refunds_total,
        "refund_count": len(return_documents),
        "income_payments_total": income_payments_total,
        "outcome_payments_total": outcome_payments_total,
        "income_payment_category_name": income_category_name,
        "outcome_payment_category_name": outcome_category_name,
        "income_payments": income_payments[:DASHBOARD_STATS_PAYMENTS_PREVIEW_SIZE],
        "outcome_payments": outcome_payments[:DASHBOARD_STATS_PAYMENTS_PREVIEW_SIZE],
        "days": _build_daily_series(
            documents,
            operations,
            start_date,
            end_date,
            sales_currency=conversion_currency,
            cost_display_currency=summary_currency,
        ),
        "top_products": _top_products(operations, doc_currency_by_id, conversion_currency),
        "top_partners": _top_partners(documents),
        "sales_count_total": int(sales_data.get("total") or transaction_count),
        "summary_currency": summary_currency,
        "has_multiple_currencies": False,
        "sales_by_currency": _single_currency_total(sales_total, summary_currency),
        "refunds_by_currency": _single_currency_total(refunds_total, summary_currency),
        "net_sales_by_currency": _single_currency_total(net_sales_total, summary_currency),
        "income_payments_by_currency": _single_currency_total(income_payments_total, summary_currency),
        "outcome_payments_by_currency": _single_currency_total(outcome_payments_total, summary_currency),
    }


async def _build_dashboard_products(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    period: dict[str, Any],
    defaults: dict[str, Any],
    *,
    offset: int,
    limit: int,
    currency_id: int | None,
    currency_mode: str,
) -> dict[str, Any]:
    safe_offset = max(0, offset)
    safe_limit = max(1, min(limit, 200))

    documents = period["documents"]
    return_documents = period["return_documents"]
    operations = period["operations"]
    return_operations = period["return_operations"]

    default_currency = defaults.get("currency")
    if not isinstance(default_currency, dict):
        default_currency = None

    target_currency_id = currency_id
    if target_currency_id is None and default_currency:
        target_currency_id = default_currency.get("id")
    normalized_mode = currency_mode if currency_mode in {CURRENCY_MODE_ALL, CURRENCY_MODE_NATIVE} else CURRENCY_MODE_ALL
    if isinstance(target_currency_id, int) and target_currency_id > 0:
        documents, return_documents, _, operations, return_operations = _apply_currency_scope(
            documents=documents,
            return_documents=return_documents,
            payment_documents=period["payment_documents"],
            operations=operations,
            return_operations=return_operations,
            currency_id=target_currency_id,
            currency_mode=normalized_mode,
        )

    conversion_currency = None
    summary_currency = default_currency
    if isinstance(target_currency_id, int) and target_currency_id > 0:
        summary_currency = (
            _resolve_currency_by_id(
                target_currency_id,
                defaults,
                documents,
                return_documents,
                period["payment_documents"],
            )
            or default_currency
        )
        if normalized_mode == CURRENCY_MODE_ALL:
            conversion_currency = summary_currency

    doc_currency_by_id = {
        **_document_currency_map(documents),
        **_document_currency_map(return_documents),
    }
    stats_by_id = _build_product_stats_map(
        operations,
        return_operations,
        doc_currency_by_id=doc_currency_by_id,
        conversion_currency=conversion_currency,
        cost_display_currency=summary_currency,
    )
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
        stats_by_id=stats_by_id,
    )

    return {
        "products": rows,
        "totals": _compute_product_totals(stats_by_id),
        "next_offset": next_offset,
        "total": total,
    }


async def _load_period_data_cached(
    session: AsyncSession,
    company_id: int,
    *,
    user_id: int,
    start_date: int | None,
    end_date: int,
    partner_ids: list[int] | None = None,
    all_partners: bool = True,
    stock_ids: list[int] | None = None,
    all_stocks: bool = True,
) -> dict[str, Any]:
    cache_key = _period_cache_key(
        company_id,
        user_id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    now = time.monotonic()
    cached = _period_cache.get(cache_key)
    if cached is not None and cached.expires_at > now:
        return cached.data

    data = await _load_period_data(
        session,
        company_id,
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    _period_cache[cache_key] = _CachedPeriod(
        data=data,
        expires_at=now + PERIOD_CACHE_TTL_SECONDS,
    )
    return data


async def _load_period_data(
    session: AsyncSession,
    company_id: int,
    *,
    user_id: int,
    start_date: int | None,
    end_date: int,
    partner_ids: list[int] | None = None,
    all_partners: bool = True,
    stock_ids: list[int] | None = None,
    all_stocks: bool = True,
) -> dict[str, Any]:
    sales_data, returns_data, payments_data = await regos_sales_service.fetch_period_document_lists_batch(
        session,
        company_id,
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
        limit=200,
    )

    documents = sales_data["documents"]
    return_documents = returns_data["documents"]
    doc_ids = [doc["id"] for doc in documents if doc["id"] > 0]
    return_doc_ids = [doc["id"] for doc in return_documents if doc["id"] > 0]

    operations, return_operations = await regos_sales_service.fetch_period_operations_batch(
        session,
        company_id,
        doc_ids,
        return_doc_ids,
    )

    return {
        "sales_data": sales_data,
        "documents": documents,
        "return_documents": return_documents,
        "payment_documents": payments_data["documents"],
        "operations": operations,
        "return_operations": return_operations,
    }


def _sum_operation_cost(
    operations: list[dict[str, Any]],
    *,
    display_currency: dict[str, Any] | None = None,
) -> float:
    total = 0.0
    for operation in operations:
        unit_cost = operation.get("last_purchase_cost")
        if unit_cost is None:
            continue
        total += float(unit_cost) * float(operation.get("quantity") or 0)
    return _convert_base_cost_for_display(round(total, 2), display_currency)


def _build_daily_series(
    documents: list[dict[str, Any]],
    operations: list[dict[str, Any]],
    start_date: int | None,
    end_date: int,
    *,
    sales_currency: dict[str, Any] | None = None,
    cost_display_currency: dict[str, Any] | None = None,
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
                doc_amount = float(doc.get("amount") or 0)
                currency = doc.get("currency") if isinstance(doc.get("currency"), dict) else None
                day_sales += _convert_to_default(doc_amount, currency, sales_currency)
                day_cost += cost_by_doc_id.get(doc["id"], 0.0)

        day_cost = _convert_base_cost_for_display(day_cost, cost_display_currency)
        day_sales = round(day_sales, 2)

        buckets.append(
            {
                "day": day_start.strftime("%a"),
                "sales": day_sales,
                "cost": day_cost,
                "profit": round(day_sales - day_cost, 2),
            }
        )
    return buckets


def _top_products(
    operations: list[dict[str, Any]],
    doc_currency_by_id: dict[int, dict[str, Any] | None],
    default_currency: dict[str, Any] | None,
) -> list[dict[str, Any]]:
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
        doc_id = int(operation.get("document_id") or 0)
        currency = doc_currency_by_id.get(doc_id)
        revenue = _convert_to_default(revenue, currency, default_currency)
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


def _operation_revenue(
    operation: dict[str, Any],
    *,
    doc_currency_by_id: dict[int, dict[str, Any] | None] | None = None,
    conversion_currency: dict[str, Any] | None = None,
) -> float:
    qty = float(operation.get("quantity") or 0)
    amount = operation.get("amount")
    revenue = float(amount) if amount is not None else qty * float(operation.get("price") or 0)
    if conversion_currency:
        doc_id = int(operation.get("document_id") or 0)
        currency = doc_currency_by_id.get(doc_id) if doc_currency_by_id else None
        revenue = _convert_to_default(revenue, currency, conversion_currency)
    return revenue


def _accumulate_product_stats(
    stats: dict[str, Any],
    operation: dict[str, Any],
    *,
    is_refund: bool,
    doc_currency_by_id: dict[int, dict[str, Any] | None] | None = None,
    conversion_currency: dict[str, Any] | None = None,
    cost_display_currency: dict[str, Any] | None = None,
) -> None:
    qty = float(operation.get("quantity") or 0)
    revenue = _operation_revenue(
        operation,
        doc_currency_by_id=doc_currency_by_id,
        conversion_currency=conversion_currency,
    )
    unit_cost = operation.get("last_purchase_cost")
    line_cost = float(unit_cost) * qty if unit_cost is not None else 0.0
    line_cost = _convert_base_cost_for_display(line_cost, cost_display_currency)

    if is_refund:
        stats["refund_quantity"] = round(stats["refund_quantity"] + qty, 2)
        stats["refund_purchase_cost"] = round(stats["refund_purchase_cost"] + line_cost, 2)
        stats["refund_total"] = round(stats["refund_total"] + revenue, 2)
    else:
        stats["sold_quantity"] = round(stats["sold_quantity"] + qty, 2)
        stats["sold_purchase_cost"] = round(stats["sold_purchase_cost"] + line_cost, 2)
        stats["sold_total"] = round(stats["sold_total"] + revenue, 2)

    if unit_cost is not None:
        stats["purchase_cost"] = _convert_base_cost_for_display(float(unit_cost), cost_display_currency)
    item_name = operation.get("item_name")
    if isinstance(item_name, str) and item_name.strip():
        stats["item_name"] = item_name.strip()


def _build_product_stats_map(
    sales_operations: list[dict[str, Any]],
    return_operations: list[dict[str, Any]],
    *,
    doc_currency_by_id: dict[int, dict[str, Any] | None] | None = None,
    conversion_currency: dict[str, Any] | None = None,
    cost_display_currency: dict[str, Any] | None = None,
) -> dict[int, dict[str, Any]]:
    stats_by_id: dict[int, dict[str, Any]] = {}

    for operation in sales_operations:
        item_id = int(operation.get("item_id") or 0)
        if item_id <= 0:
            continue
        current = stats_by_id.get(item_id) or _empty_product_stats()
        _accumulate_product_stats(
            current,
            operation,
            is_refund=False,
            doc_currency_by_id=doc_currency_by_id,
            conversion_currency=conversion_currency,
            cost_display_currency=cost_display_currency,
        )
        stats_by_id[item_id] = current

    for operation in return_operations:
        item_id = int(operation.get("item_id") or 0)
        if item_id <= 0:
            continue
        current = stats_by_id.get(item_id) or _empty_product_stats()
        _accumulate_product_stats(
            current,
            operation,
            is_refund=True,
            doc_currency_by_id=doc_currency_by_id,
            conversion_currency=conversion_currency,
            cost_display_currency=cost_display_currency,
        )
        stats_by_id[item_id] = current

    return stats_by_id


def _has_period_activity(stats: dict[str, Any]) -> bool:
    return float(stats.get("sold_quantity") or 0) > 0 or float(stats.get("refund_quantity") or 0) > 0


def _compute_product_totals(stats_by_id: dict[int, dict[str, Any]]) -> dict[str, float]:
    totals = {
        "sold_quantity": 0.0,
        "sold_purchase_cost": 0.0,
        "sold_total": 0.0,
        "refund_quantity": 0.0,
        "refund_purchase_cost": 0.0,
        "refund_total": 0.0,
        "net_sold_quantity": 0.0,
        "net_purchase_cost": 0.0,
        "net_total_sells": 0.0,
        "net_gross_profit": 0.0,
    }
    for stats in stats_by_id.values():
        if not _has_period_activity(stats):
            continue
        sold_qty = float(stats.get("sold_quantity") or 0)
        sold_total = float(stats.get("sold_total") or 0)
        refund_qty = float(stats.get("refund_quantity") or 0)
        sold_purchase_cost = float(stats.get("sold_purchase_cost") or 0)
        refund_purchase_cost = float(stats.get("refund_purchase_cost") or 0)
        refund_total = float(stats.get("refund_total") or 0)
        totals["sold_quantity"] = round(totals["sold_quantity"] + sold_qty, 2)
        totals["sold_purchase_cost"] = round(totals["sold_purchase_cost"] + sold_purchase_cost, 2)
        totals["sold_total"] = round(totals["sold_total"] + sold_total, 2)
        totals["refund_quantity"] = round(totals["refund_quantity"] + refund_qty, 2)
        totals["refund_purchase_cost"] = round(
            totals["refund_purchase_cost"] + refund_purchase_cost, 2
        )
        totals["refund_total"] = round(totals["refund_total"] + refund_total, 2)
        totals["net_sold_quantity"] = round(totals["net_sold_quantity"] + sold_qty - refund_qty, 2)
        totals["net_purchase_cost"] = round(
            totals["net_purchase_cost"] + sold_purchase_cost - refund_purchase_cost, 2
        )
        totals["net_total_sells"] = round(totals["net_total_sells"] + sold_total - refund_total, 2)
        totals["net_gross_profit"] = round(
            totals["net_gross_profit"]
            + round(sold_total - refund_total - (sold_purchase_cost - refund_purchase_cost), 2),
            2,
        )
    return totals


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
    stats_by_id: dict[int, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    product_by_id = {
        int(product["regos_item_id"]): product
        for product in catalog_products
        if isinstance(product.get("regos_item_id"), int)
    }
    if stats_by_id is None:
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
