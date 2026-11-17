from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError, bad_request
from app.core.regos_api import regos_async_api_request_for_company
from app.services.regos_defaults import _get_company

REGOS_INTEGRATION_KEY = "regos_integration"
DOC_PAYMENT_SALE_ID_FIELD_SETTING_KEY = "doc_payment_sale_id_field"

DOC_PAYMENT_ENTITY_TYPE = "DocPayment"
DOC_PAYMENT_SALE_ID_KEY = "sale_id"
DOC_PAYMENT_SALE_ID_STORED_KEY = f"field_{DOC_PAYMENT_SALE_ID_KEY}"
DOC_PAYMENT_SALE_ID_NAME = "Sale ID"


def _map_field(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(item.get("id") or 0),
        "key": str(item.get("key") or ""),
        "name": str(item.get("name") or ""),
        "entity_type": str(item.get("entity_type") or ""),
        "data_type": str(item.get("data_type") or ""),
    }


def _match_sale_id_field(raw_items: list[Any]) -> dict[str, Any] | None:
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        mapped = _map_field(item)
        if mapped["key"] in (DOC_PAYMENT_SALE_ID_KEY, DOC_PAYMENT_SALE_ID_STORED_KEY):
            return mapped
    return None


def _is_sale_id_field_already_exists_error(exc: AppError) -> bool:
    if exc.code != "REGOS_API_ERROR":
        return False
    detail = exc.detail
    message = str(detail.get("detail") if isinstance(detail, dict) else detail).lower()
    return "key exists" in message and "docpayment" in message


def _is_custom_fields_lookup_error(exc: AppError) -> bool:
    """Custom-field reads are optional; plan/tariff errors must not break settings."""
    return exc.code in ("REGOS_TOKEN_NOT_CONFIGURED", "REGOS_API_ERROR")


def _stored_sale_id_field(company_settings: dict[str, Any]) -> dict[str, Any] | None:
    integration = company_settings.get(REGOS_INTEGRATION_KEY)
    if not isinstance(integration, dict):
        return None
    field = integration.get(DOC_PAYMENT_SALE_ID_FIELD_SETTING_KEY)
    return field if isinstance(field, dict) and field.get("key") else None


async def _save_sale_id_field(
    session: AsyncSession,
    company_id: int,
    field: dict[str, Any],
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    settings = dict(company.settings or {})
    integration = dict(settings.get(REGOS_INTEGRATION_KEY) or {})
    integration[DOC_PAYMENT_SALE_ID_FIELD_SETTING_KEY] = field
    settings[REGOS_INTEGRATION_KEY] = integration
    company.settings = settings
    await session.flush()
    return field


async def fetch_doc_payment_sale_id_field(
    session: AsyncSession,
    company_id: int,
) -> dict[str, Any] | None:
    lookup_payloads = [
        {
            "entity_type": DOC_PAYMENT_ENTITY_TYPE,
            "keys": [DOC_PAYMENT_SALE_ID_KEY, DOC_PAYMENT_SALE_ID_STORED_KEY],
        },
        {"entity_type": DOC_PAYMENT_ENTITY_TYPE},
    ]
    for payload in lookup_payloads:
        try:
            response = await regos_async_api_request_for_company(
                session,
                company_id,
                "field/get",
                payload,
            )
        except AppError as exc:
            if _is_custom_fields_lookup_error(exc):
                return None
            raise
        field = _match_sale_id_field(response.get("result") or [])
        if field:
            return field
    return None


async def get_doc_payment_sale_id_field_status(
    session: AsyncSession,
    company_id: int,
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    stored = _stored_sale_id_field(company.settings or {})
    if stored:
        return {"configured": True, "field": stored, "created": False}

    remote = await fetch_doc_payment_sale_id_field(session, company_id)
    if remote:
        await _save_sale_id_field(session, company_id, remote)
        return {"configured": True, "field": remote, "created": False}

    return {"configured": False, "field": None, "created": False}


async def ensure_doc_payment_sale_id_field(
    session: AsyncSession,
    company_id: int,
) -> dict[str, Any]:
    status = await get_doc_payment_sale_id_field_status(session, company_id)
    if status["configured"] and status["field"]:
        return status

    try:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            "field/add",
            {
                "key": DOC_PAYMENT_SALE_ID_KEY,
                "name": DOC_PAYMENT_SALE_ID_NAME,
                "entity_type": DOC_PAYMENT_ENTITY_TYPE,
                "data_type": "string",
                "required": False,
            },
        )
    except AppError as exc:
        if not _is_sale_id_field_already_exists_error(exc):
            raise
        field = await fetch_doc_payment_sale_id_field(session, company_id)
        if not field:
            raise bad_request(
                "Sale ID field already exists in Regos but could not be loaded.",
                "REGOS_FIELD_ALREADY_EXISTS",
            )
        await _save_sale_id_field(session, company_id, field)
        return {"configured": True, "field": field, "created": False}

    result = response.get("result")
    new_id = None
    if isinstance(result, dict):
        new_id = result.get("new_id")
    if not isinstance(new_id, int) or new_id <= 0:
        raise bad_request(
            "Regos did not return a new field id.",
            "REGOS_FIELD_CREATE_FAILED",
        )

    field = await fetch_doc_payment_sale_id_field(session, company_id)
    if not field:
        field = {
            "id": new_id,
            "key": DOC_PAYMENT_SALE_ID_STORED_KEY,
            "name": DOC_PAYMENT_SALE_ID_NAME,
            "entity_type": DOC_PAYMENT_ENTITY_TYPE,
            "data_type": "string",
        }

    await _save_sale_id_field(session, company_id, field)
    return {"configured": True, "field": field, "created": True}


async def get_doc_payment_sale_id_field_key(
    session: AsyncSession,
    company_id: int,
) -> str | None:
    company = await _get_company(session, company_id)
    stored = _stored_sale_id_field(company.settings or {})
    if stored and isinstance(stored.get("key"), str):
        return stored["key"]

    try:
        remote = await fetch_doc_payment_sale_id_field(session, company_id)
    except AppError as exc:
        if _is_custom_fields_lookup_error(exc):
            return None
        raise

    if not remote:
        return None

    await _save_sale_id_field(session, company_id, remote)
    key = remote.get("key")
    return key if isinstance(key, str) and key else None


async def build_doc_payment_sale_id_fields(
    session: AsyncSession,
    company_id: int,
    *,
    source_document_id: int,
) -> list[dict[str, str]]:
    if source_document_id <= 0:
        return []

    field_key = await get_doc_payment_sale_id_field_key(session, company_id)
    if not field_key:
        return []

    return [{"key": field_key, "value": str(source_document_id)}]


def build_doc_payment_sale_id_filter(
    field_key: str,
    source_document_id: int,
) -> dict[str, str]:
    return {
        "field": field_key,
        "operator": "Equal",
        "value": str(source_document_id),
    }

ITEM_ENTITY_TYPE = "Item"
ITEM_SECONDARY_UNIT_FIELD_SETTING_KEY = "item_secondary_unit_id_field"
ITEM_SECONDARY_UNIT_KEY = "secondary_unit_id"
ITEM_SECONDARY_UNIT_STORED_KEY = f"field_{ITEM_SECONDARY_UNIT_KEY}"
ITEM_SECONDARY_UNIT_NAME = "Secondary unit"


def _match_item_secondary_unit_field(raw_items: list[Any]) -> dict[str, Any] | None:
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        mapped = _map_field(item)
        if mapped["key"] in (ITEM_SECONDARY_UNIT_KEY, ITEM_SECONDARY_UNIT_STORED_KEY):
            return mapped
    return None


def _is_item_secondary_unit_field_already_exists_error(exc: AppError) -> bool:
    if exc.code != "REGOS_API_ERROR":
        return False
    detail = exc.detail
    message = str(detail.get("detail") if isinstance(detail, dict) else detail).lower()
    return "key exists" in message and "item" in message


def _stored_item_secondary_unit_field(
    company_settings: dict[str, Any],
) -> dict[str, Any] | None:
    integration = company_settings.get(REGOS_INTEGRATION_KEY)
    if not isinstance(integration, dict):
        return None
    field = integration.get(ITEM_SECONDARY_UNIT_FIELD_SETTING_KEY)
    return field if isinstance(field, dict) and field.get("key") else None


async def _save_item_secondary_unit_field(
    session: AsyncSession,
    company_id: int,
    field: dict[str, Any],
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    settings = dict(company.settings or {})
    integration = dict(settings.get(REGOS_INTEGRATION_KEY) or {})
    integration[ITEM_SECONDARY_UNIT_FIELD_SETTING_KEY] = field
    settings[REGOS_INTEGRATION_KEY] = integration
    company.settings = settings
    await session.flush()
    return field


async def fetch_item_secondary_unit_field(
    session: AsyncSession,
    company_id: int,
) -> dict[str, Any] | None:
    lookup_payloads = [
        {
            "entity_type": ITEM_ENTITY_TYPE,
            "keys": [ITEM_SECONDARY_UNIT_KEY, ITEM_SECONDARY_UNIT_STORED_KEY],
        },
        {"entity_type": ITEM_ENTITY_TYPE},
    ]
    for payload in lookup_payloads:
        try:
            response = await regos_async_api_request_for_company(
                session,
                company_id,
                "field/get",
                payload,
            )
        except AppError as exc:
            if _is_custom_fields_lookup_error(exc):
                return None
            raise
        field = _match_item_secondary_unit_field(response.get("result") or [])
        if field:
            return field
    return None


async def get_item_secondary_unit_field_status(
    session: AsyncSession,
    company_id: int,
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    stored = _stored_item_secondary_unit_field(company.settings or {})
    if stored:
        return {"configured": True, "field": stored, "created": False}

    remote = await fetch_item_secondary_unit_field(session, company_id)
    if remote:
        await _save_item_secondary_unit_field(session, company_id, remote)
        return {"configured": True, "field": remote, "created": False}

    return {"configured": False, "field": None, "created": False}


async def ensure_item_secondary_unit_field(
    session: AsyncSession,
    company_id: int,
) -> dict[str, Any]:
    status = await get_item_secondary_unit_field_status(session, company_id)
    if status["configured"] and status["field"]:
        return status

    try:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            "field/add",
            {
                "key": ITEM_SECONDARY_UNIT_KEY,
                "name": ITEM_SECONDARY_UNIT_NAME,
                "entity_type": ITEM_ENTITY_TYPE,
                "data_type": "int",
                "required": False,
            },
        )
    except AppError as exc:
        if not _is_item_secondary_unit_field_already_exists_error(exc):
            raise
        field = await fetch_item_secondary_unit_field(session, company_id)
        if not field:
            raise bad_request(
                "Secondary unit field already exists in Regos but could not be loaded.",
                "REGOS_FIELD_ALREADY_EXISTS",
            )
        await _save_item_secondary_unit_field(session, company_id, field)
        return {"configured": True, "field": field, "created": False}

    result = response.get("result")
    new_id = None
    if isinstance(result, dict):
        new_id = result.get("new_id")
    if not isinstance(new_id, int) or new_id <= 0:
        raise bad_request(
            "Regos did not return a new field id.",
            "REGOS_FIELD_CREATE_FAILED",
        )

    field = await fetch_item_secondary_unit_field(session, company_id)
    if not field:
        field = {
            "id": new_id,
            "key": ITEM_SECONDARY_UNIT_STORED_KEY,
            "name": ITEM_SECONDARY_UNIT_NAME,
            "entity_type": ITEM_ENTITY_TYPE,
            "data_type": "int",
        }

    await _save_item_secondary_unit_field(session, company_id, field)
    return {"configured": True, "field": field, "created": True}


async def get_item_secondary_unit_field_key(
    session: AsyncSession,
    company_id: int,
) -> str | None:
    company = await _get_company(session, company_id)
    stored = _stored_item_secondary_unit_field(company.settings or {})
    if stored and isinstance(stored.get("key"), str):
        return stored["key"]

    try:
        remote = await fetch_item_secondary_unit_field(session, company_id)
    except AppError as exc:
        if _is_custom_fields_lookup_error(exc):
            return None
        raise

    if not remote:
        return None

    await _save_item_secondary_unit_field(session, company_id, remote)
    key = remote.get("key")
    return key if isinstance(key, str) and key else None


def parse_item_secondary_unit_id(
    fields: Any,
    *,
    field_key: str | None = None,
) -> int | None:
    if not isinstance(fields, list):
        return None
    accepted_keys = {
        ITEM_SECONDARY_UNIT_KEY,
        ITEM_SECONDARY_UNIT_STORED_KEY,
    }
    if field_key:
        accepted_keys.add(field_key)

    for item in fields:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "")
        if key not in accepted_keys:
            continue
        raw = item.get("value")
        if raw is None or raw == "":
            return None
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return None
        return value if value > 0 else None
    return None


async def build_item_secondary_unit_fields(
    session: AsyncSession,
    company_id: int,
    *,
    secondary_unit_id: int | None,
    clear: bool = False,
) -> list[dict[str, Any]]:
    if not clear and (secondary_unit_id is None or secondary_unit_id <= 0):
        return []

    ensured = await ensure_item_secondary_unit_field(session, company_id)
    field = ensured.get("field") if isinstance(ensured, dict) else None
    field_key = field.get("key") if isinstance(field, dict) else None
    if not isinstance(field_key, str) or not field_key:
        return []

    if clear or secondary_unit_id is None or secondary_unit_id <= 0:
        return [{"key": field_key, "value": "", "deleted": True}]

    return [{"key": field_key, "value": str(int(secondary_unit_id))}]


PARTNER_ENTITY_TYPE = "Partner"


async def list_partner_custom_fields(
    session: AsyncSession,
    company_id: int,
) -> list[dict[str, Any]]:
    """Return Regos custom Partner fields; empty list when unavailable."""
    try:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            "field/get",
            {"entity_type": PARTNER_ENTITY_TYPE},
        )
    except AppError as exc:
        if _is_custom_fields_lookup_error(exc):
            return []
        raise

    fields: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for item in response.get("result") or []:
        if not isinstance(item, dict):
            continue
        mapped = _map_field(item)
        key = mapped["key"]
        if not key or key in seen_keys:
            continue
        seen_keys.add(key)
        fields.append(mapped)
    fields.sort(key=lambda item: (item["name"].lower(), item["key"]))
    return fields
