from datetime import datetime
from typing import Any

from app.utils.number_format import format_number


def _format_date(doc_date: Any) -> str:
    if isinstance(doc_date, (int, float)):
        try:
            return datetime.fromtimestamp(doc_date).strftime("%d.%m.%Y %H:%M")
        except (OSError, OverflowError, ValueError):
            return str(doc_date)
    return str(doc_date) if doc_date else ""


def format_partner_receipt(
    document: dict[str, Any],
    operations: list[dict[str, Any]],
    warehouse_name: str | None = None,
    *,
    is_cancelled: bool = False,
    is_return: bool = False,
    use_cost: bool = False,
) -> str:
    doc_code = document.get("code", "N/A")
    formatted_date = _format_date(document.get("date", ""))
    message_parts: list[str] = []

    if is_cancelled:
        message_parts.extend(["❌ *ОТМЕНЕНО*", ""])

    if is_return:
        receipt_type = "Чек возврата отгрузки" if use_cost else "Чек возврата закупки"
    elif use_cost:
        receipt_type = "Чек отгрузки"
    else:
        receipt_type = "Чек закупки"

    message_parts.extend(
        [
            f"🧾 *{receipt_type}*",
            f"📄 *Документ № {doc_code}*",
            f"📅 Дата: {formatted_date}",
        ]
    )

    if warehouse_name:
        message_parts.append(f"🏢 Склад: {warehouse_name}")

    message_parts.extend(["", "📦 *Товары*", ""])

    total_items = 0.0
    total_to_pay = 0.0

    for idx, operation in enumerate(operations, 1):
        item = operation.get("item", {})
        if isinstance(item, dict):
            item_name = item.get("name", "Неизвестный товар")
        else:
            item_name = str(item) if item else "Неизвестный товар"

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
            message_parts.append(f"   Примечание: {description}")
        message_parts.append("")

    message_parts.extend(
        [
            "─" * 20,
            f"📊 Всего товаров: {format_number(total_items)}",
            f"💵 *Итого к оплате: {format_number(total_to_pay)}*",
        ]
    )
    return "\n".join(message_parts)


def format_payment_notification(
    document: dict[str, Any],
    warehouse_name: str | None = None,
    *,
    is_cancelled: bool = False,
) -> str:
    doc_code = document.get("code", "N/A")
    formatted_date = _format_date(document.get("date", ""))
    amount = document.get("amount", 0)
    payment_type = document.get("type", {})
    payment_type_name = (
        payment_type.get("name", "Неизвестный тип")
        if isinstance(payment_type, dict)
        else "Неизвестный тип"
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
        message_parts.extend(["❌ *ОТМЕНЕНО*", ""])

    if category_positive:
        direction_text = "Выплачено"
        direction_emoji = "⬆️"
    else:
        direction_text = "Получено"
        direction_emoji = "⬇️"

    message_parts.extend(
        [
            f"{direction_emoji} *{direction_text}*",
            f"📄 *Документ № {doc_code}*",
            f"📅 Дата: {formatted_date}",
        ]
    )

    if warehouse_name:
        message_parts.append(f"🏢 Склад: {warehouse_name}")

    message_parts.extend(["", f"💳 Тип платежа: {payment_type_name}"])

    amount_line = f"💵 Сумма: {format_number(amount)}"
    if currency_name:
        amount_line += f" {currency_name}"
    message_parts.append(amount_line)

    if exchange_rate != 1.0:
        message_parts.append(f"📊 Курс обмена: {format_number(exchange_rate, 4)}")

    description = document.get("description")
    if description:
        message_parts.append(f"📝 Примечание: {description}")

    return "\n".join(message_parts)


def format_inout_receipt(
    document: dict[str, Any],
    operations: list[dict[str, Any]],
    warehouse_name: str | None = None,
    *,
    is_cancelled: bool = False,
) -> str:
    doc_code = document.get("code", "N/A")
    formatted_date = _format_date(document.get("date", ""))
    inout_type = document.get("inout_type", "")
    if inout_type == "Income":
        title = "Внесение"
    elif inout_type == "Outcome":
        title = "Списание"
    else:
        title = "Списание/внесение"

    message_parts: list[str] = []
    if is_cancelled:
        message_parts.extend(["❌ *ОТМЕНЕНО*", ""])

    message_parts.extend(
        [
            f"📋 *{title}*",
            f"📄 *Документ № {doc_code}*",
            f"📅 Дата: {formatted_date}",
        ]
    )

    if warehouse_name:
        message_parts.append(f"🏢 Склад: {warehouse_name}")

    message_parts.extend(["", "📦 *Товары*", ""])

    total_items = 0.0
    for idx, operation in enumerate(operations, 1):
        item = operation.get("item", {})
        if isinstance(item, dict):
            item_name = item.get("name", "Неизвестный товар")
        else:
            item_name = str(item) if item else "Неизвестный товар"

        quantity = float(operation.get("quantity", 0))
        total_items += quantity
        description = operation.get("description", "")

        message_parts.append(f"{idx}. *{item_name}*")
        message_parts.append(f"   {format_number(quantity)}")
        if description:
            message_parts.append(f"   Примечание: {description}")
        message_parts.append("")

    message_parts.extend(["─" * 20, f"📊 Всего товаров: {format_number(total_items)}"])
    return "\n".join(message_parts)


def format_movement_receipt(
    document: dict[str, Any],
    operations: list[dict[str, Any]],
    *,
    is_cancelled: bool = False,
) -> str:
    doc_code = document.get("code", "N/A")
    formatted_date = _format_date(document.get("date", ""))

    sender = document.get("stock_sender", {})
    receiver = document.get("stock_receiver", {})
    sender_name = sender.get("name", "Склад") if isinstance(sender, dict) else "Склад"
    receiver_name = receiver.get("name", "Склад") if isinstance(receiver, dict) else "Склад"

    message_parts: list[str] = []
    if is_cancelled:
        message_parts.extend(["❌ *ОТМЕНЕНО*", ""])

    message_parts.extend(
        [
            "🚚 *Перемещение*",
            f"📄 *Документ № {doc_code}*",
            f"📅 Дата: {formatted_date}",
            f"🏢 {sender_name} → {receiver_name}",
            "",
            "📦 *Товары*",
            "",
        ]
    )

    total_items = 0.0
    total_to_pay = 0.0

    for idx, operation in enumerate(operations, 1):
        item = operation.get("item", {})
        if isinstance(item, dict):
            item_name = item.get("name", "Неизвестный товар")
        else:
            item_name = str(item) if item else "Неизвестный товар"

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
            message_parts.append(f"   Примечание: {description}")
        message_parts.append("")

    message_parts.extend(
        [
            "─" * 20,
            f"📊 Всего товаров: {format_number(total_items)}",
            f"💵 *Итого: {format_number(total_to_pay)}*",
        ]
    )
    return "\n".join(message_parts)
