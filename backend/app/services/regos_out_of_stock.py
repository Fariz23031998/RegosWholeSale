import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.regos_api import regos_async_api_request_for_company
from app.services import document_telegram_format as fmt
from app.services import out_of_stock_products as out_of_stock_products_service
from app.services import regos_document_fetch as doc_fetch
from app.services import telegram as telegram_service
from app.services.regos_defaults import get_stored_regos_defaults
from app.services.telegram_notification_scope import NotificationScope, scope_from_stock

logger = logging.getLogger("regos.backend")


@dataclass(frozen=True)
class StockDecreaseRule:
    resolve_stock_id: Callable[[dict[str, Any]], int | None]
    matches_document: Callable[[dict[str, Any]], bool] = lambda _doc: True


STOCK_DECREASE_RULES: dict[str, StockDecreaseRule] = {
    "DocInOutPerformCanceled": StockDecreaseRule(
        resolve_stock_id=doc_fetch.stock_id_from_document,
        matches_document=lambda doc: fmt.parse_inout_type(doc) == "income",
    ),
    "DocInOutPerformed": StockDecreaseRule(
        resolve_stock_id=doc_fetch.stock_id_from_document,
        matches_document=lambda doc: fmt.parse_inout_type(doc) == "outcome",
    ),
    "DocMovementPerformCanceled": StockDecreaseRule(
        resolve_stock_id=doc_fetch.stock_receiver_id_from_document,
    ),
    "DocMovementPerformed": StockDecreaseRule(
        resolve_stock_id=doc_fetch.stock_sender_id_from_document,
    ),
    "DocPurchasePerformCanceled": StockDecreaseRule(
        resolve_stock_id=doc_fetch.stock_id_from_document,
    ),
    "DocWholeSalePerformed": StockDecreaseRule(
        resolve_stock_id=doc_fetch.stock_id_from_document,
    ),
    "DocWholeSaleReturnPerformCanceled": StockDecreaseRule(
        resolve_stock_id=doc_fetch.stock_id_from_document,
    ),
    "DocReturnsToPartnerPerformed": StockDecreaseRule(
        resolve_stock_id=doc_fetch.stock_id_from_document,
    ),
}


def resolve_stock_id_for_event(event_action: str, document: dict[str, Any]) -> int | None:
    rule = STOCK_DECREASE_RULES.get(event_action)
    if rule is None or not rule.matches_document(document):
        return None
    return rule.resolve_stock_id(document)


def is_stock_decrease_event(event_action: str, document: dict[str, Any]) -> bool:
    return resolve_stock_id_for_event(event_action, document) is not None


def _coerce_number(*values: Any) -> float:
    for value in values:
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                continue
    return 0.0


def _optional_coerce_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _item_name(item: dict[str, Any], item_id: int) -> str:
    name = item.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    full_name = item.get("fullname")
    if isinstance(full_name, str) and full_name.strip():
        return full_name.strip()
    return f"#{item_id}"


def _item_text(value: Any) -> str:
    if isinstance(value, str):
        text = value.strip()
        return text
    if isinstance(value, (int, float)):
        return str(value)
    return ""


def _item_fields(item: dict[str, Any], item_id: int) -> dict[str, Any]:
    return {
        "product_id": item_id,
        "name": _item_name(item, item_id),
        "code": _item_text(item.get("code")),
        "barcode": _item_text(item.get("base_barcode")),
    }


async def fetch_items_stock_at_warehouse(
    session: AsyncSession,
    company_id: int,
    stock_id: int,
    item_ids: list[int],
) -> list[dict[str, Any]]:
    unique_ids = [item_id for item_id in dict.fromkeys(item_ids) if item_id > 0]
    if not unique_ids:
        return []

    defaults = await get_stored_regos_defaults(session, company_id)
    price_type = defaults.get("price_type")
    if not isinstance(price_type, dict) or price_type.get("id") is None:
        logger.warning(
            "Out-of-stock check skipped for company %s: price type not configured",
            company_id,
        )
        return []

    try:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            "item/getext",
            {
                "stock_id": stock_id,
                "price_type_id": int(price_type["id"]),
                "ids": unique_ids,
                "sort_orders": [{"column": "Name", "direction": "ASC"}],
                "zero_quantity": True,
                "zero_price": True,
                "image_size": "Medium",
                "type": "Item",
                "deleted_mark": False,
                "limit": len(unique_ids),
                "offset": 0,
            },
        )
    except Exception:
        logger.warning(
            "Failed to fetch item stock for company=%s stock=%s items=%s",
            company_id,
            stock_id,
            unique_ids,
            exc_info=True,
        )
        return []

    result = response.get("result") or []
    items: list[dict[str, Any]] = []
    for row in result:
        if not isinstance(row, dict):
            continue
        item = row.get("item") if isinstance(row.get("item"), dict) else {}
        quantity = row.get("quantity") if isinstance(row.get("quantity"), dict) else {}
        item_id = item.get("id")
        if not isinstance(item_id, int) or item_id <= 0:
            continue
        allowed = _coerce_number(quantity.get("allowed"), quantity.get("common"))
        min_quantity = _coerce_number(item.get("min_quantity"))
        fields = _item_fields(item, item_id)
        items.append(
            {
                **fields,
                "allowed": allowed,
                "min_quantity": min_quantity,
                "last_purchase_cost": _optional_coerce_number(row.get("last_purchase_cost")),
                "price": _coerce_number(row.get("price")),
            }
        )
    return items


def _cheque_sale_operations(operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sale_operations: list[dict[str, Any]] = []
    for operation in operations:
        if not isinstance(operation, dict):
            continue
        if operation.get("has_storno"):
            continue
        quantity = _coerce_number(operation.get("quantity"))
        if quantity <= 0:
            continue
        stock_id = operation.get("stock_id")
        if stock_id is None:
            continue
        try:
            parsed_stock_id = int(stock_id)
        except (TypeError, ValueError):
            continue
        if parsed_stock_id <= 0:
            continue
        sale_operations.append(operation)
    return sale_operations


def _item_ids_by_stock_from_cheque_operations(
    operations: list[dict[str, Any]],
) -> dict[int, list[int]]:
    items_by_stock: dict[int, list[int]] = {}
    seen_by_stock: dict[int, set[int]] = {}
    for operation in _cheque_sale_operations(operations):
        stock_id = int(operation["stock_id"])
        item_id = operation.get("item_id")
        if item_id is None:
            item = operation.get("item")
            if isinstance(item, dict):
                item_id = item.get("id")
        if item_id is None:
            continue
        try:
            parsed_item_id = int(item_id)
        except (TypeError, ValueError):
            continue
        if parsed_item_id <= 0:
            continue
        seen = seen_by_stock.setdefault(stock_id, set())
        if parsed_item_id in seen:
            continue
        seen.add(parsed_item_id)
        items_by_stock.setdefault(stock_id, []).append(parsed_item_id)
    return items_by_stock


async def _notify_out_of_stock_items(
    session: AsyncSession,
    company_id: int,
    stock_id: int,
    item_ids: list[int],
    *,
    stock_name: str | None = None,
) -> int:
    stock_items = await fetch_items_stock_at_warehouse(
        session,
        company_id,
        stock_id,
        item_ids,
    )
    if not stock_items:
        return 0

    warehouse_label = stock_name or str(stock_id)
    notified = 0
    for item in stock_items:
        if item["allowed"] > item["min_quantity"]:
            continue

        await out_of_stock_products_service.record_out_of_stock(
            session,
            company_id,
            int(item["product_id"]),
            stock_id,
        )

        product_name = str(item["name"])
        product_code = str(item.get("code") or "")
        product_barcode = str(item.get("barcode") or "")
        allowed = float(item["allowed"])
        min_quantity = float(item["min_quantity"])
        last_purchase_cost = item.get("last_purchase_cost")
        price = float(item.get("price") or 0)

        build_message = lambda lang, pn=product_name, pc=product_code, pb=product_barcode, wh=warehouse_label, a=allowed, mq=min_quantity, lpc=last_purchase_cost, pr=price: fmt.format_out_of_stock_notification(  # noqa: E731
            pn,
            wh,
            allowed=a,
            min_quantity=mq,
            code=pc,
            barcode=pb,
            last_purchase_cost=lpc,
            price=pr,
            lang=lang,
        )
        sent = await telegram_service.notify_company_subscribers(
            session,
            company_id,
            notification_type="out_of_stock",
            build_message=build_message,
            scope=scope_from_stock(stock_id),
        )
        if sent > 0:
            notified += 1

    return notified


async def check_and_record_out_of_stock(
    session: AsyncSession,
    company_id: int,
    event_action: str,
    document: dict[str, Any],
    operations: list[dict[str, Any]],
) -> int:
    stock_id = resolve_stock_id_for_event(event_action, document)
    if stock_id is None:
        return 0

    item_ids = doc_fetch.item_ids_from_operations(operations)
    if not item_ids:
        return 0

    stock_name = doc_fetch.stock_name_from_document(document)
    if not stock_name:
        stock_name = await doc_fetch.fetch_stock_name(session, company_id, stock_id)

    notified = await _notify_out_of_stock_items(
        session,
        company_id,
        stock_id,
        item_ids,
        stock_name=stock_name,
    )
    if notified > 0:
        await telegram_service.send_out_of_stock_excel_prompt(
            session,
            company_id,
            scope=scope_from_stock(stock_id),
        )
    return notified


async def check_and_record_out_of_stock_from_cheque(
    session: AsyncSession,
    company_id: int,
    cheque: dict[str, Any],
    operations: list[dict[str, Any]],
) -> int:
    if bool(cheque.get("is_return")):
        return 0

    items_by_stock = _item_ids_by_stock_from_cheque_operations(operations)
    if not items_by_stock:
        return 0

    notified = 0
    affected_stock_ids: set[int] = set()
    for stock_id, item_ids in items_by_stock.items():
        stock_name = await doc_fetch.fetch_stock_name(session, company_id, stock_id)
        stock_notified = await _notify_out_of_stock_items(
            session,
            company_id,
            stock_id,
            item_ids,
            stock_name=stock_name,
        )
        if stock_notified > 0:
            affected_stock_ids.add(stock_id)
        notified += stock_notified
    if notified > 0:
        scope = NotificationScope(
            stock_ids=frozenset(affected_stock_ids) if affected_stock_ids else None
        )
        await telegram_service.send_out_of_stock_excel_prompt(
            session,
            company_id,
            scope=scope,
        )
    return notified


def _latest_entries_by_pair(
    rows: list[Any],
) -> dict[tuple[int, int], Any]:
    latest: dict[tuple[int, int], Any] = {}
    for row in rows:
        key = (int(row.product_id), int(row.stock_id))
        current = latest.get(key)
        if current is None or row.created_at > current.created_at:
            latest[key] = row
    return latest


async def get_out_of_stock_report(
    session: AsyncSession,
    company_id: int,
    *,
    stock_ids: list[int] | None = None,
    all_stocks: bool = True,
) -> list[dict[str, Any]]:
    rows = await out_of_stock_products_service.list_out_of_stock_entries(
        session,
        company_id,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    if not rows:
        return []

    latest_by_pair = _latest_entries_by_pair(rows)
    items_by_stock: dict[int, list[int]] = {}
    for product_id, stock_id in latest_by_pair:
        items_by_stock.setdefault(stock_id, []).append(product_id)

    stock_names: dict[int, str] = {}
    report_rows: list[dict[str, Any]] = []

    for stock_id, product_ids in items_by_stock.items():
        stock_items = await fetch_items_stock_at_warehouse(
            session,
            company_id,
            stock_id,
            product_ids,
        )
        stock_items_by_id = {int(item["product_id"]): item for item in stock_items}

        for product_id in product_ids:
            item = stock_items_by_id.get(product_id)
            if item is None:
                continue
            if item["allowed"] > item["min_quantity"]:
                await out_of_stock_products_service.delete_out_of_stock_entries(
                    session,
                    company_id,
                    product_id,
                    stock_id,
                )
                continue

            entry = latest_by_pair[(product_id, stock_id)]
            if stock_id not in stock_names:
                fetched_name = await doc_fetch.fetch_stock_name(session, company_id, stock_id)
                stock_names[stock_id] = fetched_name or str(stock_id)

            report_rows.append(
                {
                    "product_id": product_id,
                    "product_name": str(item["name"]),
                    "code": str(item.get("code") or ""),
                    "barcode": str(item.get("barcode") or ""),
                    "stock_id": stock_id,
                    "stock_name": stock_names[stock_id],
                    "quantity": float(item["allowed"]),
                    "min_quantity": float(item["min_quantity"]),
                    "last_purchase_cost": item.get("last_purchase_cost"),
                    "price": float(item.get("price") or 0),
                    "detected_at": entry.created_at,
                }
            )

    report_rows.sort(
        key=lambda row: row["detected_at"],
        reverse=True,
    )
    return report_rows
