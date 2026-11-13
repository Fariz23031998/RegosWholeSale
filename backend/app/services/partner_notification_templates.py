"""Per-company partner Telegram notification message templates."""

from __future__ import annotations

from typing import Any

from app.services import document_telegram_format as fmt
from app.services.telegram_i18n import t
from app.utils.number_format import format_number

NOTIFICATION_TEMPLATE_TYPES = (
    "purchase",
    "return_purchase",
    "wholesale",
    "wholesale_return",
    "payment",
    "balance",
)

_BALANCE_PLACEHOLDERS = ("{{balance}}",)
_ITEMS_LOOP_START = "{{#items}}"
_ITEMS_LOOP_END = "{{/items}}"

# Event types that can trigger a follow-up balance notification.
BALANCE_NOTIFY_AFTER_TYPES = (
    "purchase",
    "return_purchase",
    "wholesale",
    "wholesale_return",
    "payment",
)


def empty_notification_templates() -> dict[str, dict[str, str]]:
    empty = {"uz": "", "ru": "", "en": ""}
    return {key: dict(empty) for key in NOTIFICATION_TEMPLATE_TYPES}


def normalize_notification_templates(value: Any) -> dict[str, dict[str, str]]:
    source = value if isinstance(value, dict) else {}
    result: dict[str, dict[str, str]] = {}
    for key in NOTIFICATION_TEMPLATE_TYPES:
        raw = source.get(key) if isinstance(source.get(key), dict) else {}
        result[key] = {
            lang: (raw.get(lang) or "").strip() if isinstance(raw.get(lang), str) else ""
            for lang in ("uz", "ru", "en")
        }
    return result


def template_for(templates: Any, kind: str, lang: str) -> str:
    normalized = normalize_notification_templates(templates)
    by_kind = normalized.get(kind) if kind in normalized else None
    if not isinstance(by_kind, dict):
        return ""
    raw = by_kind.get(lang, "")
    return raw.strip() if isinstance(raw, str) else ""


def template_needs_balance(template: str) -> bool:
    return any(token in template for token in _BALANCE_PLACEHOLDERS)


def _ref_id(value: Any) -> int:
    if isinstance(value, dict) and isinstance(value.get("id"), int) and not isinstance(value.get("id"), bool):
        return int(value["id"])
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return 0


def _ref_name(value: Any, fallback: str = "") -> str:
    if isinstance(value, dict):
        name = value.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return fallback


def document_firm_currency(document: dict[str, Any]) -> tuple[int, str, int, str]:
    firm = document.get("firm") if isinstance(document.get("firm"), dict) else {}
    currency = document.get("currency") if isinstance(document.get("currency"), dict) else {}
    firm_id = _ref_id(firm) or _ref_id(document.get("firm_id"))
    currency_id = _ref_id(currency) or _ref_id(document.get("currency_id"))
    firm_name = _ref_name(firm, f"Firm {firm_id}" if firm_id else "")
    currency_name = _ref_name(currency, f"Currency {currency_id}" if currency_id else "")
    return firm_id, firm_name, currency_id, currency_name


def _amount(value: Any) -> float:
    if isinstance(value, bool) or value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _row_sort_key(row: dict[str, Any]) -> tuple[int, int]:
    date = row.get("date")
    row_id = row.get("id")
    return (
        date if isinstance(date, int) else 0,
        row_id if isinstance(row_id, int) and not isinstance(row_id, bool) else 0,
    )


def resolve_balance_for_firm_currency(
    rows: list[dict[str, Any]],
    *,
    firm_id: int,
    currency_id: int,
    firm_name: str = "",
    currency_name: str = "",
) -> tuple[str, str, float]:
    """Latest end_amount for firm+currency; names fall back to document names."""
    latest: dict[str, Any] | None = None
    for row in rows:
        if not isinstance(row, dict):
            continue
        if _ref_id(row.get("firm")) != firm_id:
            continue
        if _ref_id(row.get("currency")) != currency_id:
            continue
        if latest is None or _row_sort_key(row) >= _row_sort_key(latest):
            latest = row
    if latest is None:
        return firm_name, currency_name, 0.0
    resolved_firm = _ref_name(latest.get("firm"), firm_name)
    resolved_currency = _ref_name(latest.get("currency"), currency_name)
    return resolved_firm, resolved_currency, _amount(latest.get("end_amount"))


def apply_placeholders(template: str, values: dict[str, str]) -> str:
    """Replace {{key}} tokens; values are HTML-escaped so author tags stay intact."""
    result = template
    for key, value in values.items():
        result = result.replace("{{" + key + "}}", fmt._escape_html(value))
    return result


def _partner_display(partner_id: int, partner_name: str | None) -> str:
    if isinstance(partner_name, str) and partner_name.strip():
        return partner_name.strip()
    return str(partner_id)


def _item_str_field(item: dict[str, Any] | None, *keys: str) -> str:
    if not isinstance(item, dict):
        return ""
    for key in keys:
        raw = item.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
        if isinstance(raw, (int, float)) and not isinstance(raw, bool):
            return str(raw)
    return ""


def _operation_item_values(
    operation: dict[str, Any],
    *,
    index: int,
    use_cost: bool,
    lang: str,
) -> dict[str, str]:
    item = operation.get("item") if isinstance(operation.get("item"), dict) else None
    name = _item_str_field(item, "name") or t("telegram.receipt.unknownItem", lang)
    quantity = float(operation.get("quantity", 0) or 0)
    cost_or_price = float(
        (operation.get("cost", 0) if use_cost else operation.get("price", 0)) or 0
    )
    item_total = quantity * cost_or_price
    description = operation.get("description", "")
    description_text = description.strip() if isinstance(description, str) else ""
    return {
        "index": str(index),
        "name": name,
        "code": _item_str_field(item, "code"),
        "articul": _item_str_field(item, "articul"),
        "barcode": _item_str_field(item, "barcode", "base_barcode"),
        "quantity": format_number(quantity),
        "price": format_number(cost_or_price),
        "line_total": format_number(item_total),
        "description": description_text,
    }


def expand_items_loop(
    template: str,
    operations: list[dict[str, Any]],
    *,
    use_cost: bool,
    lang: str,
) -> str:
    """Expand {{#items}}...{{/items}} blocks; unmatched open tags are left as-is."""
    result = template
    while True:
        start = result.find(_ITEMS_LOOP_START)
        if start < 0:
            break
        end = result.find(_ITEMS_LOOP_END, start + len(_ITEMS_LOOP_START))
        if end < 0:
            break
        body = result[start + len(_ITEMS_LOOP_START) : end]
        rendered_parts: list[str] = []
        for idx, operation in enumerate(operations, 1):
            if not isinstance(operation, dict):
                continue
            rendered_parts.append(
                apply_placeholders(
                    body,
                    _operation_item_values(
                        operation, index=idx, use_cost=use_cost, lang=lang
                    ),
                )
            )
        result = (
            result[:start]
            + "".join(rendered_parts)
            + result[end + len(_ITEMS_LOOP_END) :]
        )
    return result


def _document_items_block(
    operations: list[dict[str, Any]],
    *,
    use_cost: bool,
    lang: str,
) -> tuple[str, float, float]:
    lines: list[str] = []
    total_items = 0.0
    total_to_pay = 0.0
    for idx, operation in enumerate(operations, 1):
        item = operation.get("item")
        if isinstance(item, dict):
            item_name = item.get("name")
            name = item_name.strip() if isinstance(item_name, str) and item_name.strip() else t(
                "telegram.receipt.unknownItem", lang
            )
        else:
            name = t("telegram.receipt.unknownItem", lang)
        quantity = float(operation.get("quantity", 0) or 0)
        cost_or_price = float(
            (operation.get("cost", 0) if use_cost else operation.get("price", 0)) or 0
        )
        item_total = quantity * cost_or_price
        total_items += quantity
        total_to_pay += item_total
        lines.append(f"{idx}. {name}")
        lines.append(f"   {format_number(quantity)} × {format_number(cost_or_price)} = {format_number(item_total)}")
        description = operation.get("description", "")
        if description:
            lines.append(f"   {description}")
        lines.append("")
    return "\n".join(lines).rstrip(), total_items, total_to_pay


def format_document_notification(
    document: dict[str, Any],
    operations: list[dict[str, Any]],
    warehouse_name: str | None,
    *,
    is_cancelled: bool,
    is_return: bool,
    use_cost: bool,
    lang: str,
    template: str | None = None,
    partner_id: int | None = None,
    partner_name: str | None = None,
    firm_name: str = "",
    currency_name: str = "",
    balance: float = 0.0,
) -> str:
    custom = template.strip() if isinstance(template, str) else ""
    if not custom:
        return fmt.format_partner_receipt(
            document,
            operations,
            warehouse_name,
            is_cancelled=is_cancelled,
            is_return=is_return,
            use_cost=use_cost,
            lang=lang,
            for_partner=True,
            firm_name=firm_name,
            currency_name=currency_name,
            balance=balance,
        )

    partner = document.get("partner") if isinstance(document.get("partner"), dict) else {}
    resolved_partner_id = partner_id if isinstance(partner_id, int) else _ref_id(partner)
    resolved_partner_name = _partner_display(
        resolved_partner_id,
        partner_name
        if partner_name is not None
        else (partner.get("name") if isinstance(partner.get("name"), str) else None),
    )
    currency = document.get("currency") if isinstance(document.get("currency"), dict) else {}
    doc_currency = _ref_name(currency)
    exchange_rate = document.get("exchange_rate", 1.0)
    try:
        exchange_rate_f = float(exchange_rate or 1.0)
    except (TypeError, ValueError):
        exchange_rate_f = 1.0
    items_text, total_items, total_to_pay = _document_items_block(
        operations, use_cost=use_cost, lang=lang
    )
    cancelled = t("telegram.receipt.cancelled", lang) if is_cancelled else ""
    warehouse = warehouse_name or t("telegram.receipt.warehouseDefault", lang)
    expanded = expand_items_loop(custom, operations, use_cost=use_cost, lang=lang)
    return apply_placeholders(
        expanded,
        {
            "partner_id": str(resolved_partner_id or ""),
            "partner_name": resolved_partner_name,
            "document_code": str(document.get("code", "N/A")),
            "date": fmt._format_date(document.get("date", "")),
            "warehouse": warehouse,
            "currency": doc_currency,
            "exchange_rate": format_number(exchange_rate_f, 4),
            "items": items_text,
            "total_items": format_number(total_items),
            "total": format_number(total_to_pay),
            "cancelled": cancelled,
            "balance": format_number(balance),
        },
    )


def format_payment_notification_template(
    document: dict[str, Any],
    *,
    is_cancelled: bool,
    lang: str,
    template: str | None = None,
    partner_id: int | None = None,
    partner_name: str | None = None,
    firm_name: str = "",
    currency_name: str = "",
    balance: float = 0.0,
) -> str:
    custom = template.strip() if isinstance(template, str) else ""
    if not custom:
        return fmt.format_payment_notification(
            document,
            is_cancelled=is_cancelled,
            lang=lang,
            for_partner=True,
        )

    partner = document.get("partner") if isinstance(document.get("partner"), dict) else {}
    resolved_partner_id = partner_id if isinstance(partner_id, int) else _ref_id(partner)
    resolved_partner_name = _partner_display(
        resolved_partner_id,
        partner_name
        if partner_name is not None
        else (partner.get("name") if isinstance(partner.get("name"), str) else None),
    )
    payment_type = document.get("type") if isinstance(document.get("type"), dict) else {}
    payment_type_name = _ref_name(
        payment_type, t("telegram.receipt.unknownPaymentType", lang)
    )
    category = document.get("category") if isinstance(document.get("category"), dict) else {}
    category_positive = bool(category.get("positive")) if isinstance(category, dict) else False
    category_name = _ref_name(category)
    currency = document.get("currency") if isinstance(document.get("currency"), dict) else {}
    doc_currency = _ref_name(currency)
    direction_key = (
        "telegram.receipt.paymentPaid" if category_positive else "telegram.receipt.paymentReceived"
    )
    cancelled = t("telegram.receipt.cancelled", lang) if is_cancelled else ""
    return apply_placeholders(
        custom,
        {
            "partner_id": str(resolved_partner_id or ""),
            "partner_name": resolved_partner_name,
            "document_code": str(document.get("code", "N/A")),
            "date": fmt._format_date(document.get("date", "")),
            "amount": format_number(document.get("amount", 0)),
            "payment_type": payment_type_name,
            "category": category_name,
            "currency": doc_currency,
            "direction": t(direction_key, lang),
            "cancelled": cancelled,
            "balance": format_number(balance),
        },
    )


def empty_balance_notify_after_types() -> dict[str, bool]:
    return {key: False for key in BALANCE_NOTIFY_AFTER_TYPES}


def normalize_balance_notify_after_types(value: Any) -> dict[str, bool]:
    source = value if isinstance(value, dict) else {}
    return {
        key: bool(source.get(key)) if key in source else False
        for key in BALANCE_NOTIFY_AFTER_TYPES
    }


def format_balance_lines(
    balances: list[tuple[str, str, float]],
    *,
    signed: bool = True,
) -> str:
    prefix = "-" if signed else ""
    return "\n".join(
        f"🏢 {firm_name} ({currency_name}): {prefix}{format_number(amount)}"
        for firm_name, currency_name, amount in balances
    )


def format_builtin_balance_notification(
    partner_id: int,
    balances: list[tuple[str, str, float]],
    lang: str,
    *,
    notify_filter: str = "negative",
) -> str:
    both = notify_filter == "both"
    # ``both`` amounts are already partner-signed; ``negative`` uses magnitude + prefix.
    balance_text = format_balance_lines(balances, signed=not both)
    section_key = (
        "partnerTelegram.balance.balances" if both else "partnerTelegram.balance.negative"
    )
    return "\n".join(
        [
            t("partnerTelegram.balance.notifyTitle", lang),
            "",
            f"{t('partnerTelegram.balance.partnerId', lang)}: {partner_id}",
            "",
            t(section_key, lang),
            "",
            balance_text,
            "",
            t("partnerTelegram.balance.attached", lang),
        ]
    )


def format_balance_line_notification(
    partner_id: int,
    *,
    firm_name: str,
    currency_name: str,
    balance: float,
    lang: str,
    template: str,
    partner_name: str | None = None,
) -> str:
    """Custom balance template applied to a single firm/currency debt line."""
    return apply_placeholders(
        template.strip(),
        {
            "partner_id": str(partner_id),
            "partner_name": _partner_display(partner_id, partner_name),
            "firm_name": firm_name,
            "currency_name": currency_name,
            "balance": format_number(balance),
        },
    )


def format_balance_notification_with_templates(
    partner_id: int,
    balances: list[tuple[str, str, float]],
    lang: str,
    template: str | None = None,
    *,
    partner_name: str | None = None,
    notify_filter: str = "negative",
) -> list[str]:
    """Return one message per debt line for custom templates; otherwise one built-in message."""
    custom = template.strip() if isinstance(template, str) else ""
    if not custom:
        return [
            format_builtin_balance_notification(
                partner_id, balances, lang, notify_filter=notify_filter
            )
        ]
    return [
        format_balance_line_notification(
            partner_id,
            firm_name=firm_name,
            currency_name=currency_name,
            balance=amount,
            lang=lang,
            template=custom,
            partner_name=partner_name,
        )
        for firm_name, currency_name, amount in balances
    ]
