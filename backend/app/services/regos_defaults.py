from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request, not_found
from app.core.regos_api import regos_async_api_request_for_company
from app.models import Company, User
from app.services import settings as settings_service

REGOS_DEFAULTS_KEY = "regos_defaults"
USER_REGOS_DEFAULTS_KEY = "regos_defaults"
DOC_WHOLESALE_MODEL = "DocWholeSale"
DOC_WHOLESALE_RETURN_MODEL = "DocWholeSaleReturn"

REFERENCE_ENDPOINTS = {
    "warehouse": "stock/get",
    "price_type": "pricetype/get",
    "partner": "partner/get",
    "payment_category": "accountoperationcategory/get",
    "refund_payment_category": "accountoperationcategory/get",
    "attached_user": "user/get",
}

REFERENCE_ERRORS = {
    "warehouse": "REGOS_WAREHOUSE_NOT_FOUND",
    "price_type": "REGOS_PRICE_TYPE_NOT_FOUND",
    "partner": "REGOS_PARTNER_NOT_FOUND",
    "payment_category": "REGOS_PAYMENT_CATEGORY_NOT_FOUND",
    "refund_payment_category": "REGOS_REFUND_PAYMENT_CATEGORY_NOT_FOUND",
    "attached_user": "REGOS_ATTACHED_USER_NOT_FOUND",
}

REFERENCE_NAMES = {
    "warehouse": "warehouse",
    "price_type": "price type",
    "partner": "partner",
    "payment_category": "payment category",
    "refund_payment_category": "refund payment category",
    "attached_user": "attached user",
    "currency": "currency",
    "firm": "firm",
}

DEFAULT_VAT_CALCULATION_TYPE = "Exclude"
VAT_CALCULATION_TYPES = frozenset({"No", "Exclude", "Include"})

REFERENCE_REQUESTS = {
    "warehouse": {
        "deleted_mark": False,
        "limit": 1000,
        "offset": 0,
        "sort_orders": [{"column": "Name", "direction": "asc"}],
    },
    "price_type": {
        "limit": 1000,
        "offset": 0,
        "sort_orders": [{"column": "Name", "direction": "asc"}],
    },
    "partner": {
        "deleted_mark": False,
        "limit": 1000,
        "offset": 0,
        "sort_orders": [{"column": "Name", "direction": "asc"}],
    },
    "payment_category": {
        "positive": True,
        "limit": 1000,
        "offset": 0,
        "sort_orders": [{"column": "Name", "direction": "asc"}],
    },
    "refund_payment_category": {
        "positive": False,
        "limit": 1000,
        "offset": 0,
        "sort_orders": [{"column": "Name", "direction": "asc"}],
    },
    "attached_user": {
        "active": True,
        "limit": 1000,
        "offset": 0,
        "sort_orders": [{"column": "FirstName", "direction": "asc"}],
    },
}

CHECKOUT_REQUIRED_DEFAULTS = (
    "warehouse",
    "price_type",
    "partner",
    "payment_category",
    "currency",
    "firm",
)

MERGEABLE_OPTION_KEYS = (
    "warehouse",
    "price_type",
    "partner",
    "currency",
    "firm",
    "payment_category",
    "refund_payment_category",
    "attached_user",
)
MERGEABLE_BOOL_KEYS = ("zero_quantity", "zero_price")
MERGEABLE_ENUM_KEYS = ("vat_calculation_type",)


async def get_doc_wholesale_document_type_id(
    session: AsyncSession, company_id: int
) -> int:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "documenttype/get",
        {"model": DOC_WHOLESALE_MODEL},
    )
    items = response.get("result") or []
    if not items or not isinstance(items[0], dict):
        raise bad_request(
            "DocWholeSale document type was not found in Regos.",
            "REGOS_DOC_WHOLESALE_TYPE_NOT_FOUND",
        )
    option_id = items[0].get("id")
    if not isinstance(option_id, int) or option_id <= 0:
        raise bad_request(
            "Regos returned an invalid DocWholeSale document type.",
            "REGOS_DOC_WHOLESALE_TYPE_NOT_FOUND",
        )
    return option_id


async def get_doc_wholesale_return_document_type_id(
    session: AsyncSession, company_id: int
) -> int:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "documenttype/get",
        {"model": DOC_WHOLESALE_RETURN_MODEL},
    )
    items = response.get("result") or []
    if not items or not isinstance(items[0], dict):
        raise bad_request(
            "DocWholeSaleReturn document type was not found in Regos.",
            "REGOS_DOC_WHOLESALE_RETURN_TYPE_NOT_FOUND",
        )
    option_id = items[0].get("id")
    if not isinstance(option_id, int) or option_id <= 0:
        raise bad_request(
            "Regos returned an invalid DocWholeSaleReturn document type.",
            "REGOS_DOC_WHOLESALE_RETURN_TYPE_NOT_FOUND",
        )
    return option_id


async def get_regos_defaults(
    session: AsyncSession, company_id: int, *, user_id: int | None = None
) -> dict[str, Any]:
    if user_id is None:
        return await get_stored_regos_defaults(session, company_id)
    return await get_effective_stored_regos_defaults(session, user_id, company_id)


async def get_effective_stored_regos_defaults(
    session: AsyncSession, user_id: int, company_id: int
) -> dict[str, Any]:
    company_defaults = await get_stored_regos_defaults(session, company_id)
    user_overrides = await _get_user_regos_overrides(session, user_id)
    return _merge_stored_defaults(company_defaults, user_overrides)


async def get_effective_enriched_regos_defaults(
    session: AsyncSession, user_id: int, company_id: int
) -> dict[str, Any]:
    defaults = await get_effective_stored_regos_defaults(session, user_id, company_id)
    return await enrich_checkout_defaults(session, company_id, defaults, refresh=True)


async def patch_user_regos_defaults(
    session: AsyncSession, user: User, patch: dict[str, Any]
) -> dict[str, Any]:
    if not patch:
        return await get_effective_enriched_regos_defaults(session, user.id, user.company_id)

    all_settings = await settings_service.get_user_settings(session, user.id)
    current = _raw_user_regos_overrides(all_settings.get(USER_REGOS_DEFAULTS_KEY))
    updates = await _resolve_patch(session, user.company_id, patch)
    for key, value in updates.items():
        if value is None:
            current.pop(key, None)
        else:
            current[key] = value

    await settings_service.patch_user_settings(
        session,
        user,
        {USER_REGOS_DEFAULTS_KEY: current},
    )
    return await get_effective_enriched_regos_defaults(session, user.id, user.company_id)


async def clear_user_regos_defaults(session: AsyncSession, user: User) -> dict[str, Any]:
    await settings_service.delete_user_setting(session, user, USER_REGOS_DEFAULTS_KEY)
    return await get_effective_enriched_regos_defaults(session, user.id, user.company_id)


async def apply_regos_session_overrides(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    *,
    warehouse_id: int | None = None,
    price_type_id: int | None = None,
    partner_id: int | None = None,
) -> dict[str, Any]:
    defaults = await get_effective_stored_regos_defaults(session, user_id, company_id)
    patch: dict[str, Any] = {}
    if warehouse_id is not None:
        patch["warehouse_id"] = warehouse_id
    if price_type_id is not None:
        patch["price_type_id"] = price_type_id
    if partner_id is not None:
        patch["partner_id"] = partner_id
    if not patch:
        return defaults

    updates = await _resolve_patch(session, company_id, patch)
    merged = dict(defaults)
    merged.update(updates)
    return merged


async def get_enriched_regos_defaults(session: AsyncSession, company_id: int) -> dict[str, Any]:
    defaults = await get_stored_regos_defaults(session, company_id)
    return await enrich_checkout_defaults(session, company_id, defaults, refresh=True)


async def get_stored_regos_defaults(session: AsyncSession, company_id: int) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    return _normalize_defaults((company.settings or {}).get(REGOS_DEFAULTS_KEY))


async def patch_regos_defaults(
    session: AsyncSession, company_id: int, patch: dict[str, Any]
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    current = _normalize_defaults((company.settings or {}).get(REGOS_DEFAULTS_KEY))
    if not patch:
        return await enrich_checkout_defaults(session, company_id, current)

    updates = await _resolve_patch(session, company_id, patch)
    current.update(updates)

    settings = dict(company.settings or {})
    settings[REGOS_DEFAULTS_KEY] = current
    company.settings = settings
    await session.flush()
    return await enrich_checkout_defaults(session, company_id, current)


async def list_reference_options(session: AsyncSession, company_id: int) -> dict[str, list[dict[str, Any]]]:
    warehouses = await _fetch_reference_options(session, company_id, "warehouse")
    price_types = await _fetch_reference_options(session, company_id, "price_type")
    partners = await _fetch_reference_options(session, company_id, "partner")
    payment_categories = await _fetch_reference_options(session, company_id, "payment_category")
    refund_payment_categories = await _fetch_reference_options(
        session, company_id, "refund_payment_category"
    )
    attached_users = await _fetch_reference_options(session, company_id, "attached_user")
    return {
        "warehouses": warehouses,
        "price_types": price_types,
        "partners": partners,
        "payment_categories": payment_categories,
        "refund_payment_categories": refund_payment_categories,
        "attached_users": attached_users,
    }


async def enrich_checkout_defaults(
    session: AsyncSession,
    company_id: int,
    defaults: dict[str, Any],
    *,
    refresh: bool = False,
) -> dict[str, Any]:
    enriched = dict(defaults)
    warehouse = enriched.get("warehouse")
    price_type = enriched.get("price_type")

    if warehouse and (refresh or not _is_valid_option(enriched.get("firm"))):
        stock = await _fetch_regos_item_by_id(session, company_id, "warehouse", warehouse["id"])
        enriched["firm"] = _extract_nested_reference(stock, "firm")
    elif not warehouse:
        enriched["firm"] = None

    if price_type and (refresh or not _is_valid_option(enriched.get("currency"))):
        price_type_item = await _fetch_regos_item_by_id(
            session, company_id, "price_type", price_type["id"]
        )
        enriched["currency"] = _extract_currency_reference(price_type_item, "currency")
    elif not price_type:
        enriched["currency"] = None

    return enriched


def validate_checkout_defaults(defaults: dict[str, Any]) -> None:
    missing = [
        field
        for field in CHECKOUT_REQUIRED_DEFAULTS
        if not defaults.get(field) or not isinstance(defaults[field], dict)
    ]
    if missing:
        labels = ", ".join(REFERENCE_NAMES.get(field, field) for field in missing)
        hint = ""
        if "currency" in missing and defaults.get("price_type"):
            hint = " Currency is taken from the selected price type."
        elif "firm" in missing and defaults.get("warehouse"):
            hint = " Firm is taken from the selected warehouse."
        raise bad_request(
            f"Regos checkout defaults are not fully configured: {labels}.{hint} "
            "Save them in Settings first.",
            "REGOS_CHECKOUT_DEFAULTS_NOT_CONFIGURED",
        )


async def _resolve_patch(
    session: AsyncSession, company_id: int, patch: dict[str, Any]
) -> dict[str, Any]:
    updates: dict[str, Any] = {}
    for field, value in patch.items():
        if field == "warehouse_id":
            warehouse, firm = await _resolve_warehouse_reference(
                session, company_id, value
            )
            updates["warehouse"] = warehouse
            updates["firm"] = firm
        elif field == "price_type_id":
            price_type, currency = await _resolve_price_type_reference(
                session, company_id, value
            )
            updates["price_type"] = price_type
            updates["currency"] = currency
        elif field == "partner_id":
            updates["partner"] = await _resolve_reference_value(
                session, company_id, "partner", value
            )
        elif field == "payment_category_id":
            updates["payment_category"] = await _resolve_reference_value(
                session, company_id, "payment_category", value
            )
        elif field == "refund_payment_category_id":
            updates["refund_payment_category"] = await _resolve_reference_value(
                session, company_id, "refund_payment_category", value
            )
        elif field == "attached_user_id":
            updates["attached_user"] = await _resolve_reference_value(
                session, company_id, "attached_user", value
            )
        elif field == "vat_calculation_type":
            if value is None:
                updates["vat_calculation_type"] = None
            else:
                updates["vat_calculation_type"] = _normalize_vat_calculation_type(value)
        elif field == "zero_quantity":
            updates["zero_quantity"] = bool(value)
        elif field == "zero_price":
            updates["zero_price"] = bool(value)
    return updates


async def _resolve_warehouse_reference(
    session: AsyncSession, company_id: int, value: int | None
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if value is None:
        return None, None
    item = await _fetch_regos_item_by_id(session, company_id, "warehouse", value)
    if not item:
        raise bad_request(
            f"Selected {REFERENCE_NAMES['warehouse']} was not found in Regos.",
            REFERENCE_ERRORS["warehouse"],
        )
    return _map_option(item), _extract_nested_reference(item, "firm")


async def _resolve_price_type_reference(
    session: AsyncSession, company_id: int, value: int | None
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if value is None:
        return None, None
    item = await _fetch_regos_item_by_id(session, company_id, "price_type", value)
    if not item:
        raise bad_request(
            f"Selected {REFERENCE_NAMES['price_type']} was not found in Regos.",
            REFERENCE_ERRORS["price_type"],
        )
    return _map_option(item), _extract_currency_reference(item, "currency")


async def _fetch_regos_item_by_id(
    session: AsyncSession, company_id: int, kind: str, value: int
) -> dict[str, Any] | None:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        REFERENCE_ENDPOINTS[kind],
        _request_for_ids(kind, value),
    )
    items = response.get("result") or []
    if not items or not isinstance(items[0], dict):
        return None
    return items[0]


async def _resolve_reference_value(
    session: AsyncSession, company_id: int, kind: str, value: int | None
) -> dict[str, Any] | None:
    if value is None:
        return None

    response = await regos_async_api_request_for_company(
        session,
        company_id,
        REFERENCE_ENDPOINTS[kind],
        _request_for_ids(kind, value),
    )
    items = response.get("result") or []
    if not items:
        raise bad_request(
            f"Selected {REFERENCE_NAMES[kind]} was not found in Regos.",
            REFERENCE_ERRORS[kind],
        )
    return _map_reference_item(items[0], kind)


async def _fetch_reference_options(
    session: AsyncSession, company_id: int, kind: str
) -> list[dict[str, Any]]:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        REFERENCE_ENDPOINTS[kind],
        dict(REFERENCE_REQUESTS[kind]),
    )
    items = response.get("result") or []
    return [
        _map_reference_item(item, kind)
        for item in items
        if isinstance(item, dict) and item.get("id")
    ]


def _request_for_ids(kind: str, value: int) -> dict[str, Any]:
    payload = dict(REFERENCE_REQUESTS[kind])
    payload["ids"] = [value]
    payload["limit"] = 1
    payload["offset"] = 0
    return payload


def _normalize_defaults(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    return {
        "warehouse": _normalize_option(data.get("warehouse")),
        "price_type": _normalize_option(data.get("price_type")),
        "partner": _normalize_option(data.get("partner")),
        "currency": _normalize_option(data.get("currency")),
        "firm": _normalize_option(data.get("firm")),
        "payment_category": _normalize_option(data.get("payment_category")),
        "refund_payment_category": _normalize_option(data.get("refund_payment_category")),
        "attached_user": _normalize_option(data.get("attached_user")),
        "vat_calculation_type": _normalize_vat_calculation_type(
            data.get("vat_calculation_type", DEFAULT_VAT_CALCULATION_TYPE)
        ),
        "zero_quantity": bool(data.get("zero_quantity", False)),
        "zero_price": bool(data.get("zero_price", False)),
    }


def _raw_user_regos_overrides(raw: Any) -> dict[str, Any]:
    return dict(raw) if isinstance(raw, dict) else {}


async def _get_user_regos_overrides(session: AsyncSession, user_id: int) -> dict[str, Any]:
    all_settings = await settings_service.get_user_settings(session, user_id)
    return _raw_user_regos_overrides(all_settings.get(USER_REGOS_DEFAULTS_KEY))


def _merge_stored_defaults(
    company_defaults: dict[str, Any], user_overrides: dict[str, Any]
) -> dict[str, Any]:
    merged = dict(company_defaults)

    for key in MERGEABLE_OPTION_KEYS:
        if key in user_overrides:
            merged[key] = _normalize_option(user_overrides[key])

    for key in MERGEABLE_BOOL_KEYS:
        if key in user_overrides:
            merged[key] = bool(user_overrides[key])

    for key in MERGEABLE_ENUM_KEYS:
        if key in user_overrides:
            merged[key] = _normalize_vat_calculation_type(user_overrides[key])

    return merged


def _normalize_option(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    option_id = raw.get("id")
    name = raw.get("name")
    if not isinstance(option_id, int) or option_id <= 0 or not isinstance(name, str) or not name:
        return None
    option: dict[str, Any] = {"id": option_id, "name": name}
    code_chr = raw.get("code_chr")
    if isinstance(code_chr, str) and code_chr.strip():
        option["code_chr"] = code_chr.strip()
    exchange_rate = raw.get("exchange_rate")
    if exchange_rate is not None:
        try:
            rate = float(exchange_rate)
            if rate > 0:
                option["exchange_rate"] = rate
        except (TypeError, ValueError):
            pass
    return option


def _is_valid_option(raw: Any) -> bool:
    return _normalize_option(raw) is not None


def _extract_nested_reference(item: dict[str, Any], key: str) -> dict[str, Any] | None:
    nested = item.get(key)
    if not isinstance(nested, dict):
        return None
    option_id = nested.get("id")
    name = nested.get("name")
    if not isinstance(option_id, int) or option_id <= 0:
        return None
    if not isinstance(name, str) or not name.strip():
        name = f"#{option_id}"
    return {"id": option_id, "name": name.strip()}


def _extract_currency_reference(item: dict[str, Any], key: str) -> dict[str, Any] | None:
    nested = item.get(key)
    if not isinstance(nested, dict):
        return None
    option_id = nested.get("id")
    if not isinstance(option_id, int) or option_id <= 0:
        return None
    name = nested.get("name")
    if not isinstance(name, str) or not name.strip():
        name = f"#{option_id}"
    currency: dict[str, Any] = {"id": option_id, "name": name.strip()}
    code_chr = nested.get("code_chr")
    if isinstance(code_chr, str) and code_chr.strip():
        currency["code_chr"] = code_chr.strip()
    exchange_rate = nested.get("exchange_rate")
    if exchange_rate is not None:
        try:
            rate = float(exchange_rate)
            if rate > 0:
                currency["exchange_rate"] = rate
        except (TypeError, ValueError):
            pass
    return currency


def _map_reference_item(item: dict[str, Any], kind: str) -> dict[str, Any]:
    option_id = item.get("id")
    if not isinstance(option_id, int) or option_id <= 0:
        raise bad_request("Regos returned an invalid reference item.", "REGOS_REFERENCE_INVALID")

    name = _reference_display_name(item, kind)
    return {"id": option_id, "name": name}


def _reference_display_name(item: dict[str, Any], kind: str) -> str:
    if kind == "attached_user":
        full_name = item.get("full_name")
        if isinstance(full_name, str) and full_name.strip():
            return full_name.strip()
        parts = [
            part
            for part in (item.get("first_name"), item.get("last_name"))
            if isinstance(part, str) and part.strip()
        ]
        if parts:
            return " ".join(parts)

    name = item.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    option_id = item.get("id")
    return f"#{option_id}" if isinstance(option_id, int) else "Unknown"


def _map_option(item: dict[str, Any]) -> dict[str, Any]:
    return _map_reference_item(item, "warehouse")


def _normalize_vat_calculation_type(raw: Any) -> str:
    if raw is None:
        return DEFAULT_VAT_CALCULATION_TYPE
    if raw in VAT_CALCULATION_TYPES:
        return str(raw)
    if raw in (1, "1"):
        return "No"
    if raw in (2, "2"):
        return "Exclude"
    if raw in (3, "3"):
        return "Include"
    raise bad_request(
        "Invalid VAT calculation type. Use No, Exclude, or Include.",
        "REGOS_VAT_CALCULATION_TYPE_INVALID",
    )


async def _get_company(session: AsyncSession, company_id: int) -> Company:
    company = await session.get(Company, company_id)
    if not company:
        raise not_found("Company not found")
    return company
