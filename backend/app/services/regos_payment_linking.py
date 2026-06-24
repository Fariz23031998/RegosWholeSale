import re
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError, bad_request
from app.core.regos_api import regos_async_api_request_for_company
from app.services import regos_fields as regos_fields_service
from app.services.regos_defaults import _get_company
from app.services.regos_document_fetch import fetch_document
from app.services.regos_fields import REGOS_INTEGRATION_KEY

PaymentLinkingMode = Literal["sale_id_field", "document_description"]

PAYMENT_IDS_PREFIX = "pulse:pay:"
PAYMENT_LINKING_MODE_KEY = "payment_linking_mode"
DEFAULT_PAYMENT_LINKING_MODE: PaymentLinkingMode = "document_description"

PAYMENT_IDS_PATTERN = re.compile(r"pulse:pay:(\d+(?:,\d+)*)")

WHOLESALE_GET_ENDPOINT = "docwholesale/get"
WHOLESALE_RETURN_GET_ENDPOINT = "docwholesalereturn/get"
WHOLESALE_EDIT_ENDPOINT = "docwholesale/edit"
WHOLESALE_RETURN_EDIT_ENDPOINT = "docwholesalereturn/edit"


def parse_payment_ids_from_description(description: str | None) -> list[int]:
    if not description:
        return []
    match = PAYMENT_IDS_PATTERN.search(description)
    if not match:
        return []
    return [int(part) for part in match.group(1).split(",") if part]


def append_payment_ids_to_description(
    description: str | None,
    payment_ids: list[int],
) -> str:
    if not payment_ids:
        return description or ""

    segments: list[str] = []
    if description:
        segments = [
            segment
            for segment in description.split("|")
            if segment and not segment.startswith(PAYMENT_IDS_PREFIX)
        ]

    pay_segment = f"{PAYMENT_IDS_PREFIX}{','.join(str(payment_id) for payment_id in payment_ids)}"
    if segments:
        return "|".join([*segments, pay_segment])
    return pay_segment


def get_payment_linking_mode(company_settings: dict[str, Any]) -> PaymentLinkingMode:
    integration = company_settings.get(REGOS_INTEGRATION_KEY)
    if isinstance(integration, dict):
        mode = integration.get(PAYMENT_LINKING_MODE_KEY)
        if mode in ("sale_id_field", "document_description"):
            return mode
    return DEFAULT_PAYMENT_LINKING_MODE


def validate_payment_linking_mode(
    mode: str,
    sale_id_field_configured: bool,
) -> PaymentLinkingMode:
    if mode not in ("sale_id_field", "document_description"):
        raise bad_request(
            "Invalid payment linking mode.",
            "INVALID_PAYMENT_LINKING_MODE",
        )
    if mode == "sale_id_field" and not sale_id_field_configured:
        raise bad_request(
            "Sale ID field must be configured before using sale_id_field linking mode.",
            "PAYMENT_LINKING_SALE_ID_FIELD_REQUIRED",
        )
    return mode


async def get_payment_linking_settings(
    session: AsyncSession,
    company_id: int,
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    company_settings = company.settings or {}
    mode = get_payment_linking_mode(company_settings)
    field_status = await regos_fields_service.get_doc_payment_sale_id_field_status(
        session, company_id
    )
    sale_id_field = field_status.get("field") if field_status.get("configured") else None
    return {
        "mode": mode,
        "sale_id_field_configured": bool(field_status.get("configured")),
        "sale_id_field": sale_id_field,
    }


async def set_payment_linking_mode(
    session: AsyncSession,
    company_id: int,
    mode: PaymentLinkingMode,
) -> dict[str, Any]:
    settings_data = await get_payment_linking_settings(session, company_id)
    validate_payment_linking_mode(mode, settings_data["sale_id_field_configured"])

    company = await _get_company(session, company_id)
    settings = dict(company.settings or {})
    integration = dict(settings.get(REGOS_INTEGRATION_KEY) or {})
    integration[PAYMENT_LINKING_MODE_KEY] = mode
    settings[REGOS_INTEGRATION_KEY] = integration
    company.settings = settings
    await session.flush()

    return {
        "mode": mode,
        "sale_id_field_configured": settings_data["sale_id_field_configured"],
        "sale_id_field": settings_data["sale_id_field"],
    }


async def fetch_source_document(
    session: AsyncSession,
    company_id: int,
    *,
    document_id: int,
    is_return: bool,
) -> dict[str, Any] | None:
    endpoint = WHOLESALE_RETURN_GET_ENDPOINT if is_return else WHOLESALE_GET_ENDPOINT
    return await fetch_document(session, company_id, endpoint, document_id)


async def fetch_payments_by_ids(
    session: AsyncSession,
    company_id: int,
    payment_ids: list[int],
) -> list[dict[str, Any]]:
    if not payment_ids:
        return []

    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "docpayment/get",
        {
            "ids": payment_ids,
            "performed": True,
            "deleted_mark": False,
            "limit": len(payment_ids),
            "offset": 0,
        },
    )
    raw_items = response.get("result") or []
    return [item for item in raw_items if isinstance(item, dict)]


async def update_source_document_description(
    session: AsyncSession,
    company_id: int,
    *,
    document_id: int,
    is_return: bool,
    description: str,
) -> None:
    if is_return:
        lock_endpoint = "docwholesalereturn/lock"
        unlock_endpoint = "docwholesalereturn/unlock"
        edit_endpoint = WHOLESALE_RETURN_EDIT_ENDPOINT
    else:
        lock_endpoint = "docwholesale/lock"
        unlock_endpoint = "docwholesale/unlock"
        edit_endpoint = WHOLESALE_EDIT_ENDPOINT

    await regos_async_api_request_for_company(
        session,
        company_id,
        lock_endpoint,
        {"ids": [document_id]},
    )
    try:
        await regos_async_api_request_for_company(
            session,
            company_id,
            edit_endpoint,
            {"id": document_id, "description": description},
        )
    finally:
        await regos_async_api_request_for_company(
            session,
            company_id,
            unlock_endpoint,
            {"ids": [document_id]},
        )


async def link_payments_to_source_document(
    session: AsyncSession,
    company_id: int,
    *,
    source_document_id: int,
    is_return: bool,
    payment_doc_ids: list[int],
) -> None:
    settings = await get_payment_linking_settings(session, company_id)
    if settings["mode"] != "document_description" or not payment_doc_ids:
        return

    try:
        source_document = await fetch_source_document(
            session,
            company_id,
            document_id=source_document_id,
            is_return=is_return,
        )
        current_description = ""
        if source_document:
            current_description = str(source_document.get("description") or "")

        updated_description = append_payment_ids_to_description(
            current_description,
            payment_doc_ids,
        )
        await update_source_document_description(
            session,
            company_id,
            document_id=source_document_id,
            is_return=is_return,
            description=updated_description,
        )
    except AppError as exc:
        if isinstance(exc.detail, dict):
            original = exc.detail.get("detail", "")
            exc.detail = {
                **exc.detail,
                "detail": f"{original} (source_document_id={source_document_id})",
            }
        raise


async def _fetch_payments_by_sale_id_field(
    session: AsyncSession,
    company_id: int,
    *,
    source_document_id: int,
) -> list[dict[str, Any]]:
    sale_id_field_key = await regos_fields_service.get_doc_payment_sale_id_field_key(
        session, company_id
    )
    if not sale_id_field_key:
        return []

    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "docpayment/get",
        {
            "performed": True,
            "deleted_mark": False,
            "limit": 100,
            "offset": 0,
            "filters": [
                regos_fields_service.build_doc_payment_sale_id_filter(
                    sale_id_field_key,
                    source_document_id,
                )
            ],
        },
    )
    raw_items = response.get("result") or []
    return [item for item in raw_items if isinstance(item, dict)]


async def list_payments_for_source_document(
    session: AsyncSession,
    company_id: int,
    *,
    source_document_id: int,
    is_return: bool,
) -> list[dict[str, Any]]:
    settings = await get_payment_linking_settings(session, company_id)
    mode = settings["mode"]

    if mode == "sale_id_field":
        return await _fetch_payments_by_sale_id_field(
            session,
            company_id,
            source_document_id=source_document_id,
        )

    source_document = await fetch_source_document(
        session,
        company_id,
        document_id=source_document_id,
        is_return=is_return,
    )
    if not source_document:
        return []

    payment_ids = parse_payment_ids_from_description(
        str(source_document.get("description") or "")
    )
    if not payment_ids:
        return []

    return await fetch_payments_by_ids(session, company_id, payment_ids)
