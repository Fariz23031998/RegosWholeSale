from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request, not_found
from app.core.regos_api import regos_async_api_request_for_company
from app.models import Company

REGOS_DEFAULTS_KEY = "regos_defaults"
DOC_WHOLESALE_MODEL = "DocWholeSale"

REFERENCE_ENDPOINTS = {
    "warehouse": "stock/get",
    "price_type": "pricetype/get",
    "partner": "partner/get",
    "payment_category": "accountoperationcategory/get",
    "attached_user": "user/get",
}

REFERENCE_ERRORS = {
    "warehouse": "REGOS_WAREHOUSE_NOT_FOUND",
    "price_type": "REGOS_PRICE_TYPE_NOT_FOUND",
    "partner": "REGOS_PARTNER_NOT_FOUND",
    "payment_category": "REGOS_PAYMENT_CATEGORY_NOT_FOUND",
    "attached_user": "REGOS_ATTACHED_USER_NOT_FOUND",
}

REFERENCE_NAMES = {
    "warehouse": "warehouse",
    "price_type": "price type",
    "partner": "partner",
    "payment_category": "payment category",
    "attached_user": "attached user",
    "currency": "currency",
    "firm": "firm",
}

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


async def get_regos_defaults(session: AsyncSession, company_id: int) -> dict[str, Any]:
    return await get_stored_regos_defaults(session, company_id)


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
    attached_users = await _fetch_reference_options(session, company_id, "attached_user")
    return {
        "warehouses": warehouses,
        "price_types": price_types,
        "partners": partners,
        "payment_categories": payment_categories,
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
        enriched["currency"] = _extract_nested_reference(price_type_item, "currency")
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
        elif field == "attached_user_id":
            updates["attached_user"] = await _resolve_reference_value(
                session, company_id, "attached_user", value
            )
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
    return _map_option(item), _extract_nested_reference(item, "currency")


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
        "attached_user": _normalize_option(data.get("attached_user")),
        "zero_quantity": bool(data.get("zero_quantity", False)),
        "zero_price": bool(data.get("zero_price", False)),
    }


def _normalize_option(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    option_id = raw.get("id")
    name = raw.get("name")
    if not isinstance(option_id, int) or option_id <= 0 or not isinstance(name, str) or not name:
        return None
    return {"id": option_id, "name": name}


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


async def _get_company(session: AsyncSession, company_id: int) -> Company:
    company = await session.get(Company, company_id)
    if not company:
        raise not_found("Company not found")
    return company
