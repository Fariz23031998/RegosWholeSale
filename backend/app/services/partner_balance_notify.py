"""Scheduled partner-balance Telegram notifications.

Mirrors the RegosPartnerBot send_partner_balance job: at the company's clock
time, linked partners are messaged only when a firm/currency closing balance
is positive on the company side. The text shows that amount with a leading
minus, and the Excel file uses the partner's sign convention.
"""

from __future__ import annotations

import asyncio
import io
import logging
import re
from collections import defaultdict
from datetime import datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PartnerTelegramAccount, PartnerTelegramBot, PartnerTelegramLinkState
from app.services.partner_telegram import PARTNER_LANGUAGES, _subscription_allows
from app.services.regos_partner_balance import get_partner_balance
from app.services.telegram_i18n import t
from app.services import telegram as telegram_service
from app.utils.number_format import format_number

logger = logging.getLogger("regos.backend")

TASHKENT_TZ = ZoneInfo("Asia/Tashkent")
BALANCE_START_DATE = 946684800
CATCH_UP = timedelta(minutes=45)
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_SHEET_INVALID = re.compile(r"[:\\/?*\[\]]")

_HEADER_FONT = Font(bold=True, size=12, color="FFFFFF")
_HEADER_FILL = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
_TITLE_FONT = Font(bold=True, size=14)
_BOLD_FONT = Font(bold=True)
_TOTAL_FONT = Font(bold=True, size=11, color="008000")
_CURRENCY_FONT = Font(bold=True, size=13, color="0000FF")
_FIRM_FONT = Font(bold=True, size=12)
_THIN = Side(style="thin")
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
_FIRM_FILL = PatternFill(start_color="E7F4E4", end_color="E7F4E4", fill_type="solid")
_CURRENCY_FILL = PatternFill(start_color="D0E8F2", end_color="D0E8F2", fill_type="solid")
_NUMBER_FORMAT = "#,##0.00"


def _as_tashkent(now: datetime) -> datetime:
    if now.tzinfo is None:
        return now.replace(tzinfo=TASHKENT_TZ)
    return now.astimezone(TASHKENT_TZ)


def _parse_clock(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    match = _TIME_RE.fullmatch(value.strip())
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def _day_set(days: list[int] | None) -> set[int]:
    result: set[int] = set()
    for day in days or []:
        if isinstance(day, bool):
            continue
        try:
            result.add(int(day))
        except (TypeError, ValueError):
            continue
    return result


def due_balance_slot(
    *,
    enabled: bool,
    option: str,
    days: list[int] | None,
    time_hhmm: str,
    last_slot: str | None,
    now: datetime,
) -> str | None:
    """Return today's slot key when the schedule should fire, otherwise None.

    The slot is due from the scheduled minute through the following 45 minutes.
    """
    if not enabled:
        return None
    current = _as_tashkent(now)
    selected = _day_set(days)
    if option == "weekdays" and current.weekday() not in selected:
        return None
    if option == "monthly" and current.day not in selected:
        return None
    if option not in {"daily", "weekdays", "monthly"}:
        return None
    clock = _parse_clock(time_hhmm)
    if clock is None:
        return None
    scheduled = datetime.combine(current.date(), time(*clock), tzinfo=TASHKENT_TZ)
    if current < scheduled or current - scheduled > CATCH_UP:
        return None
    slot = scheduled.strftime("%Y-%m-%dT%H:%M")
    if last_slot == slot:
        return None
    return slot


def end_of_local_day_unix(now: datetime) -> int:
    current = _as_tashkent(now)
    end = datetime.combine(current.date(), time.max, tzinfo=TASHKENT_TZ)
    return int(end.timestamp())


def _reference_name(value: Any, fallback: str) -> str:
    if isinstance(value, dict):
        name = value.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return fallback


def _reference_id(value: Any) -> int:
    if isinstance(value, dict) and isinstance(value.get("id"), int) and not isinstance(value.get("id"), bool):
        return int(value["id"])
    return 0


def _row_sort_key(row: dict[str, Any]) -> tuple[int, int]:
    date = row.get("date")
    row_id = row.get("id")
    return (
        date if isinstance(date, int) else 0,
        row_id if isinstance(row_id, int) and not isinstance(row_id, bool) else 0,
    )


def positive_company_balances(rows: list[dict[str, Any]]) -> list[tuple[str, str, float]]:
    """Latest company-side closing balance per firm and currency, when it is above zero."""
    latest: dict[tuple[int, int], dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = (_reference_id(row.get("firm")), _reference_id(row.get("currency")))
        current = latest.get(key)
        if current is None or _row_sort_key(row) >= _row_sort_key(current):
            latest[key] = row

    debts: list[tuple[str, str, float]] = []
    for (firm_id, currency_id), row in latest.items():
        amount = _amount(row.get("end_amount"))
        if amount <= 0:
            continue
        firm_name = _reference_name(row.get("firm"), f"Firm {firm_id}" if firm_id else "Unknown")
        currency_name = _reference_name(
            row.get("currency"),
            f"Currency {currency_id}" if currency_id else "Unknown",
        )
        debts.append((firm_name, currency_name, amount))
    debts.sort(key=lambda item: (item[0].lower(), item[1].lower()))
    return debts


def format_balance_lines(balances: list[tuple[str, str, float]]) -> str:
    return "\n".join(
        f"🏢 {firm_name} ({currency_name}): -{format_number(amount)}"
        for firm_name, currency_name, amount in balances
    )


def format_balance_notification(
    partner_id: int,
    balances: list[tuple[str, str, float]],
    lang: str,
    template: str | None = None,
) -> str:
    balance_text = format_balance_lines(balances)
    custom = template.strip() if isinstance(template, str) else ""
    if custom:
        return custom.replace("{{partner_id}}", str(partner_id)).replace("{{balances}}", balance_text)
    lines = [
        t("partnerTelegram.balance.notifyTitle", lang),
        "",
        f"{t('partnerTelegram.balance.partnerId', lang)}: {partner_id}",
        "",
        t("partnerTelegram.balance.negative", lang),
        "",
        balance_text,
        "",
        t("partnerTelegram.balance.attached", lang),
    ]
    return "\n".join(lines)


def _amount(value: Any) -> float:
    if isinstance(value, bool) or value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _partner_language(language_code: str | None) -> str:
    if language_code in PARTNER_LANGUAGES:
        return language_code
    return "ru"


def _document_type_name(row: dict[str, Any], lang: str) -> str:
    document_type = row.get("document_type")
    raw_name = None
    document_type_id = 0
    if isinstance(document_type, dict):
        raw_name = document_type.get("name") if isinstance(document_type.get("name"), str) else None
        if isinstance(document_type.get("id"), int) and not isinstance(document_type.get("id"), bool):
            document_type_id = int(document_type["id"])
    if document_type_id > 0:
        key = f"partnerTelegram.balance.documentType.{document_type_id}"
        translated = t(key, lang)
        if translated != key:
            return translated
    if isinstance(raw_name, str) and raw_name.strip():
        return raw_name.strip()
    return t("partnerTelegram.balance.excel.unknown", lang)


def _format_entry_date(value: Any) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return datetime.fromtimestamp(value, tz=TASHKENT_TZ).strftime("%d.%m.%Y %H:%M")
    return str(value) if value is not None else ""


def _sheet_title(name: str, used: set[str]) -> str:
    cleaned = _SHEET_INVALID.sub(" ", name).strip() or "Currency"
    base = cleaned[:31]
    candidate = base
    number = 2
    while candidate in used:
        suffix = f" {number}"
        candidate = f"{base[: 31 - len(suffix)]}{suffix}"
        number += 1
    used.add(candidate)
    return candidate


def _write_number(cell, value: float | None, *, font: Font, fill: PatternFill | None = None) -> None:
    if value is None:
        cell.value = "—"
    else:
        cell.value = value
        cell.number_format = _NUMBER_FORMAT
    cell.font = font
    cell.border = _BORDER
    cell.alignment = Alignment(horizontal="right")
    if fill is not None:
        cell.fill = fill


def build_partner_balance_excel(rows: list[dict[str, Any]], lang: str) -> bytes:
    entries = [row for row in rows if isinstance(row, dict)]
    if not entries:
        raise ValueError("No balance data to export")

    grouped: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for entry in entries:
        currency_name = _reference_name(entry.get("currency"), "Unknown")
        firm_name = _reference_name(entry.get("firm"), "Unknown")
        grouped[currency_name][firm_name].append(entry)

    workbook = Workbook()
    default_sheet = workbook.active
    workbook.remove(default_sheet)
    used_titles: set[str] = set()

    headers = [
        t("partnerTelegram.balance.excel.date", lang),
        t("partnerTelegram.balance.excel.document", lang),
        t("partnerTelegram.balance.excel.documentType", lang),
        t("partnerTelegram.balance.excel.start", lang),
        t("partnerTelegram.balance.excel.debit", lang),
        t("partnerTelegram.balance.excel.credit", lang),
        t("partnerTelegram.balance.excel.remainder", lang),
        t("partnerTelegram.balance.excel.rate", lang),
    ]

    for currency_name, firms in grouped.items():
        worksheet = workbook.create_sheet(title=_sheet_title(currency_name, used_titles))
        row_index = 1
        worksheet.merge_cells(start_row=row_index, start_column=1, end_row=row_index, end_column=8)
        title = worksheet.cell(row_index, 1)
        title.value = f"💱 {t('partnerTelegram.balance.excel.currency', lang)}: {currency_name}"
        title.font = _TITLE_FONT
        title.alignment = Alignment(horizontal="center")
        row_index += 2

        currency_start = 0.0
        currency_debit = 0.0
        currency_credit = 0.0
        currency_remainder = 0.0

        for firm_name, firm_entries in firms.items():
            firm_entries.sort(key=_row_sort_key)
            worksheet.merge_cells(start_row=row_index, start_column=1, end_row=row_index, end_column=8)
            firm_cell = worksheet.cell(row_index, 1)
            firm_cell.value = f"🏢 {t('partnerTelegram.balance.excel.firm', lang)}: {firm_name}"
            firm_cell.font = _FIRM_FONT
            row_index += 1

            for column, header in enumerate(headers, start=1):
                cell = worksheet.cell(row_index, column, header)
                cell.font = _HEADER_FONT
                cell.fill = _HEADER_FILL
                cell.alignment = Alignment(horizontal="center", vertical="center")
                cell.border = _BORDER
            row_index += 1

            firm_start = _amount(firm_entries[0].get("start_amount"))
            firm_debit = 0.0
            firm_credit = 0.0
            for entry in firm_entries:
                start_amount = _amount(entry.get("start_amount"))
                debit = _amount(entry.get("debit"))
                credit = _amount(entry.get("credit"))
                remainder = start_amount + debit - credit
                rate = entry.get("exchange_rate")
                rate_value = _amount(rate) if rate not in (None, 1, 1.0) else None
                document_code = entry.get("document_code")
                values: list[Any] = [
                    _format_entry_date(entry.get("date")),
                    document_code if isinstance(document_code, str) and document_code else "—",
                    _document_type_name(entry, lang),
                    -start_amount,
                    credit if credit != 0 else None,
                    -debit if debit != 0 else None,
                    -remainder,
                    rate_value,
                ]
                for column, value in enumerate(values, start=1):
                    cell = worksheet.cell(row_index, column)
                    if isinstance(value, (int, float)) and not isinstance(value, bool):
                        cell.value = value
                        cell.number_format = _NUMBER_FORMAT
                    elif value is None:
                        cell.value = "—"
                    else:
                        cell.value = value
                    cell.border = _BORDER
                    cell.alignment = Alignment(horizontal="left" if column <= 3 else "right")
                firm_debit += debit
                firm_credit += credit
                row_index += 1

            last = firm_entries[-1]
            firm_remainder = (
                _amount(last.get("start_amount")) + _amount(last.get("debit")) - _amount(last.get("credit"))
            )
            row_index += 1
            worksheet.merge_cells(start_row=row_index, start_column=1, end_row=row_index, end_column=3)
            label = worksheet.cell(row_index, 1)
            label.value = f"{t('partnerTelegram.balance.excel.total', lang)} ({firm_name}):"
            label.font = _BOLD_FONT
            label.border = _BORDER
            label.alignment = Alignment(horizontal="right")
            _write_number(worksheet.cell(row_index, 4), -firm_start, font=_BOLD_FONT)
            _write_number(
                worksheet.cell(row_index, 5),
                firm_credit if firm_credit != 0 else None,
                font=_BOLD_FONT,
            )
            _write_number(
                worksheet.cell(row_index, 6),
                -firm_debit if firm_debit != 0 else None,
                font=_BOLD_FONT,
            )
            _write_number(worksheet.cell(row_index, 7), -firm_remainder, font=_TOTAL_FONT, fill=_FIRM_FILL)
            worksheet.cell(row_index, 8).border = _BORDER
            row_index += 2

            currency_start += firm_start
            currency_debit += firm_debit
            currency_credit += firm_credit
            currency_remainder += firm_remainder

        row_index += 1
        worksheet.merge_cells(start_row=row_index, start_column=1, end_row=row_index, end_column=3)
        currency_label = worksheet.cell(row_index, 1)
        currency_label.value = f"{t('partnerTelegram.balance.excel.total', lang)} ({currency_name}):"
        currency_label.font = _CURRENCY_FONT
        currency_label.border = _BORDER
        currency_label.alignment = Alignment(horizontal="right")
        currency_label.fill = _CURRENCY_FILL
        _write_number(worksheet.cell(row_index, 4), -currency_start, font=_CURRENCY_FONT, fill=_CURRENCY_FILL)
        _write_number(
            worksheet.cell(row_index, 5),
            currency_credit if currency_credit != 0 else None,
            font=_CURRENCY_FONT,
            fill=_CURRENCY_FILL,
        )
        _write_number(
            worksheet.cell(row_index, 6),
            -currency_debit if currency_debit != 0 else None,
            font=_CURRENCY_FONT,
            fill=_CURRENCY_FILL,
        )
        _write_number(
            worksheet.cell(row_index, 7),
            -currency_remainder,
            font=_CURRENCY_FONT,
            fill=_CURRENCY_FILL,
        )
        worksheet.cell(row_index, 8).border = _BORDER
        worksheet.cell(row_index, 8).fill = _CURRENCY_FILL
        for index, width in enumerate([18, 15, 30, 18, 15, 15, 18, 12], start=1):
            worksheet.column_dimensions[get_column_letter(index)].width = width

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def balance_excel_filename(partner_id: int, now: datetime) -> str:
    stamp = _as_tashkent(now).strftime("%Y%m%d_%H%M%S")
    return f"partner_balance_{partner_id}_{stamp}.xlsx"


async def notify_due_partner_balances(
    session: AsyncSession,
    *,
    now: datetime | None = None,
) -> int:
    current = _as_tashkent(now or datetime.now(TASHKENT_TZ))
    result = await session.execute(
        select(PartnerTelegramBot).where(PartnerTelegramBot.balance_notify_enabled.is_(True))
    )
    bots = list(result.scalars().all())
    sent = 0
    for bot in bots:
        slot = due_balance_slot(
            enabled=True,
            option=bot.balance_notify_option,
            days=bot.balance_notify_days,
            time_hhmm=bot.balance_notify_time,
            last_slot=bot.balance_notify_last_slot,
            now=current,
        )
        if slot is None:
            continue
        if not await _subscription_allows(session, bot.company_id):
            await session.commit()
            continue
        bot.balance_notify_last_slot = slot
        await session.commit()
        sent += await _send_company_balances(session, bot, now=current)
    return sent


async def _send_company_balances(
    session: AsyncSession,
    bot: PartnerTelegramBot,
    *,
    now: datetime,
) -> int:
    result = await session.execute(
        select(PartnerTelegramAccount)
        .where(
            PartnerTelegramAccount.bot_id == bot.id,
            PartnerTelegramAccount.link_state == PartnerTelegramLinkState.linked.value,
            PartnerTelegramAccount.regos_partner_id.is_not(None),
        )
        .order_by(PartnerTelegramAccount.id)
    )
    accounts = list(result.scalars().all())
    grouped: dict[int, list[PartnerTelegramAccount]] = {}
    for account in accounts:
        if account.regos_partner_id is None:
            continue
        grouped.setdefault(int(account.regos_partner_id), []).append(account)
    if not grouped:
        logger.info("No linked partners for company %s balance notification", bot.company_id)
        return 0

    end_date = end_of_local_day_unix(now)
    sent = 0
    delivered = False
    for partner_id, partner_accounts in grouped.items():
        try:
            payload = await get_partner_balance(
                session,
                bot.company_id,
                partner_id=partner_id,
                start_date=BALANCE_START_DATE,
                end_date=end_date,
            )
        except Exception:
            logger.error(
                "Failed to load balance for partner %s in company %s",
                partner_id,
                bot.company_id,
                exc_info=True,
            )
            continue
        rows = payload.get("rows") if isinstance(payload, dict) else None
        balance_rows = rows if isinstance(rows, list) else []
        debts = positive_company_balances(balance_rows)
        if not debts:
            logger.info("Partner %s has no negative balance, skipping notification", partner_id)
            continue

        messages: dict[str, str] = {}
        files: dict[str, bytes] = {}
        for account in partner_accounts:
            if delivered:
                await session.commit()
                await asyncio.sleep(1)
            delivered = True
            lang = _partner_language(account.language_code)
            if lang not in messages:
                templates = bot.balance_notify_templates if isinstance(bot.balance_notify_templates, dict) else {}
                raw_template = templates.get(lang, "")
                template = raw_template if isinstance(raw_template, str) else ""
                messages[lang] = format_balance_notification(partner_id, debts, lang, template)
                files[lang] = build_partner_balance_excel(balance_rows, lang)
            text_ok = await telegram_service.send_message(
                bot.bot_token,
                account.chat_id,
                messages[lang],
                parse_mode="",
            )
            file_ok = await telegram_service.send_document(
                bot.bot_token,
                account.chat_id,
                files[lang],
                balance_excel_filename(partner_id, now),
                caption=f"{t('partnerTelegram.balance.caption', lang)} (ID: {partner_id})",
            )
            if text_ok or file_ok:
                sent += 1
            else:
                logger.warning(
                    "Failed to send balance to partner %s chat %s",
                    partner_id,
                    account.chat_id,
                )
    return sent
