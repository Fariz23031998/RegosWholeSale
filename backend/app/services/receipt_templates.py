import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request, not_found
from app.models import Company

RECEIPT_TEMPLATES_KEY = "receipt_templates"
VALID_FORMATS = {"80mm", "a4"}
SECTION_KEYS = frozenset(
    {
        "header",
        "meta",
        "partner",
        "items",
        "subtotal",
        "discount",
        "total",
        "payments",
        "tendered_change",
        "balance_due",
        "closed_without_payment",
        "footer",
    }
)


async def get_receipt_templates(
    session: AsyncSession, company_id: int
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    raw = (company.settings or {}).get(RECEIPT_TEMPLATES_KEY)
    normalized = _normalize_settings(raw)

    if not normalized["templates"]:
        normalized = _seed_defaults(company.name)
        settings = dict(company.settings or {})
        settings[RECEIPT_TEMPLATES_KEY] = normalized
        company.settings = settings
        await session.flush()

    return normalized


async def patch_receipt_templates(
    session: AsyncSession, company_id: int, patch: dict[str, Any]
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    current = await get_receipt_templates(session, company_id)

    if patch.get("templates") is not None:
        current["templates"] = _normalize_templates(patch["templates"])

    if "default_template_id" in patch:
        current["default_template_id"] = patch["default_template_id"]

    current = _normalize_settings(current)

    settings = dict(company.settings or {})
    settings[RECEIPT_TEMPLATES_KEY] = current
    company.settings = settings
    await session.flush()
    return current


def _seed_defaults(company_name: str) -> dict[str, Any]:
    receipt_id = str(uuid.uuid4())
    invoice_id = str(uuid.uuid4())
    header = {
        "company_name": company_name or "Company",
        "address": "",
        "phone": "",
        "tax_id": "",
    }
    receipt_sections = _default_sections_for_format("80mm")
    invoice_sections = _default_sections_for_format("a4")

    return {
        "templates": [
            {
                "id": receipt_id,
                "name": "80mm Receipt",
                "format": "80mm",
                "is_default": True,
                "header": dict(header),
                "invoice_title": "",
                "footer_text": "Thank you for your purchase!",
                "sections": receipt_sections,
            },
            {
                "id": invoice_id,
                "name": "A4 Invoice",
                "format": "a4",
                "is_default": False,
                "header": dict(header),
                "invoice_title": "INVOICE",
                "footer_text": "Thank you for your business.",
                "sections": invoice_sections,
            },
        ],
        "default_template_id": receipt_id,
    }


def _default_sections_for_format(fmt: str) -> dict[str, bool]:
    partner = fmt == "a4"
    return {
        "header": True,
        "meta": True,
        "partner": partner,
        "items": True,
        "subtotal": True,
        "discount": True,
        "total": True,
        "payments": True,
        "tendered_change": True,
        "balance_due": True,
        "closed_without_payment": True,
        "footer": True,
    }


def _normalize_settings(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    templates = _normalize_templates(data.get("templates"))
    default_template_id = data.get("default_template_id")

    template_ids = {t["id"] for t in templates}
    if default_template_id is not None and default_template_id not in template_ids:
        default_template_id = None

    if templates and default_template_id is None:
        default_template_id = templates[0]["id"]

    default_count = sum(1 for t in templates if t.get("is_default"))
    if default_count != 1 and templates:
        default_template_id = default_template_id or templates[0]["id"]
        for template in templates:
            template["is_default"] = template["id"] == default_template_id

    return {
        "templates": templates,
        "default_template_id": default_template_id,
    }


def _normalize_templates(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise bad_request("templates must be a list.", "INVALID_RECEIPT_TEMPLATES")

    if not raw:
        return []

    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for item in raw:
        if not isinstance(item, dict):
            raise bad_request("Each template must be an object.", "INVALID_RECEIPT_TEMPLATE")

        template_id = item.get("id")
        if not isinstance(template_id, str) or not template_id.strip():
            template_id = str(uuid.uuid4())
        if template_id in seen_ids:
            raise bad_request("Duplicate template id.", "DUPLICATE_RECEIPT_TEMPLATE_ID")
        seen_ids.add(template_id)

        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            raise bad_request("Template name is required.", "INVALID_RECEIPT_TEMPLATE_NAME")

        fmt = item.get("format")
        if fmt not in VALID_FORMATS:
            raise bad_request("Invalid template format.", "INVALID_RECEIPT_FORMAT")

        normalized.append(
            {
                "id": template_id,
                "name": name.strip(),
                "format": fmt,
                "is_default": bool(item.get("is_default", False)),
                "header": _normalize_header(item.get("header")),
                "invoice_title": _normalize_str(item.get("invoice_title")),
                "footer_text": _normalize_str(item.get("footer_text")),
                "sections": _normalize_sections(item.get("sections"), fmt),
            }
        )

    return normalized


def _normalize_header(raw: Any) -> dict[str, str]:
    data = raw if isinstance(raw, dict) else {}
    return {
        "company_name": _normalize_str(data.get("company_name")),
        "address": _normalize_str(data.get("address")),
        "phone": _normalize_str(data.get("phone")),
        "tax_id": _normalize_str(data.get("tax_id")),
    }


def _normalize_sections(raw: Any, fmt: str) -> dict[str, bool]:
    defaults = _default_sections_for_format(fmt)
    data = raw if isinstance(raw, dict) else {}

    sections: dict[str, bool] = {}
    for key in SECTION_KEYS:
        if key in data:
            sections[key] = bool(data[key])
        else:
            sections[key] = defaults[key]

    if fmt == "80mm":
        sections["partner"] = False

    return sections


def _normalize_str(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


async def _get_company(session: AsyncSession, company_id: int) -> Company:
    company = await session.get(Company, company_id)
    if not company:
        raise not_found("Company not found")
    return company
