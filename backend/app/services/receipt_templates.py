import re
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request, not_found
from app.models import Company

RECEIPT_TEMPLATES_KEY = "receipt_templates"
VALID_FORMATS = {"80mm", "a4"}
VALID_ENGINES = {"builtin", "html"}
DEFAULT_RECEIPT_PRINTER_NAME = "Receipts"
MAX_HTML_BYTES = 50_000
MAX_CSS_BYTES = 20_000
MAX_RENDERED_HTML_BYTES = 500_000
MAX_PRINT_SERVICES = 20
MAX_RECEIPT_TEMPLATE_LOGOS = 10
MAX_RECEIPT_LOGO_BYTES = 200_000
_HEAD_CLOSE_RE = re.compile(r"</head>", re.IGNORECASE)
_DATA_IMAGE_RE = re.compile(
    r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+",
    re.IGNORECASE,
)
VALID_LOGO_MIME_PREFIXES = (
    "data:image/png",
    "data:image/jpeg",
    "data:image/jpg",
    "data:image/gif",
    "data:image/webp",
    "data:image/svg+xml",
)
VALID_LINE_SORT_COLUMNS = {
    "document_order",
    "item_code",
    "item_name",
    "item_group_name",
    "item_brand",
    "item_fullname",
    "item_description",
    "item_articul",
    "item_color_name",
    "item_size_name",
    "item_producer_name",
    "item_country_name",
    "item_unit_name",
    "quantity",
    "price",
    "amount",
}
VALID_LINE_SORT_DIRECTIONS = {"asc", "desc"}
VALID_AMOUNT_IN_WORDS_LANGUAGES = {"ru", "uz", "en", "tj"}
DANGEROUS_MARKUP_PATTERNS = (
    (re.compile(r"<\s*script\b", re.IGNORECASE), "Template markup cannot contain script tags."),
    (re.compile(r"<\s*/\s*script\b", re.IGNORECASE), "Template markup cannot contain script tags."),
    (re.compile(r"javascript\s*:", re.IGNORECASE), "Template markup cannot contain javascript: URLs."),
    (re.compile(r"vbscript\s*:", re.IGNORECASE), "Template markup cannot contain vbscript: URLs."),
    (re.compile(r"data\s*:\s*text/html", re.IGNORECASE), "Template markup cannot contain data:text/html URLs."),
    (
        re.compile(r"<\s*(iframe|object|embed|link|base|form|meta)\b", re.IGNORECASE),
        "Template markup cannot contain embedded documents or metadata tags.",
    ),
    (re.compile(r"\bon[a-z]+\s*=", re.IGNORECASE), "Template markup cannot contain inline event handlers."),
    (re.compile(r"expression\s*\(", re.IGNORECASE), "Template markup cannot contain CSS expression()."),
)
DANGEROUS_CSS_PATTERNS = (
    (re.compile(r"@import\b", re.IGNORECASE), "Template CSS cannot use @import."),
    (re.compile(r"javascript\s*:", re.IGNORECASE), "Template CSS cannot contain javascript: URLs."),
    (re.compile(r"expression\s*\(", re.IGNORECASE), "Template CSS cannot contain expression()."),
    (re.compile(r"behavior\s*:", re.IGNORECASE), "Template CSS cannot contain behavior."),
)
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

    if patch.get("print") is not None:
        current["print"] = _normalize_print_settings(patch["print"])

    current = _normalize_settings(current)

    settings = dict(company.settings or {})
    settings[RECEIPT_TEMPLATES_KEY] = current
    company.settings = settings
    await session.flush()
    return current


async def patch_receipt_print(
    session: AsyncSession, company_id: int, patch: dict[str, Any]
) -> dict[str, Any]:
    current = await get_receipt_templates(session, company_id)
    print_state = {
        "printer_name": current["print"]["printer_name"],
        "services": current["print"]["services"],
    }
    if patch.get("services") is not None:
        print_state["services"] = patch["services"]
    elif patch.get("printer_name") is not None:
        services = [dict(item) for item in current["print"]["services"]]
        for service in services:
            if service.get("is_default"):
                service["printer_name"] = patch["printer_name"]
                service["name"] = patch["printer_name"]
        print_state["services"] = services
    print_state = _normalize_print_settings(print_state)
    return await patch_receipt_templates(session, company_id, {"print": print_state})


def find_template(settings: dict[str, Any], template_id: str | None) -> dict[str, Any]:
    templates = settings.get("templates") or []
    if not templates:
        raise bad_request("No receipt templates are configured.", "RECEIPT_TEMPLATE_NOT_FOUND")
    if template_id:
        match = next((item for item in templates if item["id"] == template_id), None)
        if match is None:
            raise not_found("Receipt template not found.", "RECEIPT_TEMPLATE_NOT_FOUND")
        return match
    default_id = settings.get("default_template_id")
    match = next((item for item in templates if item["id"] == default_id), None)
    return match or templates[0]


def protocol_templates(settings: dict[str, Any]) -> list[dict[str, Any]]:
    templates: list[dict[str, Any]] = []
    for item in settings.get("templates") or []:
        fmt = str(item.get("format") or "80mm")
        if fmt == "a4":
            paper = {"widthMm": 210.0, "heightMm": 297.0, "orientation": "portrait"}
        else:
            paper = {"widthMm": 80.0, "heightMm": 297.0, "orientation": "portrait"}
        html = ""
        if item.get("engine") == "html":
            html = compose_receipt_html(item.get("html") or "", item.get("css") or "")
        templates.append(
            {
                "id": item["id"],
                "kind": "receipt",
                "version": 1,
                "paper": paper,
                "html": html,
            }
        )
    return templates


def compose_receipt_html(html: str, css: str) -> str:
    markup = html or ""
    sheet = (css or "").strip()
    if not sheet:
        return markup
    style = f"<style>\n{sheet}\n</style>"
    if _HEAD_CLOSE_RE.search(markup):
        return _HEAD_CLOSE_RE.sub(style + "\n</head>", markup, count=1)
    return f"{style}\n{markup}"


def normalize_rendered_html(raw: Any) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise bad_request("Rendered document html is required.", "INVALID_DOCUMENT_HTML")
    if len(raw.encode("utf-8")) > MAX_RENDERED_HTML_BYTES:
        raise bad_request("Rendered document html exceeds size limit.", "DOCUMENT_HTML_TOO_LARGE")
    scanned = _DATA_IMAGE_RE.sub("", raw)
    for pattern, message in DANGEROUS_MARKUP_PATTERNS:
        if pattern.search(scanned):
            raise bad_request(message, "INVALID_RECEIPT_TEMPLATE_SCRIPT")
    return raw


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
                "engine": "builtin",
                "is_default": True,
                "header": dict(header),
                "invoice_title": "",
                "footer_text": "Thank you for your purchase!",
                "amount_in_words_language": None,
                "sections": receipt_sections,
                "line_sort": {"column": "document_order", "direction": "asc"},
                "logos": [],
                "partner_debt_enabled": False,
                "partner_debt_negative_only": False,
                "html": "",
                "css": "",
            },
            {
                "id": invoice_id,
                "name": "A4 Invoice",
                "format": "a4",
                "engine": "builtin",
                "is_default": False,
                "header": dict(header),
                "invoice_title": "INVOICE",
                "footer_text": "Thank you for your business.",
                "amount_in_words_language": None,
                "sections": invoice_sections,
                "line_sort": {"column": "document_order", "direction": "asc"},
                "logos": [],
                "partner_debt_enabled": False,
                "partner_debt_negative_only": False,
                "html": "",
                "css": "",
            },
        ],
        "default_template_id": receipt_id,
        "print": _normalize_print_settings(None),
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
        "print": _normalize_print_settings(data.get("print")),
    }


def _normalize_print_settings(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    services_raw = data.get("services")
    if isinstance(services_raw, list) and services_raw:
        services = _normalize_services(services_raw)
    else:
        services = _services_from_legacy(data.get("printer_name"))
    default = next(item for item in services if item["is_default"])
    return {
        "printer_name": default["printer_name"],
        "services": services,
    }


def _services_from_legacy(printer_name: Any) -> list[dict[str, Any]]:
    name = _normalize_printer_name(printer_name)
    return [
        {
            "id": str(uuid.uuid4()),
            "name": name,
            "printer_name": name,
            "is_default": True,
        }
    ]


def _normalize_services(raw: list[Any]) -> list[dict[str, Any]]:
    if len(raw) > MAX_PRINT_SERVICES:
        raise bad_request("Too many print services.", "TOO_MANY_PRINT_SERVICES")
    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise bad_request("Each print service must be an object.", "INVALID_PRINT_SERVICE")
        service_id = item.get("id")
        if not isinstance(service_id, str) or not service_id.strip():
            service_id = str(uuid.uuid4())
        service_id = service_id.strip()
        if service_id in seen_ids:
            raise bad_request("Duplicate print service id.", "DUPLICATE_PRINT_SERVICE_ID")
        seen_ids.add(service_id)
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            raise bad_request("Print service name is required.", "INVALID_PRINT_SERVICE")
        name = name.strip()
        if len(name) > 80:
            raise bad_request("Print service name is too long.", "INVALID_PRINT_SERVICE")
        printer_name = item.get("printer_name")
        if not isinstance(printer_name, str) or not printer_name.strip():
            raise bad_request("Printer name is required.", "INVALID_RECEIPT_PRINTER")
        normalized.append(
            {
                "id": service_id,
                "name": name,
                "printer_name": _normalize_printer_name(printer_name),
                "is_default": bool(item.get("is_default", False)),
            }
        )
    chosen = next((index for index, item in enumerate(normalized) if item["is_default"]), 0)
    for index, item in enumerate(normalized):
        item["is_default"] = index == chosen
    return normalized


def _normalize_printer_name(raw: Any) -> str:
    if raw is None:
        return DEFAULT_RECEIPT_PRINTER_NAME
    if not isinstance(raw, str) or not raw.strip():
        raise bad_request("Printer name is required.", "INVALID_RECEIPT_PRINTER")
    name = raw.strip()
    if len(name) > 80:
        raise bad_request("Printer name is too long.", "INVALID_RECEIPT_PRINTER")
    return name


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

        engine = item.get("engine", "builtin")
        if engine not in VALID_ENGINES:
            raise bad_request("Invalid template engine.", "INVALID_RECEIPT_ENGINE")

        html = _normalize_template_markup(item.get("html"))
        css = _normalize_template_css(item.get("css"))

        if engine == "html" and not html.strip():
            raise bad_request(
                "HTML templates require a non-empty html body.",
                "INVALID_RECEIPT_HTML",
            )
        if len(html.encode("utf-8")) > MAX_HTML_BYTES:
            raise bad_request("Template html exceeds size limit.", "RECEIPT_HTML_TOO_LARGE")
        if len(css.encode("utf-8")) > MAX_CSS_BYTES:
            raise bad_request("Template css exceeds size limit.", "RECEIPT_CSS_TOO_LARGE")

        normalized.append(
            {
                "id": template_id,
                "name": name.strip(),
                "format": fmt,
                "engine": engine,
                "is_default": bool(item.get("is_default", False)),
                "header": _normalize_header(item.get("header")),
                "invoice_title": _normalize_str(item.get("invoice_title")),
                "footer_text": _normalize_str(item.get("footer_text")),
                "amount_in_words_language": _normalize_amount_in_words_language(
                    item.get("amount_in_words_language")
                ),
                "sections": _normalize_sections(item.get("sections"), fmt),
                "line_sort": _normalize_line_sort(item.get("line_sort")),
                "logos": _normalize_logos(item.get("logos")),
                "partner_debt_enabled": bool(item.get("partner_debt_enabled", False)),
                "partner_debt_negative_only": bool(item.get("partner_debt_negative_only", False)),
                "html": html if engine == "html" else "",
                "css": css if engine == "html" else "",
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


def _is_valid_logo_data_url(src: str) -> bool:
    lowered = src.lower()
    if not any(lowered.startswith(prefix) for prefix in VALID_LOGO_MIME_PREFIXES):
        return False
    if "javascript:" in lowered or "data:text/html" in lowered:
        return False
    return True


def _normalize_logos(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise bad_request("Template logos must be a list.", "INVALID_RECEIPT_TEMPLATE_LOGOS")

    normalized: list[dict[str, Any]] = []
    seen_names: set[str] = set()

    for item in raw:
        if not isinstance(item, dict):
            raise bad_request("Each logo must be an object.", "INVALID_RECEIPT_TEMPLATE_LOGO")

        src = _normalize_str(item.get("src"))
        if not src:
            continue
        if not _is_valid_logo_data_url(src):
            raise bad_request("Logo image source is invalid.", "INVALID_RECEIPT_TEMPLATE_LOGO")
        if len(src.encode("utf-8")) > MAX_RECEIPT_LOGO_BYTES:
            raise bad_request("Logo image exceeds size limit.", "RECEIPT_LOGO_TOO_LARGE")

        logo_id = item.get("id")
        if not isinstance(logo_id, str) or not logo_id.strip():
            logo_id = str(uuid.uuid4())

        name = _normalize_str(item.get("name")) or "Logo"
        normalized_name = name.casefold()
        if normalized_name in seen_names:
            raise bad_request("Duplicate logo name.", "DUPLICATE_RECEIPT_TEMPLATE_LOGO_NAME")
        seen_names.add(normalized_name)

        max_width = item.get("max_width")
        normalized_max_width: int | None = None
        if isinstance(max_width, (int, float)) and max_width > 0:
            normalized_max_width = min(int(max_width), 600)

        normalized.append(
            {
                "id": logo_id.strip(),
                "name": name,
                "src": src,
                "max_width": normalized_max_width,
            }
        )

        if len(normalized) > MAX_RECEIPT_TEMPLATE_LOGOS:
            raise bad_request(
                f"A template can have at most {MAX_RECEIPT_TEMPLATE_LOGOS} logos.",
                "TOO_MANY_RECEIPT_TEMPLATE_LOGOS",
            )

    return normalized


def _normalize_line_sort(raw: Any) -> dict[str, str]:
    data = raw if isinstance(raw, dict) else {}
    column = data.get("column")
    direction = data.get("direction")
    normalized_column = column if isinstance(column, str) and column in VALID_LINE_SORT_COLUMNS else "document_order"
    normalized_direction = (
        direction if isinstance(direction, str) and direction in VALID_LINE_SORT_DIRECTIONS else "asc"
    )
    return {
        "column": normalized_column,
        "direction": normalized_direction,
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


def _normalize_amount_in_words_language(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, str) and value in VALID_AMOUNT_IN_WORDS_LANGUAGES:
        return value
    return None


def _normalize_template_markup(value: Any) -> str:
    return _validate_template_text(value, DANGEROUS_MARKUP_PATTERNS)


def _normalize_template_css(value: Any) -> str:
    return _validate_template_text(value, DANGEROUS_CSS_PATTERNS)


def _validate_template_text(
    value: Any,
    patterns: tuple[tuple[re.Pattern[str], str], ...],
) -> str:
    text = _normalize_str(value)
    if not text:
        return ""
    for pattern, message in patterns:
        if pattern.search(text):
            raise bad_request(message, "INVALID_RECEIPT_TEMPLATE_SCRIPT")
    return text


async def _get_company(session: AsyncSession, company_id: int) -> Company:
    company = await session.get(Company, company_id)
    if not company:
        raise not_found("Company not found")
    return company
