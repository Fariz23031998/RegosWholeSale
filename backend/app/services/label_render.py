import re
from html import escape
from typing import Any

from app.services.label_images import barcode_png_data_uri, qr_png_data_uri

_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")
_STYLE_RE = re.compile(r"<style[^>]*>(.*?)</style>", re.IGNORECASE | re.DOTALL)
_BODY_RE = re.compile(r"<body[^>]*>(.*?)</body>", re.IGNORECASE | re.DOTALL)

_SAMPLE_PRODUCT_IMAGE_SRC = (
    "data:image/svg+xml;charset=UTF-8,"
    "%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2240%22%20height%3D%2240%22"
    "%20viewBox%3D%220%200%2040%2040%22%3E%3Crect%20width%3D%2240%22%20height%3D%2240%22%20fill%3D%22%23dbeafe%22%2F%3E"
    "%3Ccircle%20cx%3D%2220%22%20cy%3D%2216%22%20r%3D%226%22%20fill%3D%22%232563eb%22%2F%3E%3C%2Fsvg%3E"
)

SAMPLE_LABEL_FIELDS = {
    "name": "Sample product",
    "price": "12000",
    "current_price": "12000",
    "old_price": "15000",
    "currency": "UZS",
    "barcode": "4006381333931",
    "code": "1001",
    "articul": "ART-1",
    "sku": "ART-1",
    "category": "Grocery",
    "unit_name": "pcs",
    "image_src": _SAMPLE_PRODUCT_IMAGE_SRC,
}


def format_label_price(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    if number.is_integer():
        return str(int(number))
    return f"{number:.2f}"


def currency_label(currency: Any) -> str:
    if not isinstance(currency, dict):
        return ""
    code = currency.get("code_chr")
    if isinstance(code, str) and code.strip():
        return code.strip()
    name = currency.get("name")
    if isinstance(name, str):
        return name.strip()
    return ""


_TEXT_FIELDS = (
    "name",
    "price",
    "current_price",
    "old_price",
    "currency",
    "barcode",
    "code",
    "articul",
    "sku",
    "category",
    "unit_name",
)


def sanitize_label_image_src(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    src = value.strip()
    if not src:
        return ""
    if src.startswith("https://") or src.startswith("http://") or src.startswith("data:image/"):
        return src
    return ""


def label_fields_from_product(
    product: dict[str, Any],
    currency: str,
    price_log: tuple[Any, Any] | None = None,
) -> dict[str, str]:
    barcode = _first_text(product.get("barcode"), product.get("code"), product.get("sku"), product.get("articul"))
    current_price, old_price = price_log if price_log is not None else (None, None)
    return {
        "name": _text(product.get("name")),
        "price": format_label_price(product.get("price")),
        "current_price": format_label_price(current_price),
        "old_price": format_label_price(old_price),
        "currency": _text(currency),
        "barcode": barcode,
        "code": _text(product.get("code")),
        "articul": _text(product.get("articul")),
        "sku": _text(product.get("sku")),
        "category": _text(product.get("category")),
        "unit_name": _text(product.get("unit_name")),
        "barcode_src": barcode_png_data_uri(barcode),
        "qr_src": qr_png_data_uri(barcode),
        "image_src": sanitize_label_image_src(product.get("image")),
    }


def label_data_from_product(
    product: dict[str, Any],
    currency: str,
    price_log: tuple[Any, Any] | None = None,
) -> dict[str, str]:
    fields = label_fields_from_product(product, currency, price_log)
    return {key: _esc(value) if key in _TEXT_FIELDS else value for key, value in fields.items()}


def sample_label_fields() -> dict[str, str]:
    barcode = SAMPLE_LABEL_FIELDS["barcode"]
    data = {key: _text(value) for key, value in SAMPLE_LABEL_FIELDS.items() if key != "image_src"}
    data["barcode_src"] = barcode_png_data_uri(barcode)
    data["qr_src"] = qr_png_data_uri(barcode)
    data["image_src"] = sanitize_label_image_src(SAMPLE_LABEL_FIELDS["image_src"])
    return data


def sample_label_data() -> dict[str, str]:
    fields = sample_label_fields()
    return {key: _esc(value) if key in _TEXT_FIELDS else value for key, value in fields.items()}


def render_placeholders(html: str, data: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        value = _resolve(data, match.group(1))
        if value is None:
            return ""
        return str(value)

    return _TOKEN_RE.sub(replace, html)


def render_labels_document(template: dict[str, Any], rows: list[dict[str, str]]) -> str:
    paper = template.get("paper") or {}
    width = float(paper.get("width_mm") or 58)
    height = float(paper.get("height_mm") or 40)
    styles, body = _template_fragment(template.get("html") or "")
    extra_css = template.get("css") or ""
    if isinstance(extra_css, str) and extra_css.strip():
        styles = f"{extra_css}\n{styles}" if styles else extra_css
    pages = [
        f'<section class="label-sheet">{render_placeholders(body, row)}</section>'
        for row in rows
    ]
    page_css = (
        f"@page productlabel {{ size: {width}mm {height}mm; margin: 0; }}"
        f".label-sheet {{ page: productlabel; width: {width}mm; height: {height}mm; "
        "overflow: hidden; break-after: page; }"
        ".label-sheet:last-child { break-after: auto; }"
    )
    return f"<style>{page_css}\n{styles}</style>{''.join(pages)}"


def wrap_preview_document(fragment: str) -> str:
    return (
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\" /></head>"
        f"<body style=\"margin:0;background:#fff\">{fragment}</body></html>"
    )


def _template_fragment(html: str) -> tuple[str, str]:
    styles = "\n".join(_STYLE_RE.findall(html))
    body_match = _BODY_RE.search(html)
    if body_match:
        return styles, body_match.group(1)
    return styles, html


def _resolve(data: dict[str, Any], path: str) -> Any:
    current: Any = data
    for part in path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return None
    return current


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _esc(value: Any) -> str:
    return escape(_text(value), quote=True)


def _first_text(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""
