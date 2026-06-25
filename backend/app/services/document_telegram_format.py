from datetime import datetime
from typing import Any

from app.services.telegram_i18n import t
from app.utils.number_format import format_number


def _format_date(doc_date: Any) -> str:
    if isinstance(doc_date, (int, float)):
        try:
            return datetime.fromtimestamp(doc_date).strftime("%d.%m.%Y %H:%M")
        except (OSError, OverflowError, ValueError):
            return str(doc_date)
    return str(doc_date) if doc_date else ""


def _item_name(item: Any, lang: str) -> str:
    if isinstance(item, dict):
        name = item.get("name")
        if isinstance(name, str) and name.strip():
            return name
    if item:
        return str(item)
    return t("telegram.receipt.unknownItem", lang)


def _parse_inout_type_value(value: Any) -> str | None:
    if value in (1, "1", "Income", "income", "INCOME"):
        return "income"
    if value in (2, "2", "Outcome", "outcome", "OUTCOME"):
        return "outcome"
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"income", "входящий", "внесение", "приход"}:
            return "income"
        if normalized in {"outcome", "исходящий", "списание", "расход"}:
            return "outcome"
    return None


def _partner_phone(partner: dict[str, Any]) -> str | None:
    phone = partner.get("phone")
    if isinstance(phone, str) and phone.strip():
        return phone.strip()
    phones = partner.get("phones")
    if isinstance(phones, list):
        return next(
            (str(entry).strip() for entry in phones if isinstance(entry, str) and entry.strip()),
            None,
        )
    if isinstance(phones, str) and phones.strip():
        return phones.strip()
    return None


def _attached_user_name(document: dict[str, Any]) -> str | None:
    attached_user = document.get("attached_user")
    if not isinstance(attached_user, dict):
        attached_user = document.get("user")
    if not isinstance(attached_user, dict):
        return None

    user_id = attached_user.get("id")

    full_name = attached_user.get("full_name")
    if isinstance(full_name, str) and full_name.strip():
        return full_name.strip()

    parts = [
        part
        for part in (attached_user.get("first_name"), attached_user.get("last_name"))
        if isinstance(part, str) and part.strip()
    ]
    if parts:
        return " ".join(parts)

    name = attached_user.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()

    if isinstance(user_id, int):
        return f"#{user_id}"

    return None


def _append_attached_user(
    message_parts: list[str],
    document: dict[str, Any],
    lang: str,
) -> None:
    user_name = _attached_user_name(document)
    if user_name:
        message_parts.append(
            f"🧑‍💼 {t('telegram.receipt.attachedUser', lang, name=user_name)}"
        )


def _resolve_exchange_rate(document: dict[str, Any], currency: dict[str, Any] | None) -> float:
    raw_rate = document.get("exchange_rate")
    if raw_rate is not None:
        try:
            return float(raw_rate)
        except (TypeError, ValueError):
            pass
    if isinstance(currency, dict) and currency.get("exchange_rate") is not None:
        try:
            return float(currency["exchange_rate"])
        except (TypeError, ValueError):
            pass
    return 1.0


def parse_inout_type(document: dict[str, Any]) -> str | None:
    raw = document.get("inout_type")
    if raw is None:
        raw = document.get("type")

    if isinstance(raw, dict):
        for key in ("name", "code", "value", "id"):
            if key not in raw:
                continue
            parsed = _parse_inout_type_value(raw[key])
            if parsed:
                return parsed
        return None

    return _parse_inout_type_value(raw)


def format_partner_receipt(
    document: dict[str, Any],
    operations: list[dict[str, Any]],
    warehouse_name: str | None = None,
    *,
    is_cancelled: bool = False,
    is_return: bool = False,
    use_cost: bool = False,
    lang: str = "ru",
) -> str:
    doc_code = document.get("code", "N/A")
    formatted_date = _format_date(document.get("date", ""))
    message_parts: list[str] = []

    if is_cancelled:
        message_parts.extend([f"❌ *{t('telegram.receipt.cancelled', lang)}*", ""])

    if is_return:
        receipt_key = (
            "telegram.receipt.purchaseReturn" if use_cost else "telegram.receipt.wholesaleReturn"
        )
    elif use_cost:
        receipt_key = "telegram.receipt.purchase"
    else:
        receipt_key = "telegram.receipt.wholesale"

    message_parts.extend(
        [
            f"🧾 *{t(receipt_key, lang)}*",
            f"📄 *{t('telegram.receipt.documentNo', lang, code=doc_code)}*",
            f"📅 {t('telegram.receipt.date', lang, date=formatted_date)}",
        ]
    )

    warehouse = warehouse_name or t("telegram.receipt.warehouseDefault", lang)
    message_parts.append(f"🏢 {t('telegram.receipt.warehouse', lang, name=warehouse)}")
    _append_attached_user(message_parts, document, lang)

    partner = document.get("partner", {})
    if not isinstance(partner, dict):
        partner = {}
    partner_name = partner.get("name")
    if not isinstance(partner_name, str) or not partner_name.strip():
        partner_name = t("telegram.receipt.unknownPartner", lang)
    message_parts.append(f"👤 {t('telegram.receipt.partner', lang, name=partner_name)}")

    partner_phone = _partner_phone(partner)
    if partner_phone:
        message_parts.append(f"📞 {t('telegram.receipt.partnerPhone', lang, phone=partner_phone)}")

    currency = document.get("currency", {})
    currency_name = currency.get("name", "") if isinstance(currency, dict) else ""
    exchange_rate = _resolve_exchange_rate(document, currency if isinstance(currency, dict) else None)

    if currency_name:
        message_parts.append(f"💰 {t('telegram.receipt.currency', lang, name=currency_name)}")
    if exchange_rate != 1.0:
        message_parts.append(
            f"📊 {t('telegram.receipt.exchangeRate', lang, rate=format_number(exchange_rate, 4))}"
        )

    message_parts.extend(["", f"📦 *{t('telegram.receipt.items', lang)}*", ""])

    total_items = 0.0
    total_to_pay = 0.0

    for idx, operation in enumerate(operations, 1):
        item_name = _item_name(operation.get("item"), lang)
        quantity = float(operation.get("quantity", 0))
        if use_cost:
            cost_or_price = float(operation.get("cost", 0))
        else:
            cost_or_price = float(operation.get("price", 0))

        description = operation.get("description", "")
        total_items += quantity
        item_total = quantity * cost_or_price
        total_to_pay += item_total

        message_parts.append(f"{idx}. *{item_name}*")
        message_parts.append(
            f"   {format_number(quantity)} × {format_number(cost_or_price)} = {format_number(item_total)}"
        )
        if description:
            message_parts.append(f"   {t('telegram.receipt.note', lang, text=description)}")
        message_parts.append("")

    message_parts.extend(
        [
            "─" * 20,
            f"📊 {t('telegram.receipt.totalItems', lang, count=format_number(total_items))}",
            f"💵 *{t('telegram.receipt.totalToPay', lang, amount=format_number(total_to_pay))}*",
        ]
    )
    return "\n".join(message_parts)


def format_payment_notification(
    document: dict[str, Any],
    warehouse_name: str | None = None,
    *,
    is_cancelled: bool = False,
    lang: str = "ru",
) -> str:
    doc_code = document.get("code", "N/A")
    formatted_date = _format_date(document.get("date", ""))
    amount = document.get("amount", 0)
    payment_type = document.get("type", {})
    payment_type_name = (
        payment_type.get("name", t("telegram.receipt.unknownPaymentType", lang))
        if isinstance(payment_type, dict)
        else t("telegram.receipt.unknownPaymentType", lang)
    )

    currency = document.get("currency", {})
    currency_name = currency.get("name", "") if isinstance(currency, dict) else ""

    exchange_rate = document.get("exchange_rate", 1.0)
    if isinstance(exchange_rate, str):
        try:
            exchange_rate = float(exchange_rate)
        except (ValueError, TypeError):
            exchange_rate = 1.0
    else:
        exchange_rate = float(exchange_rate or 1.0)

    category = document.get("category", {})
    category_positive = category.get("positive", False) if isinstance(category, dict) else False

    message_parts: list[str] = []
    if is_cancelled:
        message_parts.extend([f"❌ *{t('telegram.receipt.cancelled', lang)}*", ""])

    direction_key = (
        "telegram.receipt.paymentPaid" if category_positive else "telegram.receipt.paymentReceived"
    )
    direction_emoji = "⬆️" if category_positive else "⬇️"

    message_parts.extend(
        [
            f"{direction_emoji} *{t(direction_key, lang)}*",
            f"📄 *{t('telegram.receipt.documentNo', lang, code=doc_code)}*",
            f"📅 {t('telegram.receipt.date', lang, date=formatted_date)}",
        ]
    )

    warehouse = warehouse_name or t("telegram.receipt.warehouseDefault", lang)
    message_parts.append(f"🏢 {t('telegram.receipt.warehouse', lang, name=warehouse)}")
    _append_attached_user(message_parts, document, lang)

    message_parts.extend(["", f"💳 {t('telegram.receipt.paymentType', lang, name=payment_type_name)}"])

    amount_text = format_number(amount)
    if currency_name:
        amount_text = f"{amount_text} {currency_name}"
    message_parts.append(f"💵 {t('telegram.receipt.amount', lang, amount=amount_text)}")

    if exchange_rate != 1.0:
        message_parts.append(
            f"📊 {t('telegram.receipt.exchangeRate', lang, rate=format_number(exchange_rate, 4))}"
        )

    description = document.get("description")
    if description:
        message_parts.append(f"📝 {t('telegram.receipt.note', lang, text=description)}")

    return "\n".join(message_parts)


def format_inout_receipt(
    document: dict[str, Any],
    operations: list[dict[str, Any]],
    warehouse_name: str | None = None,
    *,
    is_cancelled: bool = False,
    lang: str = "ru",
) -> str:
    doc_code = document.get("code", "N/A")
    formatted_date = _format_date(document.get("date", ""))
    inout_kind = parse_inout_type(document)
    if inout_kind == "income":
        title_key = "telegram.receipt.inoutIncome"
    elif inout_kind == "outcome":
        title_key = "telegram.receipt.inoutOutcome"
    else:
        title_key = "telegram.receipt.inoutUnknown"

    message_parts: list[str] = []
    if is_cancelled:
        message_parts.extend([f"❌ *{t('telegram.receipt.cancelled', lang)}*", ""])

    message_parts.extend(
        [
            f"📋 *{t(title_key, lang)}*",
            f"📄 *{t('telegram.receipt.documentNo', lang, code=doc_code)}*",
            f"📅 {t('telegram.receipt.date', lang, date=formatted_date)}",
        ]
    )

    warehouse = warehouse_name or t("telegram.receipt.warehouseDefault", lang)
    message_parts.append(f"🏢 {t('telegram.receipt.warehouse', lang, name=warehouse)}")
    _append_attached_user(message_parts, document, lang)

    message_parts.extend(["", f"📦 *{t('telegram.receipt.items', lang)}*", ""])

    total_items = 0.0
    for idx, operation in enumerate(operations, 1):
        item_name = _item_name(operation.get("item"), lang)
        quantity = float(operation.get("quantity", 0))
        total_items += quantity
        description = operation.get("description", "")

        message_parts.append(f"{idx}. *{item_name}*")
        message_parts.append(f"   {format_number(quantity)}")
        if description:
            message_parts.append(f"   {t('telegram.receipt.note', lang, text=description)}")
        message_parts.append("")

    message_parts.extend(
        ["─" * 20, f"📊 {t('telegram.receipt.totalItems', lang, count=format_number(total_items))}"]
    )
    return "\n".join(message_parts)


def format_movement_receipt(
    document: dict[str, Any],
    operations: list[dict[str, Any]],
    *,
    is_cancelled: bool = False,
    lang: str = "ru",
) -> str:
    doc_code = document.get("code", "N/A")
    formatted_date = _format_date(document.get("date", ""))

    sender = document.get("stock_sender", {})
    receiver = document.get("stock_receiver", {})
    warehouse_default = t("telegram.receipt.warehouseDefault", lang)
    sender_name = sender.get("name", warehouse_default) if isinstance(sender, dict) else warehouse_default
    receiver_name = (
        receiver.get("name", warehouse_default) if isinstance(receiver, dict) else warehouse_default
    )

    message_parts: list[str] = []
    if is_cancelled:
        message_parts.extend([f"❌ *{t('telegram.receipt.cancelled', lang)}*", ""])

    message_parts.extend(
        [
            f"🚚 *{t('telegram.receipt.movement', lang)}*",
            f"📄 *{t('telegram.receipt.documentNo', lang, code=doc_code)}*",
            f"📅 {t('telegram.receipt.date', lang, date=formatted_date)}",
            f"🏢 {sender_name} → {receiver_name}",
        ]
    )
    _append_attached_user(message_parts, document, lang)
    message_parts.extend(
        [
            "",
            f"📦 *{t('telegram.receipt.items', lang)}*",
            "",
        ]
    )

    total_items = 0.0
    total_to_pay = 0.0

    for idx, operation in enumerate(operations, 1):
        item_name = _item_name(operation.get("item"), lang)
        quantity = float(operation.get("quantity", 0))
        price = float(operation.get("price", 0))
        description = operation.get("description", "")
        item_total = quantity * price
        total_items += quantity
        total_to_pay += item_total

        message_parts.append(f"{idx}. *{item_name}*")
        message_parts.append(
            f"   {format_number(quantity)} × {format_number(price)} = {format_number(item_total)}"
        )
        if description:
            message_parts.append(f"   {t('telegram.receipt.note', lang, text=description)}")
        message_parts.append("")

    message_parts.extend(
        [
            "─" * 20,
            f"📊 {t('telegram.receipt.totalItems', lang, count=format_number(total_items))}",
            f"💵 *{t('telegram.receipt.total', lang, amount=format_number(total_to_pay))}*",
        ]
    )
    return "\n".join(message_parts)
