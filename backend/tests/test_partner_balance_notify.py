from datetime import UTC, datetime, timedelta
from io import BytesIO
from zoneinfo import ZoneInfo

import pytest
from openpyxl import load_workbook
from sqlalchemy import select

from app.models import Company, PartnerTelegramAccount, PartnerTelegramBot, PartnerTelegramLinkState
from app.models.subscription import SubscriptionStatus
from app.services.partner_balance_notify import (
    build_partner_balance_excel,
    due_balance_slot,
    format_balance_notification,
    notify_due_partner_balances,
    positive_company_balances,
)

TASHKENT = ZoneInfo("Asia/Tashkent")
NOW = datetime(2026, 11, 9, 9, 10, tzinfo=TASHKENT)


def _due(**overrides):
    values = {
        "enabled": True,
        "option": "daily",
        "days": [],
        "time_hhmm": "09:00",
        "last_slot": None,
        "now": NOW,
    }
    values.update(overrides)
    return due_balance_slot(**values)


def test_daily_slot_is_due_inside_the_catch_up_window():
    assert _due() == "2026-11-09T09:00"
    assert _due(now=datetime(2026, 11, 9, 9, 45, tzinfo=TASHKENT)) == "2026-11-09T09:00"


def test_daily_slot_is_not_due_outside_the_window_or_when_claimed():
    assert _due(now=datetime(2026, 11, 9, 8, 59, tzinfo=TASHKENT)) is None
    assert _due(now=datetime(2026, 11, 9, 9, 46, tzinfo=TASHKENT)) is None
    assert _due(last_slot="2026-11-09T09:00") is None
    assert _due(enabled=False) is None


def test_weekday_and_month_day_filters():
    monday = datetime(2026, 11, 9, 9, 5, tzinfo=TASHKENT)
    assert _due(option="weekdays", days=[0], now=monday) == "2026-11-09T09:00"
    assert _due(option="weekdays", days=[1], now=monday) is None
    assert _due(option="monthly", days=[9], now=monday) == "2026-11-09T09:00"
    assert _due(option="monthly", days=[8], now=monday) is None


def _row(**overrides):
    row = {
        "id": 1,
        "date": 1_700_000_000,
        "document_code": "WS-1",
        "document_type": {"id": 1, "name": "Wholesale raw"},
        "firm": {"id": 4, "name": "Main"},
        "currency": {"id": 1, "name": "UZS"},
        "start_amount": 0,
        "debit": 1000,
        "credit": 0,
        "end_amount": 1000,
        "exchange_rate": 1,
    }
    row.update(overrides)
    return row


def test_only_a_positive_latest_balance_is_notified():
    assert positive_company_balances([_row(end_amount=0)]) == []
    assert positive_company_balances([_row(end_amount=-20, credit=20, debit=0)]) == []
    settled = [
        _row(id=1, date=1, end_amount=5000, debit=5000),
        _row(id=2, date=2, end_amount=-5, debit=0, credit=5),
    ]
    assert positive_company_balances(settled) == []
    debts = positive_company_balances([_row(end_amount=60000, debit=60000)])
    assert debts == [("Main", "UZS", 60000)]
    text = format_balance_notification(7, debts, "en", "   ")
    builtin = format_balance_notification(7, debts, "en")
    assert text == builtin
    assert "Partner ID: 7" in text
    assert "🏢 Main (UZS): -60 000" in text
    assert "Negative balance:" in text
    custom = format_balance_notification(
        7,
        [("Main", "UZS", 60000), ("Shop", "USD", 10)],
        "en",
        "Hello {{partner_name}} ({{partner_id}})\n{{balances}}\n---\n{{balances_positive}}",
        partner_name="Acme LLC",
    )
    assert custom == (
        "Hello Acme LLC (7)\n"
        "🏢 Main (UZS): -60 000\n🏢 Shop (USD): -10\n"
        "---\n"
        "🏢 Main (UZS): 60 000\n🏢 Shop (USD): 10"
    )


def test_excel_uses_the_partner_sign_convention():
    workbook = load_workbook(BytesIO(build_partner_balance_excel([_row()], "en")))
    sheet = workbook["UZS"]
    matched = False
    for row in sheet.iter_rows(min_row=1, max_col=8):
        if row[1].value != "WS-1":
            continue
        assert row[2].value == "Wholesale"
        assert row[4].value == "—"
        assert row[5].value == -1000
        assert row[6].value == -1000
        matched = True
    assert matched


def _company(name: str, slug: str, *, active: bool) -> Company:
    expires = datetime.now(UTC) + timedelta(days=10 if active else -1)
    return Company(
        name=name,
        slug=slug,
        settings={},
        subscription_status=SubscriptionStatus.trial,
        subscription_expires_at=expires,
    )


async def _instant_sleep(_seconds: float) -> None:
    return None


@pytest.mark.asyncio
async def test_due_schedule_sends_text_and_excel_once(session_factory, monkeypatch):
    async with session_factory() as session:
        company = _company("Balance Co", "balance-co", active=True)
        session.add(company)
        await session.flush()
        bot = PartnerTelegramBot(
            company_id=company.id,
            bot_token="999:BALANCE",
            webhook_secret="secret-balance",
            public_key="public-balance",
            balance_notify_enabled=True,
            balance_notify_time="09:00",
            balance_notify_option="daily",
            balance_notify_days=[],
        )
        session.add(bot)
        await session.flush()
        session.add_all(
            [
                PartnerTelegramAccount(
                    company_id=company.id,
                    bot_id=bot.id,
                    telegram_user_id=10,
                    chat_id=100,
                    language_code="en",
                    regos_partner_id=7,
                    link_state=PartnerTelegramLinkState.linked.value,
                ),
                PartnerTelegramAccount(
                    company_id=company.id,
                    bot_id=bot.id,
                    telegram_user_id=11,
                    chat_id=101,
                    language_code="uz",
                    regos_partner_id=7,
                    link_state=PartnerTelegramLinkState.linked.value,
                ),
                PartnerTelegramAccount(
                    company_id=company.id,
                    bot_id=bot.id,
                    telegram_user_id=12,
                    chat_id=102,
                    language_code="ru",
                    regos_partner_id=8,
                    link_state=PartnerTelegramLinkState.unlinked.value,
                ),
            ]
        )
        await session.commit()

    calls: list[int] = []
    messages: list[tuple[int, str]] = []
    documents: list[tuple[int, str, bytes]] = []

    async def fake_balance(session, company_id, *, partner_id, start_date, end_date, **kwargs):
        calls.append(partner_id)
        assert start_date == 946684800
        assert end_date > start_date
        return {"rows": [_row(end_amount=60000, debit=60000)]}

    async def fake_message(token, chat_id, text, parse_mode="Markdown", reply_markup=None):
        assert token == "999:BALANCE"
        assert parse_mode == ""
        messages.append((chat_id, text))
        return True

    async def fake_document(token, chat_id, file_bytes, filename, *, caption=None):
        documents.append((chat_id, filename, file_bytes))
        return True

    monkeypatch.setattr("app.services.partner_balance_notify.get_partner_balance", fake_balance)
    monkeypatch.setattr("app.services.partner_balance_notify.telegram_service.send_message", fake_message)
    monkeypatch.setattr("app.services.partner_balance_notify.telegram_service.send_document", fake_document)
    monkeypatch.setattr("app.services.partner_balance_notify.asyncio.sleep", _instant_sleep)

    async with session_factory() as session:
        sent = await notify_due_partner_balances(session, now=NOW)
        await session.commit()

    assert sent == 2
    assert calls == [7]
    assert [chat_id for chat_id, _text in messages] == [100, 101]
    assert "Partner ID: 7" in messages[0][1]
    assert "Hamkor ID: 7" in messages[1][1]
    assert documents[0][1].startswith("partner_balance_7_")
    workbook = load_workbook(BytesIO(documents[0][2]))
    assert "UZS" in workbook.sheetnames

    async with session_factory() as session:
        again = await notify_due_partner_balances(session, now=NOW)
    assert again == 0
    assert len(messages) == 2


@pytest.mark.asyncio
async def test_custom_templates_follow_account_language(session_factory, monkeypatch):
    async with session_factory() as session:
        company = _company("Template Co", "template-co", active=True)
        session.add(company)
        await session.flush()
        bot = PartnerTelegramBot(
            company_id=company.id,
            bot_token="999:TEMPLATE",
            webhook_secret="secret-template",
            public_key="public-template",
            balance_notify_enabled=True,
            balance_notify_time="09:00",
            balance_notify_option="daily",
            balance_notify_days=[],
            balance_notify_templates={
                "uz": "UZ {{partner_id}}\n{{balances}}",
                "ru": "",
                "en": "EN {{partner_id}}\n{{balances}}",
            },
        )
        session.add(bot)
        await session.flush()
        session.add_all(
            [
                PartnerTelegramAccount(
                    company_id=company.id,
                    bot_id=bot.id,
                    telegram_user_id=20,
                    chat_id=200,
                    language_code="en",
                    regos_partner_id=7,
                    link_state=PartnerTelegramLinkState.linked.value,
                ),
                PartnerTelegramAccount(
                    company_id=company.id,
                    bot_id=bot.id,
                    telegram_user_id=21,
                    chat_id=201,
                    language_code="uz",
                    regos_partner_id=7,
                    link_state=PartnerTelegramLinkState.linked.value,
                ),
            ]
        )
        await session.commit()

    messages: list[tuple[int, str]] = []

    async def fake_balance(session, company_id, *, partner_id, start_date, end_date, **kwargs):
        return {"rows": [_row(end_amount=60000, debit=60000)]}

    async def fake_message(token, chat_id, text, parse_mode="Markdown", reply_markup=None):
        messages.append((chat_id, text))
        return True

    async def fake_document(*args, **kwargs):
        return True

    monkeypatch.setattr("app.services.partner_balance_notify.get_partner_balance", fake_balance)
    monkeypatch.setattr("app.services.partner_balance_notify.telegram_service.send_message", fake_message)
    monkeypatch.setattr("app.services.partner_balance_notify.telegram_service.send_document", fake_document)
    monkeypatch.setattr("app.services.partner_balance_notify.asyncio.sleep", _instant_sleep)

    async with session_factory() as session:
        sent = await notify_due_partner_balances(session, now=NOW)

    assert sent == 2
    assert messages[0] == (200, "EN 7\n🏢 Main (UZS): -60 000")
    assert messages[1] == (201, "UZ 7\n🏢 Main (UZS): -60 000")


@pytest.mark.asyncio
async def test_inactive_subscription_does_not_send_or_claim(session_factory, monkeypatch):
    async with session_factory() as session:
        company = _company("Expired Co", "expired-co", active=False)
        session.add(company)
        await session.flush()
        session.add(
            PartnerTelegramBot(
                company_id=company.id,
                bot_token="999:EXPIRED",
                webhook_secret="secret-expired",
                public_key="public-expired",
                balance_notify_enabled=True,
                balance_notify_time="09:00",
                balance_notify_option="daily",
                balance_notify_days=[],
            )
        )
        await session.commit()

    async def fail_balance(*args, **kwargs):
        raise AssertionError("balance should not be loaded")

    monkeypatch.setattr("app.services.partner_balance_notify.get_partner_balance", fail_balance)

    async with session_factory() as session:
        sent = await notify_due_partner_balances(session, now=NOW)
        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        assert bot.balance_notify_last_slot is None
    assert sent == 0
