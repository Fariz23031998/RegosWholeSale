import re
import secrets
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request, not_found
from app.models import Company

LABEL_TEMPLATES_KEY = "label_templates"
LABEL_PRINT_KEY = "label_print"
DEFAULT_PRINTER_NAME = "Labels"
MAX_HTML_BYTES = 50_000
MAX_RENDERED_HTML_BYTES = 500_000
MAX_TEMPLATES = 50
MAX_PRINT_SERVICES = 20
MAX_LABEL_TEMPLATE_LOGOS = 10
MAX_LABEL_LOGO_BYTES = 200_000
VALID_LOGO_MIME_PREFIXES = (
    "data:image/png",
    "data:image/jpeg",
    "data:image/jpg",
    "data:image/gif",
    "data:image/webp",
    "data:image/svg+xml",
)

_HEAD_CLOSE_RE = re.compile(r"</head>", re.IGNORECASE)
_STYLE_CLOSE_RE = re.compile(r"<\s*/\s*style\b", re.IGNORECASE)
_DATA_IMAGE_RE = re.compile(
    r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+",
    re.IGNORECASE,
)

DANGEROUS_MARKUP_PATTERNS = (
    (re.compile(r"<\s*script\b", re.IGNORECASE), "Template markup cannot contain script tags."),
    (re.compile(r"<\s*/\s*script\b", re.IGNORECASE), "Template markup cannot contain script tags."),
    (re.compile(r"javascript\s*:", re.IGNORECASE), "Template markup cannot contain javascript: URLs."),
    (re.compile(r"vbscript\s*:", re.IGNORECASE), "Template markup cannot contain vbscript: URLs."),
    (re.compile(r"data\s*:\s*text/html", re.IGNORECASE), "Template markup cannot contain data:text/html URLs."),
    (
        re.compile(r"<\s*(iframe|object|embed|link|base|form)\b", re.IGNORECASE),
        "Template markup cannot contain embedded documents.",
    ),
    (re.compile(r"\bon[a-z]+\s*=", re.IGNORECASE), "Template markup cannot contain inline event handlers."),
    (re.compile(r"expression\s*\(", re.IGNORECASE), "Template markup cannot contain CSS expression()."),
)

DEFAULT_LABEL_CSS = """html, body { margin: 0; padding: 0; width: 58mm; height: 40mm; font-family: Arial, sans-serif; }
.label { box-sizing: border-box; width: 58mm; height: 40mm; padding: 2mm; display: flex; flex-direction: column; }
.name { font-size: 11px; font-weight: 700; line-height: 1.2; max-height: 2.4em; overflow: hidden; }
.price { font-size: 16px; font-weight: 700; margin-top: 1mm; }
.row { display: flex; align-items: center; gap: 2mm; margin-top: auto; }
.code { font-size: 9px; }
img.barcode { height: 12mm; width: auto; }"""

DEFAULT_LABEL_HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
</head>
<body>
  <div class="label">
    <div class="name">{{ name }}</div>
    <div class="price">{{ price }} {{ currency }}</div>
    <div class="row">
      <img class="barcode" src="{{ barcode_src }}" alt="" />
      <div class="code">{{ barcode }}</div>
    </div>
  </div>
</body>
</html>
"""


async def get_label_settings(session: AsyncSession, company_id: int) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    settings = dict(company.settings or {})
    changed = False

    templates_raw = settings.get(LABEL_TEMPLATES_KEY)
    templates_state = _normalize_template_settings(templates_raw)
    if not templates_state["templates"]:
        templates_state = _seed_templates()
        changed = True

    print_state = _normalize_print_settings(settings.get(LABEL_PRINT_KEY))
    if settings.get(LABEL_PRINT_KEY) != print_state:
        changed = True

    if changed or templates_raw != templates_state:
        settings[LABEL_TEMPLATES_KEY] = templates_state
        settings[LABEL_PRINT_KEY] = print_state
        company.settings = settings
        await session.flush()

    return _public_settings(templates_state, print_state)


async def patch_label_templates(
    session: AsyncSession, company_id: int, patch: dict[str, Any]
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    current = await get_label_settings(session, company_id)
    previous = {item["id"]: item for item in current["templates"]}

    if patch.get("templates") is not None:
        current["templates"] = _normalize_templates(patch["templates"], previous)

    if "default_template_id" in patch:
        current["default_template_id"] = patch["default_template_id"]

    template_state = _normalize_template_settings(
        {
            "templates": current["templates"],
            "default_template_id": current["default_template_id"],
        }
    )
    settings = dict(company.settings or {})
    settings[LABEL_TEMPLATES_KEY] = template_state
    company.settings = settings
    await session.flush()
    return _public_settings(template_state, _normalize_print_settings(settings.get(LABEL_PRINT_KEY)))


async def patch_label_print(
    session: AsyncSession, company_id: int, patch: dict[str, Any]
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    current = await get_label_settings(session, company_id)
    print_state = {
        "printer_name": current["print"]["printer_name"],
        "token": current["print"]["token"],
        "services": current["print"]["services"],
    }
    if patch.get("services") is not None:
        print_state["services"] = patch["services"]
    elif patch.get("printer_name") is not None:
        services = [dict(item) for item in current["print"]["services"]]
        for service in services:
            if service.get("is_default"):
                service["printer_name"] = patch["printer_name"]
        print_state["services"] = services
        print_state["printer_name"] = patch["printer_name"]
    if patch.get("regenerate_token"):
        print_state["token"] = secrets.token_urlsafe(32)

    print_state = _normalize_print_settings(print_state)
    settings = dict(company.settings or {})
    settings[LABEL_PRINT_KEY] = print_state
    company.settings = settings
    await session.flush()
    template_state = {
        "templates": current["templates"],
        "default_template_id": current["default_template_id"],
    }
    return _public_settings(template_state, print_state)


async def company_id_for_print_token(session: AsyncSession, token: str) -> int | None:
    if not isinstance(token, str) or not token.strip():
        return None
    result = await session.execute(select(Company.id, Company.settings))
    for company_id, raw_settings in result.all():
        label_print = (raw_settings or {}).get(LABEL_PRINT_KEY) or {}
        if isinstance(label_print, dict) and label_print.get("token") == token:
            return int(company_id)
    return None


def protocol_templates(settings: dict[str, Any]) -> list[dict[str, Any]]:
    templates: list[dict[str, Any]] = []
    for item in settings.get("templates") or []:
        paper = item.get("paper") or {}
        templates.append(
            {
                "id": item["id"],
                "kind": "label",
                "version": int(item.get("version") or 1),
                "paper": {
                    "widthMm": float(paper.get("width_mm") or 58),
                    "heightMm": float(paper.get("height_mm") or 40),
                },
                "html": compose_label_html(item.get("html") or "", item.get("css") or ""),
            }
        )
    return templates


def compose_label_html(html: str, css: str) -> str:
    markup = html or ""
    sheet = (css or "").strip()
    if not sheet:
        return markup
    style = f"<style>\n{sheet}\n</style>"
    if _HEAD_CLOSE_RE.search(markup):
        return _HEAD_CLOSE_RE.sub(style + "\n</head>", markup, count=1)
    return f"{style}\n{markup}"


def find_template(settings: dict[str, Any], template_id: str | None) -> dict[str, Any]:
    templates = settings.get("templates") or []
    if not templates:
        raise bad_request("No label templates are configured.", "LABEL_TEMPLATE_NOT_FOUND")
    if template_id:
        match = next((item for item in templates if item["id"] == template_id), None)
        if match is None:
            raise not_found("Label template not found.", "LABEL_TEMPLATE_NOT_FOUND")
        return match
    default_id = settings.get("default_template_id")
    match = next((item for item in templates if item["id"] == default_id), None)
    return match or templates[0]


def _public_settings(templates_state: dict[str, Any], print_state: dict[str, Any]) -> dict[str, Any]:
    return {
        "templates": templates_state["templates"],
        "default_template_id": templates_state["default_template_id"],
        "print": print_state,
    }


def _seed_templates() -> dict[str, Any]:
    template_id = str(uuid.uuid4())
    return {
        "templates": [
            {
                "id": template_id,
                "name": "58×40 mm label",
                "is_default": True,
                "paper": {"width_mm": 58, "height_mm": 40},
                "html": DEFAULT_LABEL_HTML.strip(),
                "css": DEFAULT_LABEL_CSS.strip(),
                "logos": [],
                "version": 1,
            }
        ],
        "default_template_id": template_id,
    }


def _normalize_template_settings(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    templates = _normalize_templates(data.get("templates"), {})
    default_template_id = data.get("default_template_id")
    template_ids = {item["id"] for item in templates}
    if default_template_id not in template_ids:
        default_template_id = None
    if templates and default_template_id is None:
        default_template_id = templates[0]["id"]
    if templates:
        for template in templates:
            template["is_default"] = template["id"] == default_template_id
    return {"templates": templates, "default_template_id": default_template_id}


def _normalize_templates(raw: Any, previous: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise bad_request("templates must be a list.", "INVALID_LABEL_TEMPLATES")
    if len(raw) > MAX_TEMPLATES:
        raise bad_request("Too many label templates.", "TOO_MANY_LABEL_TEMPLATES")

    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise bad_request("Each template must be an object.", "INVALID_LABEL_TEMPLATE")
        template_id = item.get("id")
        if not isinstance(template_id, str) or not template_id.strip():
            template_id = str(uuid.uuid4())
        template_id = template_id.strip()
        if template_id in seen_ids:
            raise bad_request("Duplicate template id.", "DUPLICATE_LABEL_TEMPLATE_ID")
        seen_ids.add(template_id)

        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            raise bad_request("Template name is required.", "INVALID_LABEL_TEMPLATE_NAME")

        paper = _normalize_paper(item.get("paper"))
        html = _normalize_html(item.get("html"))
        css = _normalize_css(item.get("css"))
        logos = _normalize_logos(item.get("logos"))
        prior = previous.get(template_id)
        version = _next_version(prior, paper, html, css, logos, item.get("version"))
        normalized.append(
            {
                "id": template_id,
                "name": name.strip()[:120],
                "is_default": bool(item.get("is_default", False)),
                "paper": paper,
                "html": html,
                "css": css,
                "logos": logos,
                "version": version,
            }
        )
    return normalized


def _next_version(
    prior: dict[str, Any] | None,
    paper: dict[str, float],
    html: str,
    css: str,
    logos: list[dict[str, Any]],
    incoming: Any,
) -> int:
    if prior is None:
        if isinstance(incoming, int) and incoming >= 1:
            return incoming
        return 1
    changed = (
        prior.get("paper") != paper
        or (prior.get("html") or "") != html
        or (prior.get("css") or "") != css
        or (prior.get("logos") or []) != logos
    )
    base = prior.get("version") if isinstance(prior.get("version"), int) else 1
    if isinstance(incoming, int) and incoming > base:
        base = incoming
    return base + 1 if changed else max(base, 1)


def _normalize_str(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


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
        raise bad_request("Template logos must be a list.", "INVALID_LABEL_TEMPLATE_LOGOS")

    normalized: list[dict[str, Any]] = []
    seen_names: set[str] = set()

    for item in raw:
        if not isinstance(item, dict):
            raise bad_request("Each logo must be an object.", "INVALID_LABEL_TEMPLATE_LOGO")

        src = _normalize_str(item.get("src"))
        if not src:
            continue
        if not _is_valid_logo_data_url(src):
            raise bad_request("Logo image source is invalid.", "INVALID_LABEL_TEMPLATE_LOGO")
        if len(src.encode("utf-8")) > MAX_LABEL_LOGO_BYTES:
            raise bad_request("Logo image exceeds size limit.", "LABEL_LOGO_TOO_LARGE")

        logo_id = item.get("id")
        if not isinstance(logo_id, str) or not logo_id.strip():
            logo_id = str(uuid.uuid4())

        name = _normalize_str(item.get("name")) or "Logo"
        normalized_name = name.casefold()
        if normalized_name in seen_names:
            raise bad_request("Duplicate logo name.", "DUPLICATE_LABEL_TEMPLATE_LOGO_NAME")
        seen_names.add(normalized_name)

        max_width = item.get("max_width")
        normalized_max_width: int | None = None
        if isinstance(max_width, (int, float)) and max_width > 0:
            normalized_max_width = min(int(max_width), 600)

        normalized.append(
            {
                "id": logo_id.strip(),
                "name": name[:80],
                "src": src,
                "max_width": normalized_max_width,
            }
        )

        if len(normalized) > MAX_LABEL_TEMPLATE_LOGOS:
            raise bad_request(
                f"A template can have at most {MAX_LABEL_TEMPLATE_LOGOS} logos.",
                "TOO_MANY_LABEL_TEMPLATE_LOGOS",
            )

    return normalized


def _normalize_paper(raw: Any) -> dict[str, float]:
    data = raw if isinstance(raw, dict) else {}
    width = data.get("width_mm", data.get("widthMm"))
    height = data.get("height_mm", data.get("heightMm"))
    try:
        width_mm = float(width)
        height_mm = float(height)
    except (TypeError, ValueError):
        raise bad_request("Label paper size is required.", "INVALID_LABEL_PAPER")
    if width_mm <= 0 or height_mm <= 0 or width_mm > 500 or height_mm > 500:
        raise bad_request("Label paper size is out of range.", "INVALID_LABEL_PAPER")
    return {"width_mm": width_mm, "height_mm": height_mm}


def _normalize_html(raw: Any) -> str:
    if raw is None:
        html = ""
    elif not isinstance(raw, str):
        raise bad_request("Template html must be a string.", "INVALID_LABEL_HTML")
    else:
        html = raw
    if not html.strip():
        raise bad_request("Label templates require HTML.", "INVALID_LABEL_HTML")
    if len(html.encode("utf-8")) > MAX_HTML_BYTES:
        raise bad_request("Template html exceeds size limit.", "LABEL_HTML_TOO_LARGE")
    for pattern, message in DANGEROUS_MARKUP_PATTERNS:
        if pattern.search(html):
            raise bad_request(message, "INVALID_LABEL_TEMPLATE_MARKUP")
    return html


def normalize_rendered_html(raw: Any) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise bad_request("Rendered label html is required.", "INVALID_LABEL_HTML")
    if len(raw.encode("utf-8")) > MAX_RENDERED_HTML_BYTES:
        raise bad_request("Rendered label html exceeds size limit.", "LABEL_HTML_TOO_LARGE")
    scanned = _DATA_IMAGE_RE.sub("", raw)
    for pattern, message in DANGEROUS_MARKUP_PATTERNS:
        if pattern.search(scanned):
            raise bad_request(message, "INVALID_LABEL_TEMPLATE_MARKUP")
    return raw


def _normalize_css(raw: Any) -> str:
    if raw is None:
        css = ""
    elif not isinstance(raw, str):
        raise bad_request("Template css must be a string.", "INVALID_LABEL_CSS")
    else:
        css = raw
    if len(css.encode("utf-8")) > MAX_HTML_BYTES:
        raise bad_request("Template css exceeds size limit.", "LABEL_CSS_TOO_LARGE")
    if _STYLE_CLOSE_RE.search(css):
        raise bad_request("Template css cannot close a style tag.", "INVALID_LABEL_TEMPLATE_MARKUP")
    for pattern, message in DANGEROUS_MARKUP_PATTERNS:
        if pattern.search(css):
            raise bad_request(message, "INVALID_LABEL_TEMPLATE_MARKUP")
    return css


def _normalize_print_settings(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    token = data.get("token")
    if not isinstance(token, str) or not token.strip():
        token = secrets.token_urlsafe(32)
    services_raw = data.get("services")
    if isinstance(services_raw, list) and services_raw:
        services = _normalize_services(services_raw)
    else:
        services = _services_from_legacy(data.get("printer_name"))
    default = next(item for item in services if item["is_default"])
    return {
        "printer_name": default["printer_name"],
        "token": token.strip(),
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
            raise bad_request("Printer name is required.", "INVALID_LABEL_PRINTER")
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
        return DEFAULT_PRINTER_NAME
    if not isinstance(raw, str) or not raw.strip():
        raise bad_request("Printer name is required.", "INVALID_LABEL_PRINTER")
    name = raw.strip()
    if len(name) > 80:
        raise bad_request("Printer name is too long.", "INVALID_LABEL_PRINTER")
    return name


async def _get_company(session: AsyncSession, company_id: int) -> Company:
    company = await session.get(Company, company_id)
    if not company:
        raise not_found("Company not found")
    return company
