from datetime import UTC, datetime, timedelta
from io import BytesIO
from zoneinfo import ZoneInfo

import pytest
from openpyxl import load_workbook
from sqlalchemy import select

from app.models import (
    Company,
    PartnerTelegramAccount,
    PartnerTelegramAccountPartner,
    PartnerTelegramBot,
    PartnerTelegramLinkState,
)
from app.models.subscription import SubscriptionStatus
from app.services.partner_balance_notify import (
    build_partner_balance_excel,
    company_balances_for_notify,
    due_balance_slot,
    format_balance_notification,
    notify_due_partner_balances,
    positive_company_balances,
    resolve_month_days,
)


def _make_account(**kwargs) -> PartnerTelegramAccount:
    partner_id = kwargs.get("regos_partner_id")
    link_state = kwargs.get("link_state", PartnerTelegramLinkState.awaiting_language.value)
    partner_links = kwargs.pop("partner_links", None)
    if partner_links is None:
        if (
            isinstance(partner_id, int)
            and partner_id > 0
            and link_state == PartnerTelegramLinkState.linked.value
        ):
            partner_links = [PartnerTelegramAccountPartner(regos_partner_id=partner_id)]
        else:
            partner_links = []
    kwargs.setdefault("is_active", True)
    return PartnerTelegramAccount(**kwargs, partner_links=partner_links)

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


def test_resolve_month_days_supports_end_of_month_offsets():
    assert resolve_month_days({-1, -2, 1}, datetime(2026, 2, 1).date()) == {1, 27, 28}
    assert resolve_month_days({-1, 31}, datetime(2026, 1, 1).date()) == {31}
    assert resolve_month_days({31}, datetime(2026, 2, 1).date()) == set()


def test_negative_month_days_match_end_of_month():
    last_feb = datetime(2026, 2, 28, 9, 5, tzinfo=TASHKENT)
    assert _due(option="monthly", days=[-1], now=last_feb) == "2026-02-28T09:00"
    assert _due(option="monthly", days=[-2], now=last_feb) is None
    second_last = datetime(2026, 2, 27, 9, 5, tzinfo=TASHKENT)
    assert _due(option="monthly", days=[-2], now=second_last) == "2026-02-27T09:00"
    jan_last = datetime(2026, 1, 31, 9, 5, tzinfo=TASHKENT)
    assert _due(option="monthly", days=[-1], now=jan_last) == "2026-01-31T09:00"


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
        "Hello {{partner_name}} ({{partner_id}})\n{{firm_name}} / {{currency_name}}: {{balance}}",
        partner_name="Acme LLC",
    )
    # Custom templates apply per debt line; format_balance_notification returns the first line.
    assert custom == "Hello Acme LLC (7)\nMain / UZS: 60 000"

    from app.services.partner_notification_templates import (
        format_balance_notification_with_templates,
    )

    lines = format_balance_notification_with_templates(
        7,
        [("Main", "UZS", 60000), ("Shop", "USD", 10)],
        "en",
        "Hello {{partner_name}} ({{partner_id}})\n{{firm_name}} / {{currency_name}}: {{balance}}",
        partner_name="Acme LLC",
    )
    assert lines == [
        "Hello Acme LLC (7)\nMain / UZS: 60 000",
        "Hello Acme LLC (7)\nShop / USD: 10",
    ]


def test_company_balances_for_notify_negative_vs_both():
    debt = _row(id=1, end_amount=60000, debit=60000)
    credit = _row(
        id=2,
        firm={"id": 5, "name": "Shop"},
        currency={"id": 2, "name": "USD"},
        end_amount=-1500,
        debit=0,
        credit=1500,
    )
    zero = _row(id=3, firm={"id": 6, "name": "Zero"}, end_amount=0)
    assert company_balances_for_notify([debt, credit, zero], notify_filter="negative") == [
        ("Main", "UZS", 60000)
    ]
    both = company_balances_for_notify([debt, credit, zero], notify_filter="both")
    assert both == [
        ("Main", "UZS", -60000),
        ("Shop", "USD", 1500),
    ]
    text = format_balance_notification(7, both, "en", notify_filter="both")
    assert "Balances:" in text
    assert "🏢 Main (UZS): -60 000" in text
    assert "🏢 Shop (USD): 1 500" in text
    assert "Negative balance:" not in text


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
            balance_notify_schedules=[
                {
                    "id": "sched-daily",
                    "time": "09:00",
                    "option": "daily",
                    "days": [],
                    "last_slot": None,
                }
            ],
        )
        session.add(bot)
        await session.flush()
        session.add_all(
            [
                _make_account(
                    company_id=company.id,
                    bot_id=bot.id,
                    telegram_user_id=10,
                    chat_id=100,
                    language_code="en",
                    regos_partner_id=7,
                    link_state=PartnerTelegramLinkState.linked.value,
                ),
                _make_account(
                    company_id=company.id,
                    bot_id=bot.id,
                    telegram_user_id=11,
                    chat_id=101,
                    language_code="uz",
                    regos_partner_id=7,
                    link_state=PartnerTelegramLinkState.linked.value,
                ),
                _make_account(
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
            balance_notify_schedules=[
                {
                    "id": "sched-template",
                    "time": "09:00",
                    "option": "daily",
                    "days": [],
                    "last_slot": None,
                }
            ],
            notification_templates={
                "purchase": {"uz": "", "ru": "", "en": ""},
                "return_purchase": {"uz": "", "ru": "", "en": ""},
                "wholesale": {"uz": "", "ru": "", "en": ""},
                "wholesale_return": {"uz": "", "ru": "", "en": ""},
                "payment": {"uz": "", "ru": "", "en": ""},
                "balance": {
                    "uz": "UZ {{partner_id}}\n{{firm_name}} {{currency_name}} {{balance}}",
                    "ru": "",
                    "en": "EN {{partner_id}}\n{{firm_name}} {{currency_name}} {{balance}}",
                },
            },
        )
        session.add(bot)
        await session.flush()
        session.add_all(
            [
                _make_account(
                    company_id=company.id,
                    bot_id=bot.id,
                    telegram_user_id=20,
                    chat_id=200,
                    language_code="en",
                    regos_partner_id=7,
                    link_state=PartnerTelegramLinkState.linked.value,
                ),
                _make_account(
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

    messages: list[tuple[int, str, str | None]] = []

    async def fake_balance(session, company_id, *, partner_id, start_date, end_date, **kwargs):
        return {"rows": [_row(end_amount=60000, debit=60000)]}

    async def fake_message(token, chat_id, text, parse_mode="Markdown", reply_markup=None):
        messages.append((chat_id, text, parse_mode))
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
    assert messages[0] == (200, "EN 7\nMain UZS 60 000", "HTML")
    assert messages[1] == (201, "UZ 7\nMain UZS 60 000", "HTML")


@pytest.mark.asyncio
async def test_both_filter_includes_credit_balances(session_factory, monkeypatch):
    async with session_factory() as session:
        company = _company("Both Filter Co", "both-filter-co", active=True)
        session.add(company)
        await session.flush()
        bot = PartnerTelegramBot(
            company_id=company.id,
            bot_token="999:BOTH",
            webhook_secret="secret-both",
            public_key="public-both",
            balance_notify_enabled=True,
            balance_notify_filter="both",
            balance_notify_schedules=[
                {
                    "id": "sched-both",
                    "time": "09:00",
                    "option": "daily",
                    "days": [],
                    "last_slot": None,
                }
            ],
            notification_templates={
                "purchase": {"uz": "", "ru": "", "en": ""},
                "return_purchase": {"uz": "", "ru": "", "en": ""},
                "wholesale": {"uz": "", "ru": "", "en": ""},
                "wholesale_return": {"uz": "", "ru": "", "en": ""},
                "payment": {"uz": "", "ru": "", "en": ""},
                "balance": {
                    "uz": "",
                    "ru": "",
                    "en": "{{firm_name}} {{currency_name}} {{balance}}",
                },
            },
        )
        session.add(bot)
        await session.flush()
        session.add(
            _make_account(
                company_id=company.id,
                bot_id=bot.id,
                telegram_user_id=30,
                chat_id=300,
                language_code="en",
                regos_partner_id=7,
                link_state=PartnerTelegramLinkState.linked.value,
            )
        )
        await session.commit()

    messages: list[str] = []

    async def fake_balance(session, company_id, *, partner_id, start_date, end_date, **kwargs):
        return {
            "rows": [
                _row(end_amount=60000, debit=60000),
                _row(
                    id=2,
                    firm={"id": 5, "name": "Shop"},
                    currency={"id": 2, "name": "USD"},
                    end_amount=-1500,
                    debit=0,
                    credit=1500,
                ),
            ]
        }

    async def fake_message(token, chat_id, text, parse_mode="Markdown", reply_markup=None):
        messages.append(text)
        return True

    async def fake_document(*args, **kwargs):
        return True

    monkeypatch.setattr("app.services.partner_balance_notify.get_partner_balance", fake_balance)
    monkeypatch.setattr("app.services.partner_balance_notify.telegram_service.send_message", fake_message)
    monkeypatch.setattr("app.services.partner_balance_notify.telegram_service.send_document", fake_document)
    monkeypatch.setattr("app.services.partner_balance_notify.asyncio.sleep", _instant_sleep)

    async with session_factory() as session:
        sent = await notify_due_partner_balances(session, now=NOW)

    assert sent == 1
    assert messages == [
        "Main UZS -60 000",
        "Shop USD 1 500",
    ]


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
                balance_notify_schedules=[
                    {
                        "id": "sched-expired",
                        "time": "09:00",
                        "option": "daily",
                        "days": [],
                        "last_slot": None,
                    }
                ],
            )
        )
        await session.commit()

    async def fail_balance(*args, **kwargs):
        raise AssertionError("balance should not be loaded")

    monkeypatch.setattr("app.services.partner_balance_notify.get_partner_balance", fail_balance)

    async with session_factory() as session:
        sent = await notify_due_partner_balances(session, now=NOW)
        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        assert bot.balance_notify_schedules[0]["last_slot"] is None
    assert sent == 0


@pytest.mark.asyncio
async def test_multiple_due_schedules_send_once_and_claim_each(session_factory, monkeypatch):
    async with session_factory() as session:
        company = _company("Multi Sched Co", "multi-sched-co", active=True)
        session.add(company)
        await session.flush()
        bot = PartnerTelegramBot(
            company_id=company.id,
            bot_token="999:MULTI",
            webhook_secret="secret-multi",
            public_key="public-multi",
            balance_notify_enabled=True,
            balance_notify_schedules=[
                {
                    "id": "morning",
                    "time": "09:00",
                    "option": "daily",
                    "days": [],
                    "last_slot": None,
                },
                {
                    "id": "also-morning",
                    "time": "09:00",
                    "option": "weekdays",
                    "days": [0],
                    "last_slot": None,
                },
                {
                    "id": "evening",
                    "time": "18:00",
                    "option": "daily",
                    "days": [],
                    "last_slot": None,
                },
            ],
        )
        session.add(bot)
        await session.flush()
        session.add(
            _make_account(
                company_id=company.id,
                bot_id=bot.id,
                telegram_user_id=30,
                chat_id=300,
                language_code="en",
                regos_partner_id=7,
                link_state=PartnerTelegramLinkState.linked.value,
            )
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
        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        by_id = {item["id"]: item for item in bot.balance_notify_schedules}

    assert sent == 1
    assert len(messages) == 1
    assert by_id["morning"]["last_slot"] == "2026-11-09T09:00"
    assert by_id["also-morning"]["last_slot"] == "2026-11-09T09:00"
    assert by_id["evening"]["last_slot"] is None
