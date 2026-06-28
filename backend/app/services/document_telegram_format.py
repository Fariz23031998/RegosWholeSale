from datetime import datetime
import re
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


def _user_full_name(user: Any) -> str | None:
    if not isinstance(user, dict):
        return None
    full_name = user.get("full_name")
    if isinstance(full_name, str) and full_name.strip():
        return full_name.strip()
    parts = [
        part
        for part in (user.get("first_name"), user.get("last_name"))
        if isinstance(part, str) and part.strip()
    ]
    if parts:
        return " ".join(parts)
    return None


def _cheque_customer_name(cheque: dict[str, Any]) -> str | None:
    card = cheque.get("card")
    if not isinstance(card, dict):
        return None
    customer = card.get("customer")
    if not isinstance(customer, dict):
        return None
    return _user_full_name(customer)


def _escape_html(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _html_bold(text: str) -> str:
    return f"<b>{_escape_html(text)}</b>"


def _html_text(text: str, *, strikethrough: bool = False) -> str:
    escaped = _escape_html(text)
    if strikethrough:
        return f"<s>{escaped}</s>"
    return escaped


def _payment_type_name(payment: dict[str, Any], lang: str) -> str:
    payment_type = payment.get("type")
    if isinstance(payment_type, dict):
        name = payment_type.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return t("telegram.receipt.unknownPaymentType", lang)


def _append_pos_cheque_payments(
    message_parts: list[str],
    payments: list[dict[str, Any]],
    lang: str,
) -> None:
    visible_payments = [
        payment for payment in payments if float(payment.get("value", 0)) >= 0
    ]
    if not visible_payments:
        return

    message_parts.extend(["", f"💳 {_html_bold(t('telegram.receipt.posPayments', lang))}", ""])

    total_paid = 0.0
    for idx, payment in enumerate(visible_payments, 1):
        type_name = _payment_type_name(payment, lang)
        value = float(payment.get("value", 0))
        has_storno = bool(payment.get("has_storno"))
        if not has_storno:
            total_paid += value

        line = t(
            "telegram.receipt.posPaymentLine",
            lang,
            type=type_name,
            amount=format_number(value),
        )
        message_parts.append(_html_text(f"{idx}. {line}", strikethrough=has_storno))

    message_parts.append(
        f"💵 {_html_bold(t('telegram.receipt.posPaymentsTotal', lang, amount=format_number(total_paid)))}"
    )


def _visible_pos_cheque_operations(
    operations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [
        operation
        for operation in operations
        if float(operation.get("quantity", 0)) >= 0
    ]


_UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _looks_like_uuid(value: str) -> bool:
    return bool(_UUID_PATTERN.match(value.strip()))


def _pos_session_code(cheque: dict[str, Any]) -> str:
    session_code = cheque.get("session_code")
    if isinstance(session_code, str):
        text = session_code.strip()
        if text and not _looks_like_uuid(text):
            return text

    session = cheque.get("session")
    if isinstance(session, dict):
        code = session.get("code")
        if isinstance(code, str):
            text = code.strip()
            if text and not _looks_like_uuid(text):
                return text
    return ""


def format_pos_cheque_notification(
    cheque: dict[str, Any],
    operations: list[dict[str, Any]] | None,
    payments: list[dict[str, Any]] | None = None,
    *,
    variant: str,
    lang: str = "ru",
) -> str:
    doc_code = cheque.get("code", "N/A")
    formatted_date = _format_date(cheque.get("date", ""))
    session_code = _pos_session_code(cheque)
    is_return = bool(cheque.get("is_return"))

    if variant == "canceled":
        title_key = "telegram.receipt.posChequeCanceled"
    elif variant == "pay_debt":
        title_key = "telegram.receipt.posChequePayDebt"
    elif is_return:
        title_key = "telegram.receipt.posChequeReturn"
    else:
        title_key = "telegram.receipt.posChequeClosed"

    message_parts: list[str] = []
    if variant == "canceled":
        message_parts.extend([f"❌ {_html_bold(t('telegram.receipt.cancelled', lang))}", ""])

    message_parts.extend(
        [
            f"🧾 {_html_bold(t(title_key, lang))}",
            f"📄 {_html_bold(t('telegram.receipt.documentNo', lang, code=doc_code))}",
            f"📅 {_escape_html(t('telegram.receipt.date', lang, date=formatted_date))}",
        ]
    )

    if session_code:
        message_parts.append(
            f"🕐 {_escape_html(t('telegram.receipt.posSessionCode', lang, code=session_code))}"
        )

    cashier_name = _user_full_name(cheque.get("cashier"))
    if cashier_name:
        message_parts.append(
            f"🧑‍💼 {_escape_html(t('telegram.receipt.posCashier', lang, name=cashier_name))}"
        )

    seller_name = _user_full_name(cheque.get("seller"))
    if seller_name and seller_name != cashier_name:
        message_parts.append(
            f"🛒 {_escape_html(t('telegram.receipt.posSeller', lang, name=seller_name))}"
        )

    customer_name = _cheque_customer_name(cheque)
    if customer_name:
        message_parts.append(
            f"👤 {_escape_html(t('telegram.receipt.posCustomer', lang, name=customer_name))}"
        )

    if variant == "pay_debt":
        payments_amount = cheque.get("payments_amount", 0)
        message_parts.append(
            f"💵 {_html_bold(t('telegram.receipt.posDebtPaid', lang, amount=format_number(payments_amount)))}"
        )
        _append_pos_cheque_payments(message_parts, payments or [], lang)
    elif operations:
        visible_operations = _visible_pos_cheque_operations(operations)
        message_parts.extend(["", f"📦 {_html_bold(t('telegram.receipt.items', lang))}", ""])

        total_items = 0.0
        total_to_pay = 0.0

        for idx, operation in enumerate(visible_operations, 1):
            item_name = _item_name(operation.get("item"), lang)
            quantity = float(operation.get("quantity", 0))
            price = float(operation.get("price", 0))
            has_storno = bool(operation.get("has_storno"))
            item_total = quantity * price
            if not has_storno:
                total_items += quantity
                total_to_pay += item_total

            item_line = f"{idx}. {item_name}"
            qty_line = (
                f"   {format_number(quantity)} × {format_number(price)} = "
                f"{format_number(item_total)}"
            )
            message_parts.append(_html_text(item_line, strikethrough=has_storno))
            message_parts.append(_html_text(qty_line, strikethrough=has_storno))
            message_parts.append("")

        message_parts.extend(
            [
                "─" * 20,
                f"📊 {_escape_html(t('telegram.receipt.totalItems', lang, count=format_number(total_items)))}",
                f"💵 {_html_bold(t('telegram.receipt.totalToPay', lang, amount=format_number(total_to_pay)))}",
            ]
        )
        _append_pos_cheque_payments(message_parts, payments or [], lang)
    else:
        amount = cheque.get("amount", 0)
        message_parts.append(
            f"💵 {_html_bold(t('telegram.receipt.total', lang, amount=format_number(amount)))}"
        )
        _append_pos_cheque_payments(message_parts, payments or [], lang)

    return "\n".join(message_parts)


def _append_pos_session_totals(
    message_parts: list[str],
    totals: Any,
    lang: str,
) -> None:
    message_parts.extend(
        [
            "",
            "─" * 20,
            f"📊 *{t('telegram.receipt.posSessionTotalsTitle', lang)}*",
            f"💵 {t('telegram.receipt.posSessionSalesAmount', lang, amount=format_number(totals.sales_amount))}",
            f"💳 {t('telegram.receipt.posSessionSalesPayments', lang, amount=format_number(totals.sales_payments))}",
            f"↩️ {t('telegram.receipt.posSessionRefundAmount', lang, amount=format_number(totals.refund_amount))}",
            f"💸 {t('telegram.receipt.posSessionRefundPayments', lang, amount=format_number(totals.refund_payments))}",
            f"📈 *{t('telegram.receipt.posSessionNetSales', lang, amount=format_number(totals.net_sales))}*",
            f"📉 *{t('telegram.receipt.posSessionNetPayments', lang, amount=format_number(totals.net_payments))}*",
        ]
    )

    if totals.by_payment_type:
        message_parts.extend(
            [
                "",
                f"💳 *{t('telegram.receipt.posSessionByPaymentType', lang)}*",
            ]
        )
        for type_name in sorted(totals.by_payment_type):
            type_totals = totals.by_payment_type[type_name]
            message_parts.append(
                t(
                    "telegram.receipt.posSessionPaymentTypeLine",
                    lang,
                    type=type_name,
                    sales=format_number(type_totals.sales),
                    refunds=format_number(type_totals.refunds),
                    net=format_number(type_totals.net),
                )
            )


def format_pos_session_notification(
    cash_session: dict[str, Any],
    *,
    variant: str,
    lang: str = "ru",
    totals: Any | None = None,
) -> str:
    doc_code = cash_session.get("code", "N/A")
    title_key = (
        "telegram.receipt.posSessionOpened"
        if variant == "opened"
        else "telegram.receipt.posSessionClosed"
    )

    message_parts = [
        f"🏪 *{t(title_key, lang)}*",
        f"📄 *{t('telegram.receipt.documentNo', lang, code=doc_code)}*",
    ]

    operating_cash_id = cash_session.get("operating_cash_id")
    if operating_cash_id is not None:
        message_parts.append(
            f"💰 {t('telegram.receipt.posOperatingCash', lang, id=operating_cash_id)}"
        )

    start_date = cash_session.get("start_date")
    if start_date:
        message_parts.append(
            f"📅 {t('telegram.receipt.posSessionOpenDate', lang, date=_format_date(start_date))}"
        )

    start_user_name = _user_full_name(cash_session.get("start_user"))
    if start_user_name:
        message_parts.append(
            f"🧑‍💼 {t('telegram.receipt.posSessionOpenedBy', lang, name=start_user_name)}"
        )

    start_amount = cash_session.get("start_amount")
    if start_amount is not None:
        message_parts.append(
            f"💵 {t('telegram.receipt.posSessionStartAmount', lang, amount=format_number(start_amount))}"
        )

    if variant == "closed":
        close_date = cash_session.get("close_date")
        if close_date:
            message_parts.append(
                f"📅 {t('telegram.receipt.posSessionCloseDate', lang, date=_format_date(close_date))}"
            )

        close_user_name = _user_full_name(cash_session.get("close_user"))
        if close_user_name:
            message_parts.append(
                f"🧑‍💼 {t('telegram.receipt.posSessionClosedBy', lang, name=close_user_name)}"
            )

        close_amount = cash_session.get("close_amount")
        if close_amount is not None:
            message_parts.append(
                f"💵 *{t('telegram.receipt.posSessionCloseAmount', lang, amount=format_number(close_amount))}*"
            )

        if totals is not None:
            _append_pos_session_totals(message_parts, totals, lang)

    return "\n".join(message_parts)


def format_out_of_stock_notification(
    product_name: str,
    warehouse_name: str,
    *,
    allowed: float,
    min_quantity: float,
    code: str = "",
    barcode: str = "",
    last_purchase_cost: float | None = None,
    price: float | None = None,
    lang: str = "ru",
) -> str:
    cost_text = format_number(last_purchase_cost) if last_purchase_cost is not None else "—"
    price_text = format_number(price) if price is not None else "—"
    message_parts = [
        f"⚠️ *{t('telegram.outOfStock.title', lang)}*",
        "",
        f"📦 *{product_name}*",
    ]
    if code:
        message_parts.append(f"🔢 {t('telegram.outOfStock.code', lang, code=code)}")
    if barcode:
        message_parts.append(f"🏷 {t('telegram.outOfStock.barcode', lang, barcode=barcode)}")
    message_parts.extend(
        [
            f"🏢 {t('telegram.receipt.warehouse', lang, name=warehouse_name)}",
            f"💰 {t('telegram.outOfStock.costAndPrice', lang, cost=cost_text, price=price_text)}",
            f"📊 {t('telegram.outOfStock.currentQty', lang, qty=format_number(allowed))}",
            f"📉 {t('telegram.outOfStock.minQty', lang, qty=format_number(min_quantity))}",
        ]
    )
    return "\n".join(message_parts)
