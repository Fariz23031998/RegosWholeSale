import asyncio
import hashlib
import hmac
import json
import re
import secrets
import time
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import parse_qsl

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError, bad_request, forbidden, not_found, unauthorized
from app.core.regos_api import regos_async_api_request_for_company
from app.core.regos_batch import regos_batch_request_chunks_for_company
from app.core.security import create_partner_telegram_token, hash_password, verify_password
from app.models import (
    PartnerTelegramAccount,
    PartnerTelegramBot,
    PartnerTelegramLinkState,
    PartnerTelegramPasswordCode,
)
from app.regos.doc_order_from_partner_statuses import DOC_ORDER_FROM_PARTNER_CONTINUABLE_STATUS_IDS
from app.services import partner_telegram as partner_telegram_service
from app.services import regos_defaults as regos_defaults_service
from app.services import regos_document_fetch as doc_fetch
from app.services import regos_groups
from app.services import regos_partners
from app.services import regos_partner_balance
from app.services import regos_payments
from app.services import regos_sales
from app.services import telegram as telegram_service
from app.services.regos_products.helpers.map_product.map_product import map_product
from app.services.telegram_i18n import t

EXCEL_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
_UNSAFE_FILENAME = re.compile(r"[^\w.\-]+", re.UNICODE)

INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60
PASSWORD_CODE_MINUTES = 10
CHEAP_PRICE_CUTOFF = "100000"
HISTORY_KINDS: dict[str, doc_fetch.OperationDocumentSpec] = {
    "purchase": doc_fetch.PURCHASE_SPEC,
    "purchase-return": doc_fetch.RETURN_TO_PARTNER_SPEC,
    "wholesale": doc_fetch.WHOLESALE_SPEC,
    "wholesale-return": doc_fetch.WHOLESALE_RETURN_SPEC,
}
DASHBOARD_PAGE_SIZE = 200
DASHBOARD_MAX_PAGES = 50


def validate_init_data(init_data: str, bot_token: str, *, now: int | None = None) -> dict[str, Any]:
    if not init_data or not init_data.strip():
        raise unauthorized("Telegram init data is missing", "PARTNER_TELEGRAM_INIT_DATA_INVALID")
    pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=False))
    received_hash = pairs.pop("hash", "")
    if not received_hash:
        raise unauthorized("Telegram init data is missing a hash", "PARTNER_TELEGRAM_INIT_DATA_INVALID")

    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    calculated = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calculated, received_hash):
        raise unauthorized("Telegram init data hash is invalid", "PARTNER_TELEGRAM_INIT_DATA_INVALID")

    try:
        auth_date = int(pairs.get("auth_date") or "0")
    except ValueError:
        auth_date = 0
    current = int(time.time()) if now is None else now
    if auth_date <= 0 or current - auth_date > INIT_DATA_MAX_AGE_SECONDS or auth_date - current > 60:
        raise unauthorized("Telegram init data has expired", "PARTNER_TELEGRAM_INIT_DATA_EXPIRED")

    raw_user = pairs.get("user")
    if not isinstance(raw_user, str) or not raw_user:
        raise unauthorized("Telegram init data has no user", "PARTNER_TELEGRAM_INIT_DATA_INVALID")
    try:
        user = json.loads(raw_user)
    except json.JSONDecodeError as exc:
        raise unauthorized("Telegram init data user is invalid", "PARTNER_TELEGRAM_INIT_DATA_INVALID") from exc
    if not isinstance(user, dict) or not isinstance(user.get("id"), int):
        raise unauthorized("Telegram init data user is invalid", "PARTNER_TELEGRAM_INIT_DATA_INVALID")
    return {"user": user, "auth_date": auth_date}


def _as_float(value: Any) -> float:
    if isinstance(value, bool) or value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return 0.0
    return 0.0


def available_quantity(row: dict[str, Any]) -> float:
    quantity = row.get("quantity") if isinstance(row.get("quantity"), dict) else {}
    allowed = _as_float(quantity.get("allowed"))
    common = _as_float(quantity.get("common"))
    if allowed > 0:
        return allowed
    return common


def _catalog_filters(filter_type: str | None) -> list[dict[str, str]]:
    if filter_type == "in-stock":
        return [{"field": "quantity.allowed", "operator": "Greater", "value": "0"}]
    if filter_type == "low-stock":
        return [
            {"field": "quantity.allowed", "operator": "Greater", "value": "0"},
            {"field": "quantity.allowed", "operator": "LessOrEqual", "value": "10"},
        ]
    if filter_type == "cheap":
        return [{"field": "price", "operator": "Less", "value": CHEAP_PRICE_CUTOFF}]
    if filter_type == "expensive":
        return [{"field": "price", "operator": "GreaterOrEqual", "value": CHEAP_PRICE_CUTOFF}]
    return []


def _catalog_product(row: dict[str, Any]) -> dict[str, Any]:
    product = map_product(row)
    return {
        "id": product["regos_item_id"],
        "name": product["name"],
        "price": product["price"],
        "available": available_quantity(row),
        "unit_name": product["unit_name"],
        "image": product["image"],
        "sku": product["sku"],
        "category": product["category"],
        "code": product["code"],
        "articul": product["articul"],
        "barcode": product["barcode"],
        "group_id": product.get("group_id"),
    }


async def company_warehouses(session: AsyncSession, company_id: int) -> list[dict[str, Any]]:
    options = await regos_defaults_service.list_reference_options(session, company_id)
    warehouses: list[dict[str, Any]] = []
    for item in options.get("warehouses") or []:
        if not isinstance(item, dict) or not isinstance(item.get("id"), int):
            continue
        name = item.get("name")
        warehouses.append(
            {
                "id": item["id"],
                "name": name.strip() if isinstance(name, str) and name.strip() else str(item["id"]),
            }
        )
    return warehouses


async def resolve_shop(
    session: AsyncSession,
    account_id: int,
    *,
    requested_warehouse_id: int | None = None,
) -> dict[str, Any]:
    account = await session.get(PartnerTelegramAccount, account_id)
    if account is None:
        raise unauthorized("Invalid token", "INVALID_TOKEN")
    bot = await session.get(PartnerTelegramBot, account.bot_id)
    if bot is None:
        raise not_found("Partner bot was not found", "PARTNER_TELEGRAM_BOT_NOT_FOUND")
    defaults = await _shop_defaults(session, account.company_id)
    price_type_id = _first_positive_id(
        account.price_type_id,
        bot.default_price_type_id,
        _option_id(defaults.get("price_type")),
    )
    warehouse_id = _first_positive_id(
        account.warehouse_id,
        bot.default_warehouse_id,
        _option_id(defaults.get("warehouse")),
    )
    if requested_warehouse_id is not None and bot.allow_catalog_warehouse_selection:
        warehouses = await company_warehouses(session, account.company_id)
        if not any(item["id"] == requested_warehouse_id for item in warehouses):
            raise bad_request("That warehouse is not available.", "PARTNER_WAREHOUSE_NOT_ALLOWED")
        warehouse_id = requested_warehouse_id
    defaults = await _fill_shop_defaults(
        session,
        account.company_id,
        defaults,
        warehouse_id=warehouse_id,
        price_type_id=price_type_id,
    )
    if (
        warehouse_id is None
        or price_type_id is None
        or _option_id(defaults.get("currency")) is None
    ):
        raise bad_request(
            "Warehouse, price type, and currency must be saved on the partner bot or in Settings before partners can order.",
            "PARTNER_SHOP_NOT_CONFIGURED",
        )
    return {
        "account": account,
        "bot": bot,
        "defaults": defaults,
        "warehouse_id": int(warehouse_id),
        "price_type_id": int(price_type_id),
        "allow_warehouse_selection": bool(bot.allow_catalog_warehouse_selection),
    }


def _option_id(value: Any) -> int | None:
    if not isinstance(value, dict):
        return None
    option_id = value.get("id")
    if isinstance(option_id, int) and option_id > 0:
        return option_id
    return None


def _first_positive_id(*values: int | None) -> int | None:
    for value in values:
        if isinstance(value, int) and value > 0:
            return value
    return None


async def _shop_defaults(session: AsyncSession, company_id: int) -> dict[str, Any]:
    return await regos_defaults_service.get_enriched_regos_defaults(session, company_id)


async def _fill_shop_defaults(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    *,
    warehouse_id: int | None,
    price_type_id: int | None,
) -> dict[str, Any]:
    """Currency follows the price type, and firm follows the warehouse.

    Company Settings can be empty when the partner bot already has a default
    warehouse and price type. Resolve those from Regos only when the stored
    defaults do not already include them.
    """
    filled = dict(defaults)
    if price_type_id is not None and (
        _option_id(filled.get("price_type")) is None or _option_id(filled.get("currency")) is None
    ):
        price_type, currency = await regos_defaults_service._resolve_price_type_reference(
            session, company_id, price_type_id
        )
        if price_type is not None:
            filled["price_type"] = price_type
        if currency is not None:
            filled["currency"] = currency
    if warehouse_id is not None and _option_id(filled.get("warehouse")) is None:
        warehouse, firm = await regos_defaults_service._resolve_warehouse_reference(
            session, company_id, warehouse_id
        )
        if warehouse is not None:
            filled["warehouse"] = warehouse
        if firm is not None:
            filled["firm"] = firm
    return filled


def _date_bound(value: str | None, *, end: bool) -> int | None:
    if not value:
        return None
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError as exc:
        raise bad_request("Dates must use YYYY-MM-DD.", "INVALID_DATE") from exc
    if end:
        parsed = parsed.replace(hour=23, minute=59, second=59)
    return int(parsed.timestamp())


def _history_spec(kind: str) -> doc_fetch.OperationDocumentSpec:
    spec = HISTORY_KINDS.get(kind)
    if spec is None:
        raise bad_request("Unknown document kind.", "PARTNER_DOCUMENT_KIND_INVALID")
    return spec


def _document_partner_matches(document: dict[str, Any], partner_id: int) -> bool:
    found = partner_telegram_service.document_partner_id(document)
    return found == partner_id


def _partner_payment_direction(direction: Any) -> Any:
    """Flip firm-ledger payment direction into the partner's perspective."""
    if direction == "income":
        return "outcome"
    if direction == "outcome":
        return "income"
    return direction


def currency_code(currency: Any) -> str:
    if not isinstance(currency, dict):
        return ""
    code = currency.get("code_chr")
    if isinstance(code, str) and code.strip():
        return code.strip()
    name = currency.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    return ""


def _nested_name(value: Any) -> str | None:
    if isinstance(value, dict):
        name = value.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return None


def _map_document_summary(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": document.get("id"),
        "code": document.get("code"),
        "date": document.get("date"),
        "amount": document.get("amount"),
        "description": document.get("description") or "",
        "status_id": document.get("status_id"),
        "performed": document.get("performed"),
        "stock_name": _nested_name(document.get("stock")),
        "partner_name": _nested_name(document.get("partner")),
    }


def _map_operation(operation: dict[str, Any], *, use_cost: bool) -> dict[str, Any]:
    item = operation.get("item") if isinstance(operation.get("item"), dict) else {}
    name = item.get("name") if isinstance(item.get("name"), str) and item.get("name") else "Item"
    code = item.get("code")
    quantity = _as_float(operation.get("quantity"))
    price = _as_float(operation.get("cost") if use_cost else operation.get("price"))
    return {
        "item_code": code.strip() if isinstance(code, str) and code.strip() else None,
        "item_name": name,
        "quantity": quantity,
        "price": price,
        "total": quantity * price,
    }


async def authenticate(
    session: AsyncSession, *, public_key: str, init_data: str
) -> dict[str, Any]:
    bot = await partner_telegram_service._get_bot_by_public_key(session, public_key)
    if bot is None:
        raise not_found("Partner bot was not found", "PARTNER_TELEGRAM_BOT_NOT_FOUND")
    if not await partner_telegram_service._subscription_allows(session, bot.company_id):
        raise unauthorized("Subscription has expired", "SUBSCRIPTION_EXPIRED")

    parsed = validate_init_data(init_data, bot.bot_token)
    telegram_user_id = int(parsed["user"]["id"])
    account = await partner_telegram_service._get_account(session, bot.company_id, telegram_user_id)
    if account is None:
        raise unauthorized(
            "Open the bot and share your phone number first.",
            "PARTNER_TELEGRAM_NOT_REGISTERED",
        )

    partner_name = None
    if account.link_state == PartnerTelegramLinkState.linked.value and account.regos_partner_id:
        partner_name = await partner_telegram_service._partner_name(
            session, bot.company_id, account.regos_partner_id
        )
    token = create_partner_telegram_token(account_id=account.id, company_id=account.company_id)
    return {
        "access_token": token,
        "account": partner_telegram_service.account_to_dict(account, partner_name, bot=bot),
    }


async def account_profile(session: AsyncSession, account_id: int) -> dict[str, Any]:
    row = await session.get(PartnerTelegramAccount, account_id)
    if row is None:
        raise unauthorized("Invalid token", "INVALID_TOKEN")
    partner_name = None
    if row.link_state == PartnerTelegramLinkState.linked.value and row.regos_partner_id:
        partner_name = await partner_telegram_service._partner_name(
            session, row.company_id, row.regos_partner_id
        )
    bot = await partner_telegram_service._get_bot_by_company(session, row.company_id)
    return partner_telegram_service.account_to_dict(row, partner_name, bot=bot)


async def require_partner_page(session: AsyncSession, account_id: int, page_key: str) -> None:
    account = await session.get(PartnerTelegramAccount, account_id)
    if account is None:
        raise unauthorized("Invalid token", "INVALID_TOKEN")
    bot = await partner_telegram_service._get_bot_by_company(session, account.company_id)
    pages = partner_telegram_service.resolve_enabled_pages(
        bot.enabled_pages if bot is not None else None,
        account.page_overrides,
    )
    if not pages.get(page_key, True):
        raise forbidden("This partner page is disabled.", "PARTNER_PAGE_DISABLED")


async def catalog_options(session: AsyncSession, account_id: int) -> dict[str, Any]:
    context = await resolve_shop(session, account_id)
    warehouses: list[dict[str, Any]] = []
    if context["allow_warehouse_selection"]:
        warehouses = await company_warehouses(session, context["account"].company_id)
    currency = context["defaults"]["currency"]
    return {
        "warehouse_id": context["warehouse_id"],
        "allow_warehouse_selection": context["allow_warehouse_selection"],
        "warehouses": warehouses,
        "currency_name": currency.get("name") or "",
        "currency_code": currency_code(currency),
        "show_product_quantities": bool(context["bot"].show_product_quantities),
        "auto_open_qty_keypad": bool(context["bot"].auto_open_qty_keypad),
    }


async def list_products(
    session: AsyncSession,
    account_id: int,
    *,
    offset: int = 0,
    limit: int = 20,
    search: str | None = None,
    group_id: int | None = None,
    filter_type: str | None = "in-stock",
    warehouse_id: int | None = None,
    price_type_id: int | None = None,
) -> dict[str, Any]:
    # Partners cannot pick a price type. A client-supplied id is ignored.
    del price_type_id
    context = await resolve_shop(session, account_id, requested_warehouse_id=warehouse_id)
    defaults = context["defaults"]
    company_id = context["account"].company_id
    if filter_type not in {None, "", "in-stock", "low-stock", "cheap", "expensive"}:
        raise bad_request("Unknown catalog filter.", "PARTNER_CATALOG_FILTER_INVALID")
    safe_limit = min(max(limit, 1), 50)
    safe_offset = max(offset, 0)
    payload: dict[str, Any] = {
        "stock_id": context["warehouse_id"],
        "price_type_id": context["price_type_id"],
        "sort_orders": [{"column": "Name", "direction": "ASC"}],
        "zero_quantity": filter_type not in {"in-stock", "low-stock"},
        "zero_price": False,
        "image_size": "Large",
        "type": "Item",
        "deleted_mark": False,
        "limit": safe_limit,
        "offset": safe_offset,
    }
    allowed_groups = await _allowed_catalog_group_ids(session, context["bot"], company_id)
    if (
        allowed_groups is not None
        and group_id is not None
        and group_id > 0
        and group_id not in allowed_groups
    ):
        return _empty_catalog(context)
    if search and search.strip():
        payload["search"] = search.strip()
    if group_id is not None and group_id > 0:
        payload["group_ids"] = [group_id]
    elif allowed_groups is not None:
        payload["group_ids"] = sorted(allowed_groups)
    filters = _catalog_filters(filter_type or None)
    if filters:
        payload["filters"] = filters

    response = await regos_async_api_request_for_company(session, company_id, "item/getext", payload)
    products = []
    for row in response.get("result") or []:
        if not isinstance(row, dict):
            continue
        try:
            products.append(_catalog_product(row))
        except Exception:
            continue
    total = response.get("total")
    next_offset = response.get("next_offset")
    return {
        "products": products,
        "next_offset": next_offset if isinstance(next_offset, int) else safe_offset + len(products),
        "total": total if isinstance(total, int) else len(products),
        "currency_name": defaults["currency"].get("name") or "",
        "currency_code": currency_code(defaults["currency"]),
        "warehouse_id": context["warehouse_id"],
        "price_type_id": context["price_type_id"],
    }


async def list_product_groups(session: AsyncSession, account_id: int) -> dict[str, Any]:
    account = await session.get(PartnerTelegramAccount, account_id)
    if account is None:
        raise unauthorized("Invalid token", "INVALID_TOKEN")
    bot = await session.get(PartnerTelegramBot, account.bot_id)
    if bot is None:
        raise not_found("Partner bot was not found", "PARTNER_TELEGRAM_BOT_NOT_FOUND")
    listed = await regos_groups.list_groups(session, account.company_id)
    groups = listed.get("groups") or []
    allowed = await _allowed_catalog_group_ids(
        session, bot, account.company_id, groups=groups
    )
    if allowed is None:
        return listed
    return {
        "groups": [
            group
            for group in groups
            if isinstance(group.get("id"), int) and group["id"] in allowed
        ]
    }


async def _allowed_catalog_group_ids(
    session: AsyncSession,
    bot: PartnerTelegramBot,
    company_id: int,
    *,
    groups: list[dict[str, Any]] | None = None,
) -> set[int] | None:
    from app.services.category_scope import expand_product_group_ids
    from app.services.pos_settings import _normalize_id_list

    selected = _normalize_id_list(bot.catalog_product_group_ids)
    if not selected:
        return None
    if groups is None:
        try:
            groups = (await regos_groups.list_groups(session, company_id)).get("groups") or []
        except AppError:
            return set(selected)
    return expand_product_group_ids(selected, groups)


def _empty_catalog(context: dict[str, Any]) -> dict[str, Any]:
    currency = context["defaults"]["currency"]
    return {
        "products": [],
        "next_offset": 0,
        "total": 0,
        "currency_name": currency.get("name") or "",
        "currency_code": currency_code(currency),
        "warehouse_id": context["warehouse_id"],
        "price_type_id": context["price_type_id"],
    }


def _product_group_allowed(product: dict[str, Any], allowed: set[int] | None) -> bool:
    if allowed is None:
        return True
    from app.services.category_scope import product_in_allowed_groups

    return product_in_allowed_groups(product, allowed)


async def _load_products_for_order(
    session: AsyncSession,
    company_id: int,
    product_ids: list[int],
    *,
    warehouse_id: int,
    price_type_id: int,
) -> dict[int, dict[str, Any]]:
    unique_ids = list(dict.fromkeys(product_id for product_id in product_ids if product_id > 0))
    if not unique_ids:
        return {}
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "item/getext",
        {
            "stock_id": warehouse_id,
            "price_type_id": price_type_id,
            "ids": unique_ids,
            "zero_quantity": True,
            "zero_price": True,
            "image_size": "Medium",
            "type": "Item",
            "deleted_mark": False,
            "limit": len(unique_ids),
            "offset": 0,
        },
    )
    found: dict[int, dict[str, Any]] = {}
    for row in response.get("result") or []:
        if not isinstance(row, dict):
            continue
        try:
            product = _catalog_product(row)
        except Exception:
            continue
        found[int(product["id"])] = product
    return found


def _order_description(
    *,
    lang: str,
    is_takeaway: bool,
    address: str,
    phone: str | None,
) -> str:
    if is_takeaway:
        lines = [t("partnerTelegram.order.takeaway", lang)]
    else:
        lines = [t("partnerTelegram.order.address", lang, address=address.strip())]
    if phone and phone.strip():
        lines.append(t("partnerTelegram.order.phone", lang, phone=phone.strip()))
    else:
        lines.append(t("partnerTelegram.order.phoneMissing", lang))
    return "\n".join(lines)


async def create_order(
    session: AsyncSession,
    *,
    account_id: int,
    company_id: int,
    partner_id: int,
    language_code: str | None,
    is_takeaway: bool,
    address: str,
    phone: str | None,
    items: list[dict[str, Any]],
    warehouse_id: int | None = None,
) -> dict[str, Any]:
    if not items:
        raise bad_request("Add at least one product.", "PARTNER_ORDER_EMPTY")
    if not is_takeaway and not address.strip():
        raise bad_request("Delivery address is required.", "PARTNER_ORDER_ADDRESS_REQUIRED")

    context = await resolve_shop(session, account_id, requested_warehouse_id=warehouse_id)
    defaults = dict(context["defaults"])
    defaults["warehouse"] = {**defaults["warehouse"], "id": context["warehouse_id"]}
    defaults["price_type"] = {**defaults["price_type"], "id": context["price_type_id"]}
    partner = await regos_partners.get_partner_by_id(session, company_id, partner_id)
    defaults = dict(defaults)
    defaults["partner"] = {"id": partner_id, "name": partner.get("name") or str(partner_id)}

    requested: list[tuple[int, float]] = []
    for item in items:
        product_id = int(item["product_id"])
        quantity = float(item["quantity"])
        if product_id <= 0 or quantity <= 0:
            raise bad_request("Each line needs a product and a quantity.", "PARTNER_ORDER_LINE_INVALID")
        requested.append((product_id, quantity))

    catalog = await _load_products_for_order(
        session,
        company_id,
        [product_id for product_id, _quantity in requested],
        warehouse_id=context["warehouse_id"],
        price_type_id=context["price_type_id"],
    )
    allowed_groups = await _allowed_catalog_group_ids(session, context["bot"], company_id)
    lines: list[dict[str, Any]] = []
    for product_id, quantity in requested:
        product = catalog.get(product_id)
        if product is None or not _product_group_allowed(product, allowed_groups):
            raise bad_request(f"Product {product_id} is not available.", "PARTNER_ORDER_PRODUCT_UNAVAILABLE")
        available = float(product["available"])
        if available <= 0 or quantity > available:
            raise bad_request(
                f"{product['name']} exceeds available stock.",
                "PARTNER_ORDER_INSUFFICIENT_STOCK",
            )
        price = float(product["price"])
        lines.append(
            {
                "regos_item_id": product_id,
                "qty": quantity,
                "price": price,
                "price2": price,
            }
        )

    lang = language_code if language_code in partner_telegram_service.PARTNER_LANGUAGES else "ru"
    description = _order_description(
        lang=lang, is_takeaway=is_takeaway, address=address, phone=phone
    )
    bot = context["bot"]
    if _bot_order_document_type(bot) == "doc_wholesale":
        order_doc = await regos_sales.create_partner_wholesale_draft(
            session, company_id, defaults, description, lines
        )
    else:
        order_doc = await regos_sales.create_booked_partner_order(
            session,
            company_id,
            defaults,
            description,
            lines,
            booked=bool(getattr(bot, "order_booked", True)),
        )
    return {"order_id": order_doc["id"], "code": order_doc.get("code")}


def _bot_order_document_type(bot: PartnerTelegramBot | None) -> str:
    if bot is None:
        return "doc_order_from_partner"
    return partner_telegram_service._normalize_order_document_type(
        getattr(bot, "order_document_type", None)
    )


async def list_orders(
    session: AsyncSession,
    company_id: int,
    partner_id: int,
    *,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    bot = await partner_telegram_service._get_bot_by_company(session, company_id)
    start = _date_bound(start_date, end=False)
    end = _date_bound(end_date, end=True)
    if _bot_order_document_type(bot) == "doc_wholesale":
        payload: dict[str, Any] = {
            "partner_ids": [partner_id],
            "performed": False,
            "deleted_mark": False,
            "sort_orders": [{"column": "Date", "direction": "DESC"}],
            "limit": 50,
            "offset": 0,
        }
        if start is not None:
            payload["start_date"] = start
        if end is not None:
            payload["end_date"] = end
        response = await regos_async_api_request_for_company(
            session, company_id, "docwholesale/get", payload
        )
        documents = [
            _map_document_summary(row)
            for row in response.get("result") or []
            if isinstance(row, dict)
            and _document_partner_matches(row, partner_id)
            and not bool(row.get("performed"))
        ]
        return {"orders": documents}

    payload = {
        "partner_ids": [partner_id],
        "status_ids": sorted(DOC_ORDER_FROM_PARTNER_CONTINUABLE_STATUS_IDS),
        "deleted_mark": False,
        "sort_orders": [{"column": "Date", "direction": "DESC"}],
        "limit": 50,
        "offset": 0,
    }
    if start is not None:
        payload["start_date"] = start
    if end is not None:
        payload["end_date"] = end
    response = await regos_async_api_request_for_company(
        session, company_id, "docorderfrompartner/get", payload
    )
    documents = [
        _map_document_summary(row)
        for row in response.get("result") or []
        if isinstance(row, dict) and _document_partner_matches(row, partner_id)
    ]
    return {"orders": documents}


async def get_order(
    session: AsyncSession, company_id: int, partner_id: int, order_id: int
) -> dict[str, Any]:
    bot = await partner_telegram_service._get_bot_by_company(session, company_id)
    if _bot_order_document_type(bot) == "doc_wholesale":
        document = await doc_fetch.fetch_document(
            session, company_id, "docwholesale/get", order_id
        )
        if (
            not document
            or not _document_partner_matches(document, partner_id)
            or bool(document.get("performed"))
        ):
            raise not_found("Order not found.", "PARTNER_ORDER_NOT_FOUND")
        operations = await doc_fetch.fetch_operations(
            session, company_id, "wholesaleoperation/get", order_id
        )
        return {
            "order": _map_document_summary(document),
            "operations": [_map_operation(row, use_cost=False) for row in operations or []],
        }

    document = await doc_fetch.fetch_document(
        session, company_id, "docorderfrompartner/get", order_id
    )
    if not document or not _document_partner_matches(document, partner_id):
        raise not_found("Order not found.", "PARTNER_ORDER_NOT_FOUND")
    operations = await doc_fetch.fetch_operations(
        session, company_id, "orderfrompartneroperation/get", order_id
    )
    return {
        "order": _map_document_summary(document),
        "operations": [_map_operation(row, use_cost=False) for row in operations or []],
    }


async def list_documents(
    session: AsyncSession,
    company_id: int,
    partner_id: int,
    kind: str,
    *,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    spec = _history_spec(kind)
    payload: dict[str, Any] = {
        "partner_ids": [partner_id],
        "performed": True,
        "limit": 50,
        "offset": 0,
    }
    start = _date_bound(start_date, end=False)
    end = _date_bound(end_date, end=True)
    if start is not None:
        payload["start_date"] = start
    if end is not None:
        payload["end_date"] = end
    response = await regos_async_api_request_for_company(
        session, company_id, spec.doc_endpoint, payload
    )
    documents = []
    for row in response.get("result") or []:
        if not isinstance(row, dict) or not _document_partner_matches(row, partner_id):
            continue
        if not bool(row.get("performed")):
            continue
        documents.append(_map_document_summary(row))
    return {"documents": documents}


async def get_document(
    session: AsyncSession,
    company_id: int,
    partner_id: int,
    kind: str,
    document_id: int,
) -> dict[str, Any]:
    spec = _history_spec(kind)
    document = await doc_fetch.fetch_document(session, company_id, spec.doc_endpoint, document_id)
    if (
        not document
        or not _document_partner_matches(document, partner_id)
        or not bool(document.get("performed"))
    ):
        raise not_found("Document not found.", "PARTNER_DOCUMENT_NOT_FOUND")
    operations = await doc_fetch.fetch_operations(
        session, company_id, spec.ops_endpoint, document_id
    )
    return {
        "document": _map_document_summary(document),
        "operations": [_map_operation(row, use_cost=spec.use_cost) for row in operations or []],
    }


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


async def _bot_for_login(session: AsyncSession, public_key: str) -> PartnerTelegramBot:
    bot = await partner_telegram_service._get_bot_by_public_key(session, public_key)
    if bot is None:
        raise not_found("Partner bot was not found", "PARTNER_TELEGRAM_BOT_NOT_FOUND")
    if not await partner_telegram_service._subscription_allows(session, bot.company_id):
        raise unauthorized("Subscription has expired", "SUBSCRIPTION_EXPIRED")
    return bot


def _session_payload(
    account: PartnerTelegramAccount,
    partner_name: str | None,
    *,
    bot: PartnerTelegramBot | None = None,
) -> dict[str, Any]:
    token = create_partner_telegram_token(account_id=account.id, company_id=account.company_id)
    return {
        "access_token": token,
        "account": partner_telegram_service.account_to_dict(account, partner_name, bot=bot),
    }


async def _account_partner_name(session: AsyncSession, account: PartnerTelegramAccount) -> str | None:
    if account.link_state == PartnerTelegramLinkState.linked.value and account.regos_partner_id:
        return await partner_telegram_service._partner_name(
            session, account.company_id, account.regos_partner_id
        )
    return None


async def login_with_password(
    session: AsyncSession, *, public_key: str, phone: str, password: str
) -> dict[str, Any]:
    bot = await _bot_for_login(session, public_key)
    try:
        account = await partner_telegram_service.find_bot_account_by_phone(session, bot, phone)
    except AppError as exc:
        if exc.code == "PARTNER_PHONE_AMBIGUOUS":
            raise
        raise unauthorized("Phone or password is incorrect.", "PARTNER_LOGIN_INVALID") from exc
    if not account.password_hash or not verify_password(password, account.password_hash):
        raise unauthorized("Phone or password is incorrect.", "PARTNER_LOGIN_INVALID")
    return _session_payload(account, await _account_partner_name(session, account), bot=bot)


async def request_password_code(session: AsyncSession, *, public_key: str, phone: str) -> dict[str, str]:
    bot = await _bot_for_login(session, public_key)
    account = await partner_telegram_service.find_bot_account_by_phone(session, bot, phone)
    code = f"{secrets.randbelow(900000) + 100000}"
    await session.execute(
        delete(PartnerTelegramPasswordCode).where(PartnerTelegramPasswordCode.account_id == account.id)
    )
    session.add(
        PartnerTelegramPasswordCode(
            account_id=account.id,
            code=code,
            expires_at=datetime.now(UTC) + timedelta(minutes=PASSWORD_CODE_MINUTES),
        )
    )
    await session.flush()
    lang = account.language_code if account.language_code in partner_telegram_service.PARTNER_LANGUAGES else "ru"
    sent = await partner_telegram_service._send(
        bot,
        account.chat_id,
        t("partnerTelegram.passwordCode", lang, code=code),
    )
    if not sent:
        await session.execute(
            delete(PartnerTelegramPasswordCode).where(PartnerTelegramPasswordCode.account_id == account.id)
        )
        await session.flush()
        raise bad_request("The password code could not be sent.", "PARTNER_PASSWORD_CODE_NOT_SENT")
    return {"message": "Password code sent"}


async def confirm_password(
    session: AsyncSession,
    *,
    public_key: str,
    phone: str,
    code: str,
    password: str,
) -> dict[str, Any]:
    bot = await _bot_for_login(session, public_key)
    account = await partner_telegram_service.find_bot_account_by_phone(session, bot, phone)
    result = await session.execute(
        select(PartnerTelegramPasswordCode)
        .where(PartnerTelegramPasswordCode.account_id == account.id)
        .order_by(PartnerTelegramPasswordCode.id.desc())
    )
    row = result.scalars().first()
    supplied = code.strip()
    if (
        row is None
        or len(supplied) != len(row.code)
        or not hmac.compare_digest(row.code, supplied)
        or _aware(row.expires_at) < datetime.now(UTC)
    ):
        raise unauthorized("That code is invalid or expired.", "PARTNER_PASSWORD_CODE_INVALID")
    account.password_hash = hash_password(password)
    await session.execute(
        delete(PartnerTelegramPasswordCode).where(PartnerTelegramPasswordCode.account_id == account.id)
    )
    if account.link_state != PartnerTelegramLinkState.linked.value or not account.regos_partner_id:
        await partner_telegram_service.link_or_create_partner(session, bot, account)
    await session.flush()
    return _session_payload(account, await _account_partner_name(session, account), bot=bot)


async def list_payments(
    session: AsyncSession,
    company_id: int,
    partner_id: int,
    *,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "partner_ids": [partner_id],
        "performed": True,
        "deleted_mark": False,
        "sort_orders": [{"column": "Date", "direction": "desc"}],
        "limit": 50,
        "offset": 0,
    }
    start = _date_bound(start_date, end=False)
    end = _date_bound(end_date, end=True)
    if start is not None:
        payload["start_date"] = start
    if end is not None:
        payload["end_date"] = end
    response = await regos_async_api_request_for_company(
        session, company_id, "docpayment/get", payload
    )
    payments = []
    for row in response.get("result") or []:
        if not isinstance(row, dict) or not _document_partner_matches(row, partner_id):
            continue
        mapped = regos_payments.map_payment_document(row)
        if not mapped.get("performed"):
            continue
        payments.append(
            {
                "id": mapped.get("id"),
                "code": mapped.get("code"),
                "date": mapped.get("date"),
                "amount": mapped.get("amount"),
                "description": mapped.get("description") or "",
                "payment_direction": _partner_payment_direction(mapped.get("payment_direction")),
                "payment_type_name": mapped.get("payment_type_name"),
                "performed": mapped.get("performed"),
            }
        )
    return {"payments": payments}


async def reconciliation(
    session: AsyncSession,
    company_id: int,
    partner_id: int,
    *,
    start_date: str,
    end_date: str,
) -> dict[str, Any]:
    start = _date_bound(start_date, end=False)
    end = _date_bound(end_date, end=True)
    if start is None or end is None:
        raise bad_request("Choose a start and end date.", "INVALID_DATE")
    return await regos_partner_balance.get_partner_balance(
        session,
        company_id,
        partner_id=partner_id,
        start_date=start,
        end_date=end,
    )


def _day_key(value: Any) -> str | None:
    if not isinstance(value, int) or value <= 0:
        return None
    return datetime.fromtimestamp(value, tz=UTC).strftime("%Y-%m-%d")


def _amount_and_count(rows: list[dict[str, Any]]) -> tuple[float, int]:
    total = 0.0
    for row in rows:
        total += _as_float(row.get("amount"))
    return round(total, 2), len(rows)


def _net_debt_from_lines(lines: list[dict[str, Any]]) -> tuple[float, list[dict[str, Any]]]:
    gross = 0.0
    credit = 0.0
    by_currency: dict[str, dict[str, Any]] = {}
    for line in lines:
        amount = _as_float(line.get("amount"))
        if amount == 0:
            continue
        if amount > 0:
            gross += amount
        else:
            credit += abs(amount)
        code = ""
        raw_code = line.get("currency_code")
        raw_name = line.get("currency_name")
        if isinstance(raw_code, str) and raw_code.strip():
            code = raw_code.strip()
        elif isinstance(raw_name, str) and raw_name.strip():
            code = raw_name.strip()
        key = code or str(line.get("currency_id") or "none")
        current = by_currency.get(key)
        if current is None:
            current = {"currency_code": code or None, "amount": 0.0}
            by_currency[key] = current
        current["amount"] = round(current["amount"] + amount, 2)
    net = round(max(0.0, gross - credit), 2)
    debt_by_currency = sorted(
        by_currency.values(),
        key=lambda item: abs(float(item["amount"])),
        reverse=True,
    )
    return net, debt_by_currency


def _empty_day_bucket(day: str) -> dict[str, Any]:
    return {
        "day": day,
        "shipments": 0.0,
        "shipment_returns": 0.0,
        "purchases": 0.0,
        "purchase_returns": 0.0,
        "payments_in": 0.0,
        "payments_out": 0.0,
    }


def _add_to_day(
    buckets: dict[str, dict[str, Any]],
    *,
    date_value: Any,
    field: str,
    amount: float,
) -> None:
    day = _day_key(date_value)
    if day is None or amount == 0:
        return
    bucket = buckets.get(day)
    if bucket is None:
        bucket = _empty_day_bucket(day)
        buckets[day] = bucket
    bucket[field] = round(float(bucket[field]) + amount, 2)


async def _fetch_partner_document_pages(
    session: AsyncSession,
    company_id: int,
    partner_id: int,
    *,
    endpoint: str,
    payload_base: dict[str, Any],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    for _ in range(DASHBOARD_MAX_PAGES):
        payload = {**payload_base, "limit": DASHBOARD_PAGE_SIZE, "offset": offset}
        response = await regos_async_api_request_for_company(
            session, company_id, endpoint, payload
        )
        batch = response.get("result") or []
        if not isinstance(batch, list):
            batch = []
        matched = [
            row
            for row in batch
            if isinstance(row, dict) and _document_partner_matches(row, partner_id)
        ]
        rows.extend(matched)
        if len(batch) < DASHBOARD_PAGE_SIZE:
            break
        next_offset = response.get("next_offset")
        if isinstance(next_offset, int) and next_offset > offset:
            offset = next_offset
        else:
            offset += DASHBOARD_PAGE_SIZE
        if not batch:
            break
    return rows


async def get_partner_dashboard_summary(
    session: AsyncSession,
    company_id: int,
    partner_id: int,
    *,
    start_date: str | None,
    end_date: str,
) -> dict[str, Any]:
    start = _date_bound(start_date, end=False)
    end = _date_bound(end_date, end=True)
    if end is None:
        raise bad_request("Choose an end date.", "INVALID_DATE")

    date_payload: dict[str, Any] = {"end_date": end}
    if start is not None:
        date_payload["start_date"] = start

    async def load_kind(kind: str) -> list[dict[str, Any]]:
        spec = _history_spec(kind)
        return await _fetch_partner_document_pages(
            session,
            company_id,
            partner_id,
            endpoint=spec.doc_endpoint,
            payload_base={
                "partner_ids": [partner_id],
                "performed": True,
                **date_payload,
            },
        )

    async def load_orders() -> list[dict[str, Any]]:
        return await _fetch_partner_document_pages(
            session,
            company_id,
            partner_id,
            endpoint="docorderfrompartner/get",
            payload_base={
                "partner_ids": [partner_id],
                "deleted_mark": False,
                "sort_orders": [{"column": "Date", "direction": "DESC"}],
                **date_payload,
            },
        )

    async def load_payments() -> list[dict[str, Any]]:
        return await _fetch_partner_document_pages(
            session,
            company_id,
            partner_id,
            endpoint="docpayment/get",
            payload_base={
                "partner_ids": [partner_id],
                "performed": True,
                "deleted_mark": False,
                "sort_orders": [{"column": "Date", "direction": "desc"}],
                **date_payload,
            },
        )

    (
        wholesale_rows,
        wholesale_return_rows,
        purchase_rows,
        purchase_return_rows,
        order_rows,
        payment_rows,
        debt_payload,
    ) = await asyncio.gather(
        load_kind("wholesale"),
        load_kind("wholesale-return"),
        load_kind("purchase"),
        load_kind("purchase-return"),
        load_orders(),
        load_payments(),
        regos_partner_balance.get_partner_debt(
            session, company_id, partner_id=partner_id
        ),
    )

    shipments_total, shipments_count = _amount_and_count(wholesale_rows)
    shipment_returns_total, shipment_returns_count = _amount_and_count(wholesale_return_rows)
    purchases_total, purchases_count = _amount_and_count(purchase_rows)
    purchase_returns_total, purchase_returns_count = _amount_and_count(purchase_return_rows)
    orders_amount, orders_count = _amount_and_count(order_rows)

    payments_in = 0.0
    payments_out = 0.0
    payments_in_count = 0
    payments_out_count = 0
    day_buckets: dict[str, dict[str, Any]] = {}

    for row in wholesale_rows:
        amount = _as_float(row.get("amount"))
        _add_to_day(day_buckets, date_value=row.get("date"), field="shipments", amount=amount)
    for row in wholesale_return_rows:
        amount = _as_float(row.get("amount"))
        _add_to_day(
            day_buckets, date_value=row.get("date"), field="shipment_returns", amount=amount
        )
    for row in purchase_rows:
        amount = _as_float(row.get("amount"))
        _add_to_day(day_buckets, date_value=row.get("date"), field="purchases", amount=amount)
    for row in purchase_return_rows:
        amount = _as_float(row.get("amount"))
        _add_to_day(
            day_buckets, date_value=row.get("date"), field="purchase_returns", amount=amount
        )

    for row in payment_rows:
        mapped = regos_payments.map_payment_document(row)
        if not mapped.get("performed"):
            continue
        amount = _as_float(mapped.get("amount"))
        direction = _partner_payment_direction(mapped.get("payment_direction"))
        if direction == "income":
            payments_in += amount
            payments_in_count += 1
            _add_to_day(
                day_buckets,
                date_value=mapped.get("date"),
                field="payments_in",
                amount=amount,
            )
        elif direction == "outcome":
            payments_out += amount
            payments_out_count += 1
            _add_to_day(
                day_buckets,
                date_value=mapped.get("date"),
                field="payments_out",
                amount=amount,
            )

    debt_lines = debt_payload.get("lines") if isinstance(debt_payload, dict) else []
    if not isinstance(debt_lines, list):
        debt_lines = []
    net_debt, debt_by_currency = _net_debt_from_lines(
        [line for line in debt_lines if isinstance(line, dict)]
    )

    days = [day_buckets[key] for key in sorted(day_buckets.keys())]

    return {
        "period": {"start_date": start_date or "", "end_date": end_date},
        "totals": {
            "shipments": shipments_total,
            "shipments_count": shipments_count,
            "shipment_returns": shipment_returns_total,
            "shipment_returns_count": shipment_returns_count,
            "purchases": purchases_total,
            "purchases_count": purchases_count,
            "purchase_returns": purchase_returns_total,
            "purchase_returns_count": purchase_returns_count,
            "orders_count": orders_count,
            "orders_amount": orders_amount,
            "payments_in": round(payments_in, 2),
            "payments_in_count": payments_in_count,
            "payments_out": round(payments_out, 2),
            "payments_out_count": payments_out_count,
            "net_debt": net_debt,
        },
        "days": days,
        "debt_by_currency": debt_by_currency,
    }


DASHBOARD_PRODUCT_MODES: dict[str, tuple[str, str]] = {
    # Partner purchases = firm wholesale docs; returns = wholesale returns.
    "purchases": ("wholesale", "wholesale-return"),
    # Partner shipments = firm purchase docs; returns = returns to partner.
    "shipments": ("purchase", "purchase-return"),
}


def _operation_item_fields(raw: dict[str, Any], *, use_cost: bool) -> dict[str, Any] | None:
    item = raw.get("item") if isinstance(raw.get("item"), dict) else {}
    item_id = item.get("id") if isinstance(item.get("id"), int) else raw.get("item_id")
    if not isinstance(item_id, int) or item_id <= 0:
        return None
    quantity = _as_float(raw.get("quantity"))
    unit = _as_float(raw.get("cost") if use_cost else raw.get("price"))
    amount = raw.get("amount")
    total = _as_float(amount) if amount is not None else round(quantity * unit, 2)
    code = item.get("code")
    name = item.get("name")
    group = item.get("group") if isinstance(item.get("group"), dict) else {}
    category = group.get("name") if isinstance(group.get("name"), str) else ""
    return {
        "item_id": item_id,
        "code": code.strip() if isinstance(code, str) and code.strip() else "",
        "name": name.strip() if isinstance(name, str) and name.strip() else f"Item #{item_id}",
        "category": category.strip() if isinstance(category, str) else "",
        "quantity": quantity,
        "total": total,
    }


async def _fetch_operations_for_documents(
    session: AsyncSession,
    company_id: int,
    *,
    ops_endpoint: str,
    document_ids: list[int],
    use_cost: bool,
    key_prefix: str,
) -> list[dict[str, Any]]:
    unique_ids = sorted({doc_id for doc_id in document_ids if doc_id > 0})
    if not unique_ids:
        return []
    if len(unique_ids) > 200:
        raise bad_request(
            "Cannot fetch operations for more than 200 documents at once.",
            "TOO_MANY_DOCUMENT_IDS",
        )
    steps = [
        {
            "key": f"{key_prefix}_{document_id}",
            "path": ops_endpoint,
            "payload": {"document_ids": [document_id], "limit": 1000, "offset": 0},
        }
        for document_id in unique_ids
    ]
    responses = await regos_batch_request_chunks_for_company(session, company_id, steps)
    operations: list[dict[str, Any]] = []
    for document_id in unique_ids:
        response = responses.get(f"{key_prefix}_{document_id}") or {}
        raw_items = response.get("result") or []
        if not isinstance(raw_items, list):
            continue
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            mapped = _operation_item_fields(raw, use_cost=use_cost)
            if mapped is not None:
                operations.append(mapped)
    return operations


def _aggregate_partner_product_rows(
    sell_ops: list[dict[str, Any]],
    refund_ops: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, float]]:
    stats: dict[int, dict[str, Any]] = {}

    def ensure(item_id: int, sample: dict[str, Any]) -> dict[str, Any]:
        current = stats.get(item_id)
        if current is not None:
            return current
        current = {
            "item_id": item_id,
            "code": sample.get("code") or "",
            "name": sample.get("name") or f"Item #{item_id}",
            "category": sample.get("category") or "",
            "sold_quantity": 0.0,
            "sold_total": 0.0,
            "refund_quantity": 0.0,
            "refund_total": 0.0,
        }
        stats[item_id] = current
        return current

    for op in sell_ops:
        row = ensure(int(op["item_id"]), op)
        row["sold_quantity"] = round(float(row["sold_quantity"]) + float(op["quantity"]), 2)
        row["sold_total"] = round(float(row["sold_total"]) + float(op["total"]), 2)
        if not row["code"] and op.get("code"):
            row["code"] = op["code"]
        if op.get("name"):
            row["name"] = op["name"]
        if not row["category"] and op.get("category"):
            row["category"] = op["category"]

    for op in refund_ops:
        row = ensure(int(op["item_id"]), op)
        row["refund_quantity"] = round(float(row["refund_quantity"]) + float(op["quantity"]), 2)
        row["refund_total"] = round(float(row["refund_total"]) + float(op["total"]), 2)
        if not row["code"] and op.get("code"):
            row["code"] = op["code"]
        if op.get("name"):
            row["name"] = op["name"]
        if not row["category"] and op.get("category"):
            row["category"] = op["category"]

    products: list[dict[str, Any]] = []
    totals = {
        "sold_quantity": 0.0,
        "sold_total": 0.0,
        "refund_quantity": 0.0,
        "refund_total": 0.0,
        "net_quantity": 0.0,
        "net_total": 0.0,
    }
    for item_id in sorted(stats.keys(), key=lambda key: str(stats[key]["name"]).casefold()):
        row = stats[item_id]
        sold_qty = float(row["sold_quantity"])
        sold_total = float(row["sold_total"])
        refund_qty = float(row["refund_quantity"])
        refund_total = float(row["refund_total"])
        net_qty = round(sold_qty - refund_qty, 2)
        net_total = round(sold_total - refund_total, 2)
        average_price = round(sold_total / sold_qty, 2) if sold_qty else 0.0
        products.append(
            {
                "item_id": item_id,
                "code": row["code"],
                "name": row["name"],
                "category": row["category"],
                "average_price": average_price,
                "sold_quantity": sold_qty,
                "sold_total": sold_total,
                "refund_quantity": refund_qty,
                "refund_total": refund_total,
                "net_quantity": net_qty,
                "net_total": net_total,
            }
        )
        totals["sold_quantity"] = round(totals["sold_quantity"] + sold_qty, 2)
        totals["sold_total"] = round(totals["sold_total"] + sold_total, 2)
        totals["refund_quantity"] = round(totals["refund_quantity"] + refund_qty, 2)
        totals["refund_total"] = round(totals["refund_total"] + refund_total, 2)
        totals["net_quantity"] = round(totals["net_quantity"] + net_qty, 2)
        totals["net_total"] = round(totals["net_total"] + net_total, 2)
    return products, totals


async def get_partner_dashboard_products(
    session: AsyncSession,
    company_id: int,
    partner_id: int,
    *,
    mode: str,
    start_date: str | None,
    end_date: str,
) -> dict[str, Any]:
    kinds = DASHBOARD_PRODUCT_MODES.get(mode)
    if kinds is None:
        raise bad_request("Unknown dashboard products mode.", "PARTNER_DASHBOARD_PRODUCTS_MODE")
    sell_kind, refund_kind = kinds
    sell_spec = _history_spec(sell_kind)
    refund_spec = _history_spec(refund_kind)

    start = _date_bound(start_date, end=False)
    end = _date_bound(end_date, end=True)
    if end is None:
        raise bad_request("Choose an end date.", "INVALID_DATE")

    date_payload: dict[str, Any] = {"end_date": end}
    if start is not None:
        date_payload["start_date"] = start

    sell_docs, refund_docs = await asyncio.gather(
        _fetch_partner_document_pages(
            session,
            company_id,
            partner_id,
            endpoint=sell_spec.doc_endpoint,
            payload_base={
                "partner_ids": [partner_id],
                "performed": True,
                **date_payload,
            },
        ),
        _fetch_partner_document_pages(
            session,
            company_id,
            partner_id,
            endpoint=refund_spec.doc_endpoint,
            payload_base={
                "partner_ids": [partner_id],
                "performed": True,
                **date_payload,
            },
        ),
    )

    sell_ids = [int(doc.get("id") or 0) for doc in sell_docs]
    refund_ids = [int(doc.get("id") or 0) for doc in refund_docs]
    sell_ops, refund_ops = await asyncio.gather(
        _fetch_operations_for_documents(
            session,
            company_id,
            ops_endpoint=sell_spec.ops_endpoint,
            document_ids=sell_ids,
            use_cost=sell_spec.use_cost,
            key_prefix="sell",
        ),
        _fetch_operations_for_documents(
            session,
            company_id,
            ops_endpoint=refund_spec.ops_endpoint,
            document_ids=refund_ids,
            use_cost=refund_spec.use_cost,
            key_prefix="refund",
        ),
    )
    products, totals = _aggregate_partner_product_rows(sell_ops, refund_ops)
    return {
        "mode": mode,
        "products": products,
        "totals": totals,
        "total": len(products),
    }


def sanitize_excel_filename(filename: str | None) -> str:
    raw = PurePosixPath((filename or "").replace("\\", "/")).name.strip()
    cleaned = _UNSAFE_FILENAME.sub("_", raw).strip("._")
    if not cleaned.lower().endswith(".xlsx"):
        cleaned = f"{cleaned or 'export'}.xlsx"
    if cleaned.lower() == ".xlsx":
        cleaned = "export.xlsx"
    return cleaned[:180]


async def send_excel_to_chat(
    session: AsyncSession,
    *,
    account_id: int,
    file_bytes: bytes,
    filename: str | None,
    caption: str | None = None,
) -> dict[str, Any]:
    if not file_bytes:
        raise bad_request("Excel file is empty.", "EXCEL_FILE_EMPTY")
    if len(file_bytes) > EXCEL_UPLOAD_MAX_BYTES:
        raise bad_request("Excel file is too large.", "EXCEL_FILE_TOO_LARGE")

    account = await session.get(PartnerTelegramAccount, account_id)
    if account is None:
        raise unauthorized("Invalid token", "INVALID_TOKEN")
    bot = await partner_telegram_service._get_bot_by_company(session, account.company_id)
    if bot is None:
        raise bad_request("Partner bot is not configured.", "PARTNER_BOT_NOT_CONFIGURED")

    safe_name = sanitize_excel_filename(filename)
    sent = await telegram_service.send_document(
        bot.bot_token,
        account.chat_id,
        file_bytes,
        safe_name,
        caption=caption,
    )
    if not sent:
        raise AppError(502, "Failed to send Excel to Telegram.", "TELEGRAM_SEND_FAILED")
    return {"ok": True, "filename": safe_name}
