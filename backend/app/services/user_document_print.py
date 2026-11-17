from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request
from app.models import User
from app.services import receipt_templates as receipt_templates_service
from app.services import settings as settings_service

USER_DOCUMENT_PRINT_KEY = "document_print"
VALID_METHODS = {"service", "browser"}


async def get_effective_user_document_print(
    session: AsyncSession, user_id: int, company_id: int
) -> dict[str, Any]:
    company = await receipt_templates_service.get_receipt_templates(session, company_id)
    stored = await _stored_settings(session, user_id)
    return _effective_settings(company, stored)


async def patch_user_document_print(
    session: AsyncSession, user: User, patch: dict[str, Any]
) -> dict[str, Any]:
    company = await receipt_templates_service.get_receipt_templates(session, user.company_id)
    template_id = _optional_id(patch.get("template_id"))
    service_id = _optional_id(patch.get("service_id"))
    printer_name = _optional_printer_name(patch.get("printer_name"))
    method = patch.get("method") or "service"
    if method not in VALID_METHODS:
        raise bad_request("Print method is invalid.", "INVALID_PRINT_METHOD")

    template_ids = {item["id"] for item in company.get("templates") or []}
    if template_id is not None and template_id not in template_ids:
        raise bad_request("Receipt template not found.", "RECEIPT_TEMPLATE_NOT_FOUND")

    service_ids = {item["id"] for item in (company.get("print") or {}).get("services") or []}
    if service_id is not None and service_id not in service_ids:
        raise bad_request("Print service not found.", "PRINT_SERVICE_NOT_FOUND")

    stored = {
        "template_id": template_id,
        "service_id": service_id,
        "printer_name": printer_name,
        "method": method,
    }
    await settings_service.patch_user_settings(
        session, user, {USER_DOCUMENT_PRINT_KEY: stored}
    )
    return _effective_settings(company, stored)


def _effective_settings(company: dict[str, Any], stored: dict[str, Any] | None) -> dict[str, Any]:
    data = stored or {}
    templates = company.get("templates") or []
    services = (company.get("print") or {}).get("services") or []
    template_ids = {item["id"] for item in templates}
    service_ids = {item["id"] for item in services}

    template_id = data.get("template_id") if isinstance(data.get("template_id"), str) else None
    if template_id not in template_ids:
        template_id = company.get("default_template_id")
        if template_id not in template_ids:
            template_id = templates[0]["id"] if templates else None

    service_id = data.get("service_id") if isinstance(data.get("service_id"), str) else None
    if service_id not in service_ids:
        default = next((item for item in services if item.get("is_default")), None)
        fallback = default or (services[0] if services else None)
        service_id = fallback["id"] if fallback else None

    printer_name = data.get("printer_name") if isinstance(data.get("printer_name"), str) else None
    if printer_name is not None:
        printer_name = printer_name.strip() or None
        if printer_name is not None and len(printer_name) > 80:
            printer_name = printer_name[:80]

    method = data.get("method") if data.get("method") in VALID_METHODS else "service"

    return {
        "template_id": template_id,
        "service_id": service_id,
        "printer_name": printer_name,
        "method": method,
    }


async def _stored_settings(session: AsyncSession, user_id: int) -> dict[str, Any] | None:
    all_settings = await settings_service.get_user_settings(session, user_id)
    raw = all_settings.get(USER_DOCUMENT_PRINT_KEY)
    return raw if isinstance(raw, dict) else None


def _optional_id(raw: Any) -> str | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise bad_request("Print setting id must be a string.", "INVALID_PRINT_SETTING")
    value = raw.strip()
    return value or None


def _optional_printer_name(raw: Any) -> str | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise bad_request("Printer name must be a string.", "INVALID_PRINTER_NAME")
    value = raw.strip()
    if not value:
        return None
    if len(value) > 80:
        raise bad_request("Printer name is too long.", "INVALID_PRINTER_NAME")
    return value
