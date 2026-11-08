import hashlib
import hmac
import json
import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError, bad_request, not_found, unauthorized
from app.core.regos_api import regos_async_api_request_for_company
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
from app.services.regos_products.helpers.map_product.map_product import map_product
from app.services.telegram_i18n import t

INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60
PASSWORD_CODE_MINUTES = 10
CHEAP_PRICE_CUTOFF = "100000"
HISTORY_KINDS: dict[str, doc_fetch.OperationDocumentSpec] = {
    "purchase": doc_fetch.PURCHASE_SPEC,
    "purchase-return": doc_fetch.RETURN_TO_PARTNER_SPEC,
    "wholesale": doc_fetch.WHOLESALE_SPEC,
    "wholesale-return": doc_fetch.WHOLESALE_RETURN_SPEC,
}


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
    price_type_id = account.price_type_id or bot.default_price_type_id or defaults["price_type"]["id"]
    warehouse_id = account.warehouse_id or bot.default_warehouse_id or defaults["warehouse"]["id"]
    if requested_warehouse_id is not None and bot.allow_catalog_warehouse_selection:
        warehouses = await company_warehouses(session, account.company_id)
        if not any(item["id"] == requested_warehouse_id for item in warehouses):
            raise bad_request("That warehouse is not available.", "PARTNER_WAREHOUSE_NOT_ALLOWED")
        warehouse_id = requested_warehouse_id
    return {
        "account": account,
        "bot": bot,
        "defaults": defaults,
        "warehouse_id": int(warehouse_id),
        "price_type_id": int(price_type_id),
        "allow_warehouse_selection": bool(bot.allow_catalog_warehouse_selection),
    }


async def _shop_defaults(session: AsyncSession, company_id: int) -> dict[str, Any]:
    defaults = await regos_defaults_service.get_enriched_regos_defaults(session, company_id)
    missing = [
        field
        for field in ("warehouse", "price_type", "currency")
        if not isinstance(defaults.get(field), dict) or not defaults[field].get("id")
    ]
    if missing:
        raise bad_request(
            "Warehouse, price type, and currency must be saved in Settings before partners can order.",
            "PARTNER_SHOP_NOT_CONFIGURED",
        )
    return defaults


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


def _map_document_summary(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": document.get("id"),
        "code": document.get("code"),
        "date": document.get("date"),
        "amount": document.get("amount"),
        "description": document.get("description") or "",
        "status_id": document.get("status_id"),
        "performed": document.get("performed"),
    }


def _map_operation(operation: dict[str, Any], *, use_cost: bool) -> dict[str, Any]:
    item = operation.get("item") if isinstance(operation.get("item"), dict) else {}
    name = item.get("name") if isinstance(item.get("name"), str) and item.get("name") else "Item"
    quantity = _as_float(operation.get("quantity"))
    price = _as_float(operation.get("cost") if use_cost else operation.get("price"))
    return {
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
        "account": partner_telegram_service.account_to_dict(account, partner_name),
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
    return partner_telegram_service.account_to_dict(row, partner_name)


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
    if search and search.strip():
        payload["search"] = search.strip()
    if group_id is not None and group_id > 0:
        payload["group_ids"] = [group_id]
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
        "warehouse_id": context["warehouse_id"],
        "price_type_id": context["price_type_id"],
    }


async def list_product_groups(session: AsyncSession, company_id: int) -> dict[str, Any]:
    return await regos_groups.list_groups(session, company_id)


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
    lines: list[dict[str, Any]] = []
    for product_id, quantity in requested:
        product = catalog.get(product_id)
        if product is None:
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
    order_doc = await regos_sales.create_booked_partner_order(
        session, company_id, defaults, description, lines
    )
    return {"order_id": order_doc["id"], "code": order_doc.get("code")}


async def list_orders(
    session: AsyncSession,
    company_id: int,
    partner_id: int,
    *,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "partner_ids": [partner_id],
        "status_ids": sorted(DOC_ORDER_FROM_PARTNER_CONTINUABLE_STATUS_IDS),
        "deleted_mark": False,
        "sort_orders": [{"column": "Date", "direction": "DESC"}],
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
    documents = [
        _map_document_summary(row)
        for row in response.get("result") or []
        if isinstance(row, dict) and _document_partner_matches(row, partner_id)
    ]
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
    if not document or not _document_partner_matches(document, partner_id):
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


def _session_payload(account: PartnerTelegramAccount, partner_name: str | None) -> dict[str, Any]:
    token = create_partner_telegram_token(account_id=account.id, company_id=account.company_id)
    return {
        "access_token": token,
        "account": partner_telegram_service.account_to_dict(account, partner_name),
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
    return _session_payload(account, await _account_partner_name(session, account))


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
    return _session_payload(account, await _account_partner_name(session, account))


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
        payments.append(
            {
                "id": mapped.get("id"),
                "code": mapped.get("code"),
                "date": mapped.get("date"),
                "amount": mapped.get("amount"),
                "description": mapped.get("description") or "",
                "payment_direction": mapped.get("payment_direction"),
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
