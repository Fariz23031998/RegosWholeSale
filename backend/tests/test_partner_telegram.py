import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import pytest
from httpx import AsyncClient

from app.models import (
    Company,
    PartnerTelegramAccount,
    PartnerTelegramAccountPartner,
    PartnerTelegramBot,
    PartnerTelegramLinkState,
)
from app.services.partner_telegram import matching_partners
from app.services.partner_telegram_webapp import validate_init_data
from tests.helpers import register_owner


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


@pytest.fixture(autouse=True)
def partner_telegram_env(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_BASE_URL", "https://example.com")
    monkeypatch.setenv("PUBLIC_APP_BASE_URL", "https://shares.example.com")
    monkeypatch.setenv(
        "MINI_APP_LINK", "https://mini.example.com/partner/{public_key}"
    )
    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _partners(*phones: str) -> list[dict]:
    return [
        {"id": index + 1, "name": f"Partner {index + 1}", "phones": phone}
        for index, phone in enumerate(phones)
    ]


def test_phone_match_links_only_exact_single_partner():
    partners = _partners("998 90 000-00-01", "998901112233, 998909990011")
    assert [item["id"] for item in matching_partners(partners, "+998901112233")] == [2]
    assert matching_partners(partners, "99890") == []
    shared = _partners("998901112233", "998 90 111 22 33")
    assert len(matching_partners(shared, "998901112233")) == 2

    # Regos stores the national number; Telegram shares +998.
    local = _partners("973923303", "998901112233")
    assert [item["id"] for item in matching_partners(local, "+998 97 392 33 03")] == [1]
    assert [item["id"] for item in matching_partners(local, "973923303")] == [1]
    same_number = _partners("973923303", "+998973923303")
    assert len(matching_partners(same_number, "+998973923303")) == 2
    assert matching_partners(local, "3923303") == []
    numeric = [{"id": 7, "name": "Test Partner", "phones": 973923303}]
    assert [item["id"] for item in matching_partners(numeric, "+998 97 392 33 03")] == [7]
    trunk = _partners("0973923303")
    assert [item["id"] for item in matching_partners(trunk, "+998973923303")] == [1]


def _init_data(bot_token: str, user_id: int, auth_date: int) -> str:
    pairs = {
        "auth_date": str(auth_date),
        "query_id": "query",
        "user": json.dumps({"id": user_id, "first_name": "Ada"}, separators=(",", ":")),
    }
    data_check = "\n".join(f"{key}={value}" for key, value in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    digest = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    return urlencode({**pairs, "hash": digest})


def test_init_data_validation_accepts_fresh_payload_and_rejects_stale_or_bad_hash():
    token = "123456:TEST"
    now = int(time.time())
    parsed = validate_init_data(_init_data(token, 77, now), token, now=now)
    assert parsed["user"]["id"] == 77

    with pytest.raises(Exception) as stale:
        validate_init_data(_init_data(token, 77, now - 90000), token, now=now)
    assert stale.value.code == "PARTNER_TELEGRAM_INIT_DATA_EXPIRED"

    tampered = _init_data(token, 77, now).replace("query", "nope")
    with pytest.raises(Exception) as invalid:
        validate_init_data(tampered, token, now=now)
    assert invalid.value.code == "PARTNER_TELEGRAM_INIT_DATA_INVALID"


def _mock_telegram_api(monkeypatch):
    calls: list[tuple[str, dict | None]] = []

    async def fake_call(bot_token: str, method: str, payload: dict | None = None) -> dict:
        calls.append((method, payload))
        if method == "getMe":
            return {"ok": True, "result": {"id": 9, "username": "partner_bot", "is_bot": True}}
        if method in {"setWebhook", "setChatMenuButton", "deleteWebhook", "answerCallbackQuery", "sendMessage"}:
            return {"ok": True, "result": True}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_call)
    return calls


async def _owner_token(client: AsyncClient, email: str) -> str:
    response = await register_owner(client, email=email, company_name="Partner Co")
    assert response.status_code == 200
    return response.json()["access_token"]


async def _save_bot(client: AsyncClient, token: str) -> dict:
    response = await client.put(
        "/api/v1/partner-telegram/bot",
        json={"bot_token": "999:PARTNER"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    public_key = body["bot"]["public_key"]
    assert body["bot"]["mini_app_url"] == f"https://mini.example.com/partner/{public_key}"
    assert "/api/v1/partner-telegram/webhook/" in body["bot"]["webhook_url"]
    return body["bot"]


@pytest.mark.asyncio
async def test_partner_bot_requires_mini_app_link(client, monkeypatch):
    monkeypatch.setenv("MINI_APP_LINK", "")
    from app.config import get_settings

    get_settings.cache_clear()
    token = await _owner_token(client, "partner-nourl@test.com")
    response = await client.put(
        "/api/v1/partner-telegram/bot",
        json={"bot_token": "999:PARTNER"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "MINI_APP_LINK_NOT_CONFIGURED"


@pytest.mark.asyncio
async def test_partner_bot_can_hide_product_quantities(client, monkeypatch):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-qty@test.com")
    saved = await _save_bot(client, token)
    assert saved["show_product_quantities"] is True

    updated = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json={
            "default_warehouse_id": None,
            "default_price_type_id": None,
            "allow_catalog_warehouse_selection": False,
            "allow_self_registration": False,
            "show_product_quantities": False,
            "default_partner_group_id": None,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["show_product_quantities"] is False


@pytest.mark.asyncio
async def test_partner_bot_saves_auto_open_qty_keypad(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-keypad@test.com")
    saved = await _save_bot(client, token)
    assert saved["auto_open_qty_keypad"] is False

    updated = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(auto_open_qty_keypad=True),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["auto_open_qty_keypad"] is True

    account_id, company_id, _public_key = await _linked_account(session_factory)

    async def defaults(session, company_id):
        return {
            "warehouse": {"id": 3, "name": "Main"},
            "price_type": {"id": 4, "name": "Wholesale"},
            "currency": {"id": 1, "name": "UZS", "exchange_rate": 1},
            "vat_calculation_type": "Include",
        }

    monkeypatch.setattr("app.services.partner_telegram_webapp._shop_defaults", defaults)

    from app.core.security import create_partner_telegram_token

    access = create_partner_telegram_token(account_id=account_id, company_id=company_id)
    options = await client.get(
        "/api/v1/partner-telegram/webapp/catalog-options",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert options.status_code == 200, options.text
    assert options.json()["auto_open_qty_keypad"] is True


def _settings_body(**overrides):
    body = {
        "default_warehouse_id": None,
        "default_price_type_id": None,
        "allow_catalog_warehouse_selection": False,
        "allow_self_registration": False,
        "show_product_quantities": True,
        "show_zero_quantity": False,
        "show_zero_price": False,
        "default_partner_group_id": None,
        "catalog_product_group_ids": [],
        "order_document_type": "doc_order_from_partner",
        "order_booked": True,
        "auto_open_qty_keypad": False,
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_partner_bot_saves_show_zero_catalog_settings(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-zero-catalog@test.com")
    saved = await _save_bot(client, token)
    assert saved["show_zero_quantity"] is False
    assert saved["show_zero_price"] is False

    updated = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(show_zero_quantity=True, show_zero_price=True),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["show_zero_quantity"] is True
    assert updated.json()["show_zero_price"] is True

    account_id, company_id, _public_key = await _linked_account(session_factory)
    captured: list[dict] = []

    async def defaults(session, company_id):
        return {
            "warehouse": {"id": 3, "name": "Main"},
            "price_type": {"id": 4, "name": "Wholesale"},
            "currency": {"id": 1, "name": "UZS", "exchange_rate": 1},
            "vat_calculation_type": "Include",
        }

    async def regos(session, company_id, endpoint, payload):
        captured.append(payload)
        return {"result": [], "next_offset": 0, "total": 0}

    monkeypatch.setattr("app.services.partner_telegram_webapp._shop_defaults", defaults)
    monkeypatch.setattr("app.services.partner_telegram_webapp.regos_async_api_request_for_company", regos)

    from app.core.security import create_partner_telegram_token

    access = create_partner_telegram_token(account_id=account_id, company_id=company_id)
    options = await client.get(
        "/api/v1/partner-telegram/webapp/catalog-options",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert options.status_code == 200, options.text
    assert options.json()["show_zero_quantity"] is True
    assert options.json()["show_zero_price"] is True

    all_products = await client.get(
        "/api/v1/partner-telegram/webapp/products?filter_type=all",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert all_products.status_code == 200, all_products.text
    assert captured[-1]["zero_quantity"] is True
    assert captured[-1]["zero_price"] is True

    in_stock = await client.get(
        "/api/v1/partner-telegram/webapp/products?filter_type=in-stock",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert in_stock.status_code == 200, in_stock.text
    assert captured[-1]["zero_quantity"] is False
    assert captured[-1]["zero_price"] is True


@pytest.mark.asyncio
async def test_partner_bot_saves_catalog_categories(client, monkeypatch):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-categories@test.com")
    saved = await _save_bot(client, token)
    assert saved["catalog_product_group_ids"] == []

    async def groups(session, company_id):
        return {
            "groups": [
                {"id": 1, "parent_id": None, "name": "Food", "path": "Food"},
                {"id": 3, "parent_id": 1, "name": "Rice", "path": "Food/Rice"},
            ]
        }

    monkeypatch.setattr("app.services.partner_telegram.regos_groups.list_groups", groups)

    updated = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(catalog_product_group_ids=[3, 1, 1, 0, -4]),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["catalog_product_group_ids"] == [3, 1]

    cleared = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(catalog_product_group_ids=[]),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["catalog_product_group_ids"] == []


@pytest.mark.asyncio
async def test_partner_bot_saves_balance_schedule(client, monkeypatch):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-balance-schedule@test.com")
    saved = await _save_bot(client, token)
    assert saved["balance_notify_enabled"] is False
    assert saved["balance_notify_schedules"] == []

    updated = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(
            balance_notify_enabled=True,
            balance_notify_schedules=[
                {
                    "time": "10:30",
                    "option": "weekdays",
                    "days": [2, 0, 0],
                }
            ],
        ),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["balance_notify_enabled"] is True
    assert len(body["balance_notify_schedules"]) == 1
    schedule = body["balance_notify_schedules"][0]
    assert schedule["time"] == "10:30"
    assert schedule["option"] == "weekdays"
    assert schedule["days"] == [0, 2]
    assert isinstance(schedule["id"], str) and schedule["id"]

    fetched = await client.get(
        "/api/v1/partner-telegram/bot",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert fetched.status_code == 200
    assert fetched.json()["balance_notify_schedules"][0]["days"] == [0, 2]
    assert fetched.json()["balance_notify_templates"] == {"uz": "", "ru": "", "en": ""}

    templated = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(
            balance_notify_enabled=True,
            balance_notify_schedules=[
                {
                    "id": schedule["id"],
                    "time": "10:30",
                    "option": "weekdays",
                    "days": [0, 2],
                },
                {
                    "time": "18:00",
                    "option": "monthly",
                    "days": [1, -1, -1, 0, 32],
                },
            ],
            balance_notify_templates={
                "uz": "  Salom {{partner_id}}  ",
                "ru": "ID {{partner_id}}\n{{balances}}",
                "en": "Partner {{partner_id}}",
                "tj": "ignored",
            },
        ),
        headers={"Authorization": f"Bearer {token}"},
    )
    # day 0 and 32 are invalid for monthly → 422
    assert templated.status_code == 422

    templated = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(
            balance_notify_enabled=True,
            balance_notify_schedules=[
                {
                    "id": schedule["id"],
                    "time": "10:30",
                    "option": "weekdays",
                    "days": [0, 2],
                },
                {
                    "time": "18:00",
                    "option": "monthly",
                    "days": [1, -1, -1],
                },
            ],
            balance_notify_templates={
                "uz": "  Salom {{partner_id}}  ",
                "ru": "ID {{partner_id}}\n{{balances}}",
                "en": "Partner {{partner_id}}",
                "tj": "ignored",
            },
        ),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert templated.status_code == 200, templated.text
    schedules = templated.json()["balance_notify_schedules"]
    assert len(schedules) == 2
    assert schedules[0]["id"] == schedule["id"]
    assert schedules[1]["option"] == "monthly"
    assert schedules[1]["days"] == [-1, 1]
    assert templated.json()["balance_notify_templates"] == {
        "uz": "Salom {{partner_id}}",
        "ru": "ID {{partner_id}}\n{{balances}}",
        "en": "Partner {{partner_id}}",
    }

    too_long = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(
            balance_notify_templates={"uz": "", "ru": "", "en": "x" * 3501},
        ),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert too_long.status_code == 422

    invalid_time = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(
            balance_notify_schedules=[{"time": "25:00", "option": "daily", "days": []}],
        ),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert invalid_time.status_code == 422

    empty_days = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(
            balance_notify_enabled=True,
            balance_notify_schedules=[{"time": "09:00", "option": "monthly", "days": []}],
        ),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert empty_days.status_code == 422

    too_many = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(
            balance_notify_enabled=True,
            balance_notify_schedules=[
                {"time": "09:00", "option": "daily", "days": []} for _ in range(11)
            ],
        ),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert too_many.status_code == 422

    enabled_empty = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(balance_notify_enabled=True, balance_notify_schedules=[]),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert enabled_empty.status_code == 422


@pytest.mark.asyncio
async def test_partner_catalog_limits_groups_products_and_orders(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-catalog-scope@test.com")
    await _save_bot(client, token)
    account_id, company_id, _public_key = await _linked_account(session_factory)
    async with session_factory() as session:
        from sqlalchemy import select

        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        bot.catalog_product_group_ids = [1]
        await session.commit()

    from app.core.security import create_partner_telegram_token

    access = create_partner_telegram_token(account_id=account_id, company_id=company_id)
    captured: list[dict] = []

    async def defaults(session, company_id):
        return {
            "warehouse": {"id": 3, "name": "Main"},
            "price_type": {"id": 4, "name": "Wholesale"},
            "currency": {"id": 1, "name": "UZS", "exchange_rate": 1},
            "vat_calculation_type": "Include",
        }

    async def groups(session, company_id):
        return {
            "groups": [
                {"id": 1, "parent_id": None, "name": "Food", "path": "Food"},
                {"id": 3, "parent_id": 1, "name": "Rice", "path": "Food/Rice"},
                {"id": 9, "parent_id": None, "name": "Other", "path": "Other"},
            ]
        }

    async def regos(session, company_id, endpoint, payload):
        captured.append({"endpoint": endpoint, "payload": payload})
        return {"result": [], "next_offset": 0, "total": 0}

    async def products(session, company_id, product_ids, **kwargs):
        return {
            9: {
                "id": 9,
                "name": "Soap",
                "price": 100.0,
                "available": 4,
                "unit_name": "pcs",
                "image": "",
                "sku": "S",
                "group_id": 9,
            }
        }

    async def partner(session, company_id, partner_id):
        return {"id": partner_id, "name": "Acme"}

    monkeypatch.setattr("app.services.partner_telegram_webapp._shop_defaults", defaults)
    monkeypatch.setattr("app.services.partner_telegram_webapp.regos_groups.list_groups", groups)
    monkeypatch.setattr("app.services.partner_telegram_webapp.regos_async_api_request_for_company", regos)
    monkeypatch.setattr("app.services.partner_telegram_webapp._load_products_for_order", products)
    monkeypatch.setattr("app.services.partner_telegram_webapp.regos_partners.get_partner_by_id", partner)

    headers = {"Authorization": f"Bearer {access}"}
    listed = await client.get("/api/v1/partner-telegram/webapp/product-groups", headers=headers)
    assert listed.status_code == 200, listed.text
    assert [item["id"] for item in listed.json()["groups"]] == [1, 3]

    response = await client.get("/api/v1/partner-telegram/webapp/products", headers=headers)
    assert response.status_code == 200, response.text
    assert captured[-1]["payload"]["group_ids"] == [1, 3]

    outside = await client.get("/api/v1/partner-telegram/webapp/products?group_id=9", headers=headers)
    assert outside.status_code == 200, outside.text
    assert outside.json()["products"] == []
    assert outside.json()["total"] == 0
    assert captured[-1]["payload"]["group_ids"] == [1, 3]

    order = await client.post(
        "/api/v1/partner-telegram/webapp/orders",
        json={"is_takeaway": True, "address": "", "items": [{"product_id": 9, "quantity": 1}]},
        headers=headers,
    )
    assert order.status_code == 400, order.text
    assert order.json()["code"] == "PARTNER_ORDER_PRODUCT_UNAVAILABLE"


@pytest.mark.asyncio
async def test_phone_link_and_staff_correction(client, monkeypatch, session_factory):
    calls = _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-link@test.com")
    saved = await _save_bot(client, token)
    menu_calls = [payload for method, payload in calls if method == "setChatMenuButton"]
    assert menu_calls[-1]["menu_button"]["web_app"]["url"] == saved["mini_app_url"]
    assert menu_calls[-1]["menu_button"]["text"] == "App"
    assert "chat_id" not in menu_calls[-1]

    async with session_factory() as session:
        from sqlalchemy import select

        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        secret = bot.webhook_secret

    async def one_partner(session, company_id, **kwargs):
        return {
            "partners": [{"id": 15, "name": "Acme", "phones": "+998 90 123 45 67"}],
            "next_offset": 0,
            "total": 1,
        }

    monkeypatch.setattr("app.services.partner_telegram.regos_partners.list_partners", one_partner)

    start = await client.post(f"/api/v1/partner-telegram/webhook/{secret}", json={
        "message": {
            "message_id": 1,
            "text": "/start",
            "chat": {"id": 501, "type": "private"},
            "from": {"id": 501, "first_name": "Ada", "language_code": "en"},
        }
    })
    assert start.status_code == 200
    start_menu = [
        payload
        for method, payload in calls
        if method == "setChatMenuButton" and payload.get("chat_id") == 501
    ]
    assert start_menu[-1]["menu_button"]["text"] == "App"

    contact = await client.post(f"/api/v1/partner-telegram/webhook/{secret}", json={
        "message": {
            "message_id": 2,
            "chat": {"id": 501, "type": "private"},
            "from": {"id": 501, "first_name": "Ada"},
            "contact": {"phone_number": "+998901234567", "user_id": 501},
        }
    })
    assert contact.status_code == 200
    contact_menu = [
        payload
        for method, payload in calls
        if method == "setChatMenuButton" and payload.get("chat_id") == 501
    ]
    # Contact payload has no Telegram language_code, so prompt language defaults to ru.
    assert contact_menu[-1]["menu_button"]["text"] == "Приложение"

    language = await client.post(f"/api/v1/partner-telegram/webhook/{secret}", json={
        "callback_query": {
            "id": "cb1",
            "data": "ptlang:ru",
            "from": {"id": 501},
            "message": {"chat": {"id": 501, "type": "private"}},
        }
    })
    assert language.status_code == 200

    ru_menu = [
        payload
        for method, payload in calls
        if method == "setChatMenuButton" and payload.get("chat_id") == 501
    ]
    assert ru_menu[-1]["menu_button"]["text"] == "Приложение"
    assert ru_menu[-1]["menu_button"]["web_app"]["url"] == saved["mini_app_url"]

    accounts = await client.get(
        "/api/v1/partner-telegram/accounts",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert accounts.status_code == 200
    linked = accounts.json()[0]
    assert linked["regos_partner_id"] == 15
    assert linked["link_state"] == "linked"
    assert linked["language_code"] == "ru"

    async def two_partners(session, company_id, **kwargs):
        return {
            "partners": [
                {"id": 15, "name": "Acme", "phones": "998901234567"},
                {"id": 16, "name": "Other", "phones": "998901234567"},
            ],
            "next_offset": 0,
            "total": 2,
        }

    monkeypatch.setattr("app.services.partner_telegram.regos_partners.list_partners", two_partners)
    again = await client.post(f"/api/v1/partner-telegram/webhook/{secret}", json={
        "callback_query": {
            "id": "cb2",
            "data": "ptlang:en",
            "from": {"id": 501},
            "message": {"chat": {"id": 501, "type": "private"}},
        }
    })
    assert again.status_code == 200
    en_menu = [
        payload
        for method, payload in calls
        if method == "setChatMenuButton" and payload.get("chat_id") == 501
    ]
    assert en_menu[-1]["menu_button"]["text"] == "App"
    accounts = await client.get(
        "/api/v1/partner-telegram/accounts",
        headers={"Authorization": f"Bearer {token}"},
    )
    still = accounts.json()[0]
    assert still["regos_partner_id"] == 15
    assert still["language_code"] == "en"

    async def partner_by_id(session, company_id, partner_id):
        return {"id": partner_id, "name": "Assigned"}

    monkeypatch.setattr("app.services.partner_telegram.regos_partners.get_partner_by_id", partner_by_id)
    cleared = await client.patch(
        f"/api/v1/partner-telegram/accounts/{still['id']}",
        json={"regos_partner_id": None},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert cleared.status_code == 200
    assert cleared.json()["link_state"] == "unlinked"
    assert cleared.json()["regos_partner_id"] is None

    assigned = await client.patch(
        f"/api/v1/partner-telegram/accounts/{still['id']}",
        json={"regos_partner_id": 44},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert assigned.status_code == 200
    assert assigned.json()["regos_partner_id"] == 44
    assert assigned.json()["partner_name"] == "Assigned"
    assert assigned.json()["partners"] == [{"id": 44, "name": "Assigned"}]


@pytest.mark.asyncio
async def test_account_search_deactivate_delete_and_multi_partner_links(
    client, monkeypatch, session_factory
):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-account-mgmt@test.com")
    await _save_bot(client, token)
    auth = {"Authorization": f"Bearer {token}"}

    async with session_factory() as session:
        from sqlalchemy import select

        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        session.add_all(
            [
                _make_account(
                    company_id=bot.company_id,
                    bot_id=bot.id,
                    telegram_user_id=7001,
                    chat_id=7001,
                    username="alpha_user",
                    first_name="Alpha",
                    phone="+998901111111",
                    regos_partner_id=101,
                    link_state=PartnerTelegramLinkState.linked.value,
                ),
                _make_account(
                    company_id=bot.company_id,
                    bot_id=bot.id,
                    telegram_user_id=7002,
                    chat_id=7002,
                    username="beta_user",
                    first_name="Beta",
                    phone="+998902222222",
                    regos_partner_id=202,
                    link_state=PartnerTelegramLinkState.linked.value,
                ),
            ]
        )
        await session.commit()

    async def partner_by_id(session, company_id, partner_id):
        return {"id": partner_id, "name": f"Partner {partner_id}"}

    async def partner_names_bulk(session, company_id, payload):
        ids = payload.get("ids") or []
        return {
            "result": [{"id": partner_id, "name": f"Partner {partner_id}"} for partner_id in ids]
        }

    monkeypatch.setattr(
        "app.services.partner_telegram.regos_partners.get_partner_by_id", partner_by_id
    )

    async def fake_regos(session, company_id, path, payload=None, **kwargs):
        if path == "partner/get":
            return await partner_names_bulk(session, company_id, payload or {})
        raise AssertionError(path)

    monkeypatch.setattr(
        "app.core.regos_api.regos_async_api_request_for_company", fake_regos
    )

    searched = await client.get(
        "/api/v1/partner-telegram/accounts",
        params={"search": "alpha"},
        headers=auth,
    )
    assert searched.status_code == 200
    assert len(searched.json()) == 1
    assert searched.json()[0]["telegram_user_id"] == 7001

    account_id = searched.json()[0]["id"]
    multi = await client.patch(
        f"/api/v1/partner-telegram/accounts/{account_id}",
        json={"regos_partner_ids": [101, 303]},
        headers=auth,
    )
    assert multi.status_code == 200, multi.text
    assert multi.json()["regos_partner_id"] == 101
    assert {item["id"] for item in multi.json()["partners"]} == {101, 303}

    deactivated = await client.patch(
        f"/api/v1/partner-telegram/accounts/{account_id}",
        json={"is_active": False},
        headers=auth,
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    from app.core.security import create_partner_telegram_token

    async with session_factory() as session:
        from sqlalchemy import select

        company = (await session.execute(select(Company))).scalar_one()
        company_id = company.id
    access = create_partner_telegram_token(account_id=account_id, company_id=company_id)
    blocked = await client.get(
        "/api/v1/partner-telegram/webapp/me",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert blocked.status_code in {401, 403}
    assert blocked.json()["code"] == "PARTNER_TELEGRAM_INACTIVE"

    activated = await client.patch(
        f"/api/v1/partner-telegram/accounts/{account_id}",
        json={"is_active": True},
        headers=auth,
    )
    assert activated.status_code == 200
    assert activated.json()["is_active"] is True

    switched = await client.post(
        "/api/v1/partner-telegram/webapp/active-partner",
        json={"regos_partner_id": 303},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert switched.status_code == 200, switched.text
    assert switched.json()["regos_partner_id"] == 303

    deleted = await client.delete(
        f"/api/v1/partner-telegram/accounts/{account_id}",
        headers=auth,
    )
    assert deleted.status_code == 200
    remaining = await client.get("/api/v1/partner-telegram/accounts", headers=auth)
    assert [row["telegram_user_id"] for row in remaining.json()] == [7002]


@pytest.mark.asyncio
async def test_ambiguous_phone_stays_unlinked(client, monkeypatch):
    calls = _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-ambiguous@test.com")
    bot = await _save_bot(client, token)

    async def two_partners(session, company_id, **kwargs):
        return {
            "partners": [
                {"id": 1, "name": "A", "phones": "998901112233"},
                {"id": 2, "name": "B", "phones": "998 90 111-22-33"},
            ],
            "next_offset": 0,
            "total": 2,
        }

    monkeypatch.setattr("app.services.partner_telegram.regos_partners.list_partners", two_partners)
    secret = bot["webhook_url"].rstrip("/").split("/")[-1]
    await client.post(f"/api/v1/partner-telegram/webhook/{secret}", json={
        "message": {
            "chat": {"id": 8, "type": "private"},
            "from": {"id": 8, "first_name": "Bo"},
            "contact": {"phone_number": "998901112233", "user_id": 8},
        }
    })
    await client.post(f"/api/v1/partner-telegram/webhook/{secret}", json={
        "callback_query": {
            "id": "cb",
            "data": "ptlang:uz",
            "from": {"id": 8},
            "message": {"chat": {"id": 8, "type": "private"}},
        }
    })
    uz_menu = [
        payload
        for method, payload in calls
        if method == "setChatMenuButton" and payload.get("chat_id") == 8
    ]
    assert uz_menu[-1]["menu_button"]["text"] == "Ilova"
    accounts = await client.get(
        "/api/v1/partner-telegram/accounts",
        headers={"Authorization": f"Bearer {token}"},
    )
    row = accounts.json()[0]
    assert row["link_state"] == "unlinked"
    assert row["regos_partner_id"] is None


@pytest.mark.asyncio
async def test_order_uses_linked_partner_and_catalog_price(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-order@test.com")
    await _save_bot(client, token)
    async with session_factory() as session:
        from sqlalchemy import select

        company = (await session.execute(select(Company))).scalar_one()
        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        account = _make_account(
            company_id=company.id,
            bot_id=bot.id,
            telegram_user_id=70,
            chat_id=70,
            phone="998901234567",
            language_code="ru",
            regos_partner_id=15,
            link_state=PartnerTelegramLinkState.linked.value,
        )
        session.add(account)
        await session.commit()
        await session.refresh(account)
        account_id = account.id
        company_id = company.id

    from app.core.security import create_partner_telegram_token

    access = create_partner_telegram_token(account_id=account_id, company_id=company_id)
    captured: dict = {}

    async def defaults(session, company_id):
        return {
            "warehouse": {"id": 3, "name": "Main"},
            "price_type": {"id": 4, "name": "Wholesale"},
            "currency": {"id": 1, "name": "UZS", "exchange_rate": 1},
            "vat_calculation_type": "Include",
        }

    async def products(session, company_id, product_ids, **kwargs):
        return {9: {"id": 9, "name": "Rice", "price": 1200.0, "available": 4, "unit_name": "kg", "image": "", "sku": "R"}}

    async def partner(session, company_id, partner_id):
        return {"id": partner_id, "name": "Acme"}

    async def create_order(session, company_id, order_defaults, description, lines, *, booked=True):
        captured["partner_id"] = order_defaults["partner"]["id"]
        captured["lines"] = lines
        captured["description"] = description
        captured["booked"] = booked
        return {"id": 80, "code": "OFP-80"}

    monkeypatch.setattr("app.services.partner_telegram_webapp._shop_defaults", defaults)
    monkeypatch.setattr("app.services.partner_telegram_webapp._load_products_for_order", products)
    monkeypatch.setattr("app.services.partner_telegram_webapp.regos_partners.get_partner_by_id", partner)
    monkeypatch.setattr("app.services.partner_telegram_webapp.regos_sales.create_booked_partner_order", create_order)

    response = await client.post(
        "/api/v1/partner-telegram/webapp/orders",
        json={
            "is_takeaway": False,
            "address": "Yunusabad",
            "phone": "998901234567",
            "items": [{"product_id": 9, "quantity": 2, "price": 1}],
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["order_id"] == 80
    assert captured["partner_id"] == 15
    assert captured["lines"][0]["price"] == 1200.0
    assert "Yunusabad" in captured["description"]
    assert captured["booked"] is True


@pytest.mark.asyncio
async def test_create_order_requires_create_orders_page(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-create-orders-guard@test.com")
    await _save_bot(client, token)
    account_id, company_id, _public_key = await _linked_account(session_factory)

    patched = await client.patch(
        f"/api/v1/partner-telegram/accounts/{account_id}",
        json={"page_overrides": {"create_orders": False}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["enabled_pages"]["catalog"] is True
    assert patched.json()["enabled_pages"]["create_orders"] is False

    from app.core.security import create_partner_telegram_token

    access = create_partner_telegram_token(account_id=account_id, company_id=company_id)
    blocked = await client.post(
        "/api/v1/partner-telegram/webapp/orders",
        json={
            "is_takeaway": True,
            "address": "",
            "phone": "998901112233",
            "items": [{"product_id": 9, "quantity": 1}],
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert blocked.status_code == 403
    assert blocked.json()["code"] == "PARTNER_PAGE_DISABLED"


def test_sanitize_excel_filename():
    from app.services.partner_telegram_webapp import sanitize_excel_filename

    assert sanitize_excel_filename("../../evil.xlsx") == "evil.xlsx"
    assert sanitize_excel_filename("report payments.xlsx") == "report_payments.xlsx"
    assert sanitize_excel_filename("report") == "report.xlsx"
    assert sanitize_excel_filename("") == "export.xlsx"


@pytest.mark.asyncio
async def test_webapp_send_excel_to_chat(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-send-excel@test.com")
    await _save_bot(client, token)
    account_id, company_id, _public_key = await _linked_account(session_factory)

    from app.core.security import create_partner_telegram_token

    access = create_partner_telegram_token(account_id=account_id, company_id=company_id)
    captured: dict = {}

    async def fake_send_document(bot_token, chat_id, file_bytes, filename, *, caption=None):
        captured["chat_id"] = chat_id
        captured["filename"] = filename
        captured["bytes"] = file_bytes
        captured["caption"] = caption
        return True

    monkeypatch.setattr(
        "app.services.partner_telegram_webapp.telegram_service.send_document",
        fake_send_document,
    )

    payload = b"PK\x03\x04fake-xlsx"
    response = await client.post(
        "/api/v1/partner-telegram/webapp/send-excel",
        headers={"Authorization": f"Bearer {access}"},
        files={"file": ("partner payments.xlsx", payload, "application/octet-stream")},
        data={"filename": "partner payments.xlsx", "caption": "Payments"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True
    assert response.json()["filename"] == "partner_payments.xlsx"
    assert captured["chat_id"] == 80
    assert captured["filename"] == "partner_payments.xlsx"
    assert captured["bytes"] == payload
    assert captured["caption"] == "Payments"

    unauthorized = await client.post(
        "/api/v1/partner-telegram/webapp/send-excel",
        files={"file": ("a.xlsx", payload, "application/octet-stream")},
    )
    assert unauthorized.status_code == 401

    async def fail_send(*_args, **_kwargs):
        return False

    monkeypatch.setattr(
        "app.services.partner_telegram_webapp.telegram_service.send_document",
        fail_send,
    )
    failed = await client.post(
        "/api/v1/partner-telegram/webapp/send-excel",
        headers={"Authorization": f"Bearer {access}"},
        files={"file": ("a.xlsx", payload, "application/octet-stream")},
        data={"filename": "a.xlsx"},
    )
    assert failed.status_code == 502
    assert failed.json()["code"] == "TELEGRAM_SEND_FAILED"


@pytest.mark.asyncio
async def test_partner_bot_saves_order_document_settings(client, monkeypatch):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-order-doc@test.com")
    saved = await _save_bot(client, token)
    assert saved["order_document_type"] == "doc_order_from_partner"
    assert saved["order_booked"] is True

    updated = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(
            order_document_type="doc_wholesale",
            order_booked=False,
        ),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["order_document_type"] == "doc_wholesale"
    assert updated.json()["order_booked"] is False

    partner_order = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(
            order_document_type="doc_order_from_partner",
            order_booked=False,
        ),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert partner_order.status_code == 200, partner_order.text
    assert partner_order.json()["order_document_type"] == "doc_order_from_partner"
    assert partner_order.json()["order_booked"] is False


@pytest.mark.asyncio
async def test_order_create_respects_booked_and_wholesale_settings(
    client, monkeypatch, session_factory
):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-order-modes@test.com")
    await _save_bot(client, token)
    async with session_factory() as session:
        from sqlalchemy import select

        company = (await session.execute(select(Company))).scalar_one()
        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        bot.order_document_type = "doc_order_from_partner"
        bot.order_booked = False
        account = _make_account(
            company_id=company.id,
            bot_id=bot.id,
            telegram_user_id=71,
            chat_id=71,
            phone="998901234567",
            language_code="ru",
            regos_partner_id=15,
            link_state=PartnerTelegramLinkState.linked.value,
        )
        session.add(account)
        await session.commit()
        await session.refresh(account)
        account_id = account.id
        company_id = company.id

    from app.core.security import create_partner_telegram_token

    access = create_partner_telegram_token(account_id=account_id, company_id=company_id)
    captured: dict = {}

    async def defaults(session, company_id):
        return {
            "warehouse": {"id": 3, "name": "Main"},
            "price_type": {"id": 4, "name": "Wholesale"},
            "currency": {"id": 1, "name": "UZS", "exchange_rate": 1},
            "vat_calculation_type": "Include",
        }

    async def products(session, company_id, product_ids, **kwargs):
        return {
            9: {
                "id": 9,
                "name": "Rice",
                "price": 1200.0,
                "available": 4,
                "unit_name": "kg",
                "image": "",
                "sku": "R",
            }
        }

    async def partner(session, company_id, partner_id):
        return {"id": partner_id, "name": "Acme"}

    async def create_partner_order(session, company_id, order_defaults, description, lines, *, booked=True):
        captured["path"] = "partner"
        captured["booked"] = booked
        return {"id": 81, "code": "OFP-81"}

    async def create_wholesale(session, company_id, order_defaults, description, lines):
        captured["path"] = "wholesale"
        return {"id": 82, "code": "WS-82"}

    monkeypatch.setattr("app.services.partner_telegram_webapp._shop_defaults", defaults)
    monkeypatch.setattr("app.services.partner_telegram_webapp._load_products_for_order", products)
    monkeypatch.setattr("app.services.partner_telegram_webapp.regos_partners.get_partner_by_id", partner)
    monkeypatch.setattr(
        "app.services.partner_telegram_webapp.regos_sales.create_booked_partner_order",
        create_partner_order,
    )
    monkeypatch.setattr(
        "app.services.partner_telegram_webapp.regos_sales.create_partner_wholesale_draft",
        create_wholesale,
    )

    headers = {"Authorization": f"Bearer {access}"}
    payload = {
        "is_takeaway": True,
        "address": "",
        "items": [{"product_id": 9, "quantity": 1}],
    }
    unbooked = await client.post(
        "/api/v1/partner-telegram/webapp/orders",
        json=payload,
        headers=headers,
    )
    assert unbooked.status_code == 200, unbooked.text
    assert unbooked.json()["order_id"] == 81
    assert captured["path"] == "partner"
    assert captured["booked"] is False

    async with session_factory() as session:
        from sqlalchemy import select

        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        bot.order_document_type = "doc_wholesale"
        await session.commit()

    wholesale = await client.post(
        "/api/v1/partner-telegram/webapp/orders",
        json=payload,
        headers=headers,
    )
    assert wholesale.status_code == 200, wholesale.text
    assert wholesale.json()["order_id"] == 82
    assert captured["path"] == "wholesale"


@pytest.mark.asyncio
async def test_stock_notification_goes_only_to_linked_partner(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-notify@test.com")
    await _save_bot(client, token)
    async with session_factory() as session:
        from sqlalchemy import select

        company = (await session.execute(select(Company))).scalar_one()
        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        session.add_all([
            _make_account(
                company_id=company.id,
                bot_id=bot.id,
                telegram_user_id=1,
                chat_id=101,
                language_code="en",
                regos_partner_id=15,
                link_state=PartnerTelegramLinkState.linked.value,
            ),
            _make_account(
                company_id=company.id,
                bot_id=bot.id,
                telegram_user_id=2,
                chat_id=202,
                language_code="ru",
                regos_partner_id=99,
                link_state=PartnerTelegramLinkState.linked.value,
            ),
            _make_account(
                company_id=company.id,
                bot_id=bot.id,
                telegram_user_id=3,
                chat_id=303,
                language_code="uz",
                regos_partner_id=15,
                link_state=PartnerTelegramLinkState.unlinked.value,
            ),
        ])
        await session.commit()
        company_id = company.id

    sent: list[tuple[int, str]] = []

    async def fake_send(bot_token, chat_id, text, parse_mode="Markdown", reply_markup=None):
        sent.append((chat_id, text))
        return True

    monkeypatch.setattr("app.services.partner_telegram.telegram_service.send_message", fake_send)
    from app.services.partner_telegram import notify_partner_document

    async with session_factory() as session:
        await notify_partner_document(
            session,
            company_id,
            {"id": 4, "code": "WS-4", "date": 1_700_000_000, "partner": {"id": 15, "name": "Acme"}},
            [{"item": {"name": "Rice"}, "quantity": 2, "price": 10}],
            warehouse_name="Main",
            is_cancelled=False,
            is_return=False,
            use_cost=False,
            kind="wholesale",
        )
        await session.commit()

    assert [chat_id for chat_id, _text in sent] == [101]
    assert "Purchase receipt" in sent[0][1]
    assert "Acme" not in sent[0][1]


@pytest.mark.asyncio
async def test_stock_notification_skips_inactive_accounts(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-notify-inactive@test.com")
    await _save_bot(client, token)
    async with session_factory() as session:
        from sqlalchemy import select

        company = (await session.execute(select(Company))).scalar_one()
        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        session.add(
            _make_account(
                company_id=company.id,
                bot_id=bot.id,
                telegram_user_id=8,
                chat_id=808,
                language_code="en",
                regos_partner_id=15,
                link_state=PartnerTelegramLinkState.linked.value,
                is_active=False,
            )
        )
        await session.commit()
        company_id = company.id

    sent: list[int] = []

    async def fake_send(bot_token, chat_id, text, parse_mode="Markdown", reply_markup=None):
        sent.append(chat_id)
        return True

    monkeypatch.setattr("app.services.partner_telegram.telegram_service.send_message", fake_send)
    from app.services.partner_telegram import notify_partner_document

    async with session_factory() as session:
        await notify_partner_document(
            session,
            company_id,
            {"id": 4, "code": "WS-4", "date": 1_700_000_000, "partner": {"id": 15, "name": "Acme"}},
            [{"item": {"name": "Rice"}, "quantity": 2, "price": 10}],
            warehouse_name="Main",
            is_cancelled=False,
            is_return=False,
            use_cost=False,
            kind="wholesale",
        )
        await session.commit()

    assert sent == []


@pytest.mark.asyncio
async def test_operation_webhook_still_notifies_staff_and_partner(client, monkeypatch):
    staff_calls: list[int] = []
    partner_calls: list[int] = []

    async def staff(session, company_id, **kwargs):
        staff_calls.append(company_id)

    async def partner(session, company_id, document, operations, **kwargs):
        partner_calls.append(document["partner"]["id"])

    async def fetch_document(session, company_id, endpoint, document_id):
        return {
            "id": document_id,
            "code": "D-1",
            "date": 1,
            "partner": {"id": 15, "name": "Acme"},
            "stock": {"name": "Main"},
        }

    async def fetch_operations(session, company_id, endpoint, document_id):
        return [{"item": {"name": "Rice"}, "quantity": 1, "price": 5, "cost": 4}]

    async def warehouse(session, company_id, document):
        return "Main"

    async def noop(*args, **kwargs):
        return None

    import sys
    from types import SimpleNamespace

    import app.services.regos_webhook_background  # noqa: F401

    module = sys.modules[
        "app.services.regos_webhook_background.process_operation_document.process_operation_document"
    ]
    monkeypatch.setattr(module, "telegram_service", SimpleNamespace(notify_company_subscribers=staff))
    monkeypatch.setattr(
        module,
        "partner_telegram_service",
        SimpleNamespace(
            notify_partner_document=partner,
            PARTNER_DOCUMENT_KINDS={"purchase", "return_purchase", "wholesale", "wholesale_return"},
        ),
    )
    monkeypatch.setattr(module.doc_fetch, "fetch_document", fetch_document)
    monkeypatch.setattr(module.doc_fetch, "fetch_operations", fetch_operations)
    monkeypatch.setattr(module.out_of_stock_service, "check_and_record_out_of_stock", noop)
    monkeypatch.setattr(module.out_of_stock_service, "is_stock_decrease_event", lambda *args, **kwargs: False)
    monkeypatch.setattr(
        "app.services.regos_webhook_background._resolve_warehouse_name",
        warehouse,
    )
    monkeypatch.setattr(
        "app.services.regos_webhook_background._publish_catalog_stock_updates",
        noop,
    )

    await module.process_operation_document(1, 9, "DocWholeSalePerformed")
    assert staff_calls == [1]
    assert partner_calls == [15]

    await module.process_operation_document(1, 10, "DocMovementPerformed")
    assert staff_calls == [1, 1]
    assert partner_calls == [15]


@pytest.mark.asyncio
async def test_payment_notification_goes_only_to_linked_partner(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-payment-notify@test.com")
    await _save_bot(client, token)
    async with session_factory() as session:
        from sqlalchemy import select

        company = (await session.execute(select(Company))).scalar_one()
        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        session.add_all([
            _make_account(
                company_id=company.id,
                bot_id=bot.id,
                telegram_user_id=1,
                chat_id=101,
                language_code="en",
                regos_partner_id=15,
                link_state=PartnerTelegramLinkState.linked.value,
            ),
            _make_account(
                company_id=company.id,
                bot_id=bot.id,
                telegram_user_id=2,
                chat_id=202,
                language_code="ru",
                regos_partner_id=99,
                link_state=PartnerTelegramLinkState.linked.value,
            ),
        ])
        await session.commit()
        company_id = company.id

    sent: list[tuple[int, str]] = []

    async def fake_send(bot_token, chat_id, text, parse_mode="Markdown", reply_markup=None):
        sent.append((chat_id, text))
        return True

    monkeypatch.setattr("app.services.partner_telegram.telegram_service.send_message", fake_send)
    from app.services.partner_telegram import notify_partner_payment

    async with session_factory() as session:
        await notify_partner_payment(
            session,
            company_id,
            {
                "id": 8,
                "code": "PAY-8",
                "date": 1_700_000_000,
                "amount": 500,
                "partner": {"id": 15, "name": "Acme"},
                "type": {"name": "Cash"},
                "category": {"positive": False, "name": "Customer payment"},
            },
            is_cancelled=False,
        )
        await session.commit()

    assert [chat_id for chat_id, _text in sent] == [101]
    assert "Acme" not in sent[0][1]
    assert "PAY-8" in sent[0][1]


@pytest.mark.asyncio
async def test_payment_webhook_notifies_staff_and_partner(monkeypatch):
    staff_calls: list[int] = []
    partner_calls: list[tuple[int, bool]] = []

    async def staff(session, company_id, **kwargs):
        staff_calls.append(company_id)

    async def partner(session, company_id, document, *, is_cancelled):
        partner_calls.append((document["partner"]["id"], is_cancelled))

    async def fetch_document(session, company_id, endpoint, document_id):
        return {
            "id": document_id,
            "code": "PAY-1",
            "amount": 10,
            "partner": {"id": 15, "name": "Acme"},
        }

    import app.services.regos_webhook_background as background

    monkeypatch.setattr(background.telegram_service, "notify_company_subscribers", staff)
    monkeypatch.setattr(background.doc_fetch, "fetch_document", fetch_document)
    monkeypatch.setattr("app.services.partner_telegram.notify_partner_payment", partner)

    await background.process_payment_document(1, 9, "DocPaymentPerformed")
    assert staff_calls == [1]
    assert partner_calls == [(15, False)]

    await background.process_payment_document(1, 10, "DocPaymentPerformCanceled")
    assert partner_calls == [(15, False), (15, True)]


async def _linked_account(session_factory, *, warehouse_id=None, price_type_id=None, phone="998901112233"):
    async with session_factory() as session:
        from sqlalchemy import select

        company = (await session.execute(select(Company))).scalar_one()
        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        account = _make_account(
            company_id=company.id,
            bot_id=bot.id,
            telegram_user_id=80,
            chat_id=80,
            phone=phone,
            first_name="Ada",
            language_code="en",
            regos_partner_id=15,
            link_state=PartnerTelegramLinkState.linked.value,
            warehouse_id=warehouse_id,
            price_type_id=price_type_id,
        )
        session.add(account)
        await session.commit()
        await session.refresh(account)
        return account.id, company.id, bot.public_key


@pytest.mark.asyncio
async def test_catalog_uses_partner_then_bot_then_company_defaults(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-defaults@test.com")
    await _save_bot(client, token)
    account_id, company_id, _public_key = await _linked_account(
        session_factory, warehouse_id=11, price_type_id=12
    )
    async with session_factory() as session:
        from sqlalchemy import select

        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        bot.default_warehouse_id = 8
        bot.default_price_type_id = 9
        await session.commit()

    from app.core.security import create_partner_telegram_token

    access = create_partner_telegram_token(account_id=account_id, company_id=company_id)
    captured: list[dict] = []

    async def defaults(session, company_id):
        return {
            "warehouse": {"id": 3, "name": "Main"},
            "price_type": {"id": 4, "name": "Wholesale"},
            "currency": {"id": 1, "name": "UZS"},
        }

    async def regos(session, company_id, endpoint, payload):
        captured.append({"endpoint": endpoint, "payload": payload})
        return {"result": [], "next_offset": 0, "total": 0}

    async def warehouses(session, company_id):
        return {
            "warehouses": [{"id": 5, "name": "Shop"}, {"id": 3, "name": "Main"}],
            "price_types": [],
            "partners": [],
            "payment_categories": [],
            "refund_payment_categories": [],
            "attached_users": [],
            "firms": [],
        }

    monkeypatch.setattr("app.services.partner_telegram_webapp._shop_defaults", defaults)
    monkeypatch.setattr("app.services.partner_telegram_webapp.regos_async_api_request_for_company", regos)
    monkeypatch.setattr("app.services.partner_telegram_webapp.regos_defaults_service.list_reference_options", warehouses)

    response = await client.get(
        "/api/v1/partner-telegram/webapp/products?price_type_id=99&warehouse_id=5",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert response.status_code == 200, response.text
    assert captured[-1]["payload"]["stock_id"] == 11
    assert captured[-1]["payload"]["price_type_id"] == 12
    assert response.json()["price_type_id"] == 12

    async with session_factory() as session:
        account = await session.get(PartnerTelegramAccount, account_id)
        account.warehouse_id = None
        account.price_type_id = None
        await session.commit()

    response = await client.get(
        "/api/v1/partner-telegram/webapp/products?price_type_id=77",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert response.status_code == 200, response.text
    assert captured[-1]["payload"]["stock_id"] == 8
    assert captured[-1]["payload"]["price_type_id"] == 9

    async with session_factory() as session:
        from sqlalchemy import select

        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        bot.default_warehouse_id = None
        bot.default_price_type_id = None
        await session.commit()

    response = await client.get(
        "/api/v1/partner-telegram/webapp/products",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert captured[-1]["payload"]["stock_id"] == 3
    assert captured[-1]["payload"]["price_type_id"] == 4

    blocked = await client.get(
        "/api/v1/partner-telegram/webapp/products?warehouse_id=5",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert blocked.status_code == 200
    assert captured[-1]["payload"]["stock_id"] == 3

    async with session_factory() as session:
        from sqlalchemy import select

        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        bot.allow_catalog_warehouse_selection = True
        await session.commit()

    chosen = await client.get(
        "/api/v1/partner-telegram/webapp/products?warehouse_id=5&price_type_id=1",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert chosen.status_code == 200, chosen.text
    assert captured[-1]["payload"]["stock_id"] == 5
    assert captured[-1]["payload"]["price_type_id"] == 4

    rejected = await client.get(
        "/api/v1/partner-telegram/webapp/products?warehouse_id=99",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert rejected.status_code == 400
    assert rejected.json()["code"] == "PARTNER_WAREHOUSE_NOT_ALLOWED"


@pytest.mark.asyncio
async def test_catalog_uses_bot_defaults_when_company_settings_have_no_currency(
    client, monkeypatch, session_factory
):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-bot-defaults@test.com")
    await _save_bot(client, token)
    account_id, company_id, _public_key = await _linked_account(session_factory)
    async with session_factory() as session:
        from sqlalchemy import select

        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        bot.default_warehouse_id = 8
        bot.default_price_type_id = 9
        await session.commit()

    from app.core.security import create_partner_telegram_token

    access = create_partner_telegram_token(account_id=account_id, company_id=company_id)
    captured: list[dict] = []

    async def defaults(session, company_id):
        return {
            "warehouse": None,
            "price_type": None,
            "currency": None,
            "firm": None,
        }

    async def resolve_price(session, company_id, value):
        return (
            {"id": value, "name": "Wholesale"},
            {"id": 1, "name": "Uzbek som", "code_chr": "UZS", "exchange_rate": 1},
        )

    async def resolve_warehouse(session, company_id, value):
        return {"id": value, "name": "Main"}, {"id": 2, "name": "Firm"}

    async def regos(session, company_id, endpoint, payload):
        captured.append(payload)
        return {"result": [], "next_offset": 0, "total": 0}

    monkeypatch.setattr("app.services.partner_telegram_webapp._shop_defaults", defaults)
    monkeypatch.setattr(
        "app.services.partner_telegram_webapp.regos_defaults_service._resolve_price_type_reference",
        resolve_price,
    )
    monkeypatch.setattr(
        "app.services.partner_telegram_webapp.regos_defaults_service._resolve_warehouse_reference",
        resolve_warehouse,
    )
    monkeypatch.setattr("app.services.partner_telegram_webapp.regos_async_api_request_for_company", regos)

    response = await client.get(
        "/api/v1/partner-telegram/webapp/products",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert captured[-1]["stock_id"] == 8
    assert captured[-1]["price_type_id"] == 9
    assert body["currency_name"] == "Uzbek som"
    assert body["currency_code"] == "UZS"

    options = await client.get(
        "/api/v1/partner-telegram/webapp/catalog-options",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert options.status_code == 200, options.text
    assert options.json()["currency_code"] == "UZS"
    assert options.json()["show_product_quantities"] is True
    assert body["warehouse_id"] == 8
    assert body["price_type_id"] == 9


@pytest.mark.asyncio
async def test_password_login_uses_a_bot_code(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-password@test.com")
    saved = await _save_bot(client, token)
    account_id, _company_id, public_key = await _linked_account(session_factory)
    assert public_key == saved["public_key"]

    requested = await client.post(
        "/api/v1/partner-telegram/webapp/password/request",
        json={"public_key": public_key, "phone": "+998 90 111 22 33"},
    )
    assert requested.status_code == 200, requested.text

    async with session_factory() as session:
        from sqlalchemy import select

        from app.models import PartnerTelegramPasswordCode

        code = (await session.execute(select(PartnerTelegramPasswordCode))).scalar_one().code

    confirmed = await client.post(
        "/api/v1/partner-telegram/webapp/password/confirm",
        json={
            "public_key": public_key,
            "phone": "998901112233",
            "code": code,
            "password": "correct-horse",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["access_token"]

    signed_in = await client.post(
        "/api/v1/partner-telegram/webapp/login",
        json={"public_key": public_key, "phone": "998901112233", "password": "correct-horse"},
    )
    assert signed_in.status_code == 200
    wrong = await client.post(
        "/api/v1/partner-telegram/webapp/login",
        json={"public_key": public_key, "phone": "998901112233", "password": "wrong-password"},
    )
    assert wrong.status_code == 401
    assert wrong.json()["code"] == "PARTNER_LOGIN_INVALID"
    assert account_id


@pytest.mark.asyncio
async def test_self_registration_matches_or_creates_a_partner(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-register@test.com")
    saved = await _save_bot(client, token)
    created: list[dict] = []

    async def no_partners(session, company_id, **kwargs):
        return {"partners": [], "next_offset": 0, "total": 0}

    async def groups(session, company_id):
        return {"groups": [{"id": 3, "name": "Retail"}, {"id": 9, "name": "Other"}]}

    async def add_partner(session, company_id, body):
        created.append(body)
        return {"id": 41}

    async def partner_name(session, company_id, partner_id):
        return "Ada"

    monkeypatch.setattr("app.services.partner_telegram.regos_partners.list_partners", no_partners)
    monkeypatch.setattr("app.services.partner_telegram.regos_partners.list_partner_groups", groups)
    monkeypatch.setattr("app.services.partner_telegram.regos_partners.add_partner", add_partner)
    monkeypatch.setattr("app.services.partner_telegram._partner_name", partner_name)

    secret = saved["webhook_url"].rstrip("/").split("/")[-1]
    await client.post(f"/api/v1/partner-telegram/webhook/{secret}", json={
        "message": {
            "chat": {"id": 90, "type": "private"},
            "from": {"id": 90, "first_name": "Ada", "last_name": "Lovelace"},
            "contact": {"phone_number": "+998901110000", "user_id": 90},
        }
    })
    await client.post(f"/api/v1/partner-telegram/webhook/{secret}", json={
        "callback_query": {
            "id": "cb",
            "data": "ptlang:en",
            "from": {"id": 90},
            "message": {"chat": {"id": 90, "type": "private"}},
        }
    })
    accounts = await client.get(
        "/api/v1/partner-telegram/accounts",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert accounts.json()[0]["link_state"] == "unlinked"
    assert created == []

    async with session_factory() as session:
        from sqlalchemy import select

        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        bot.allow_self_registration = True
        await session.commit()

    await client.post(f"/api/v1/partner-telegram/webhook/{secret}", json={
        "callback_query": {
            "id": "cb2",
            "data": "ptlang:en",
            "from": {"id": 90},
            "message": {"chat": {"id": 90, "type": "private"}},
        }
    })
    accounts = await client.get(
        "/api/v1/partner-telegram/accounts",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert accounts.status_code == 200
    assert accounts.json()[0]["link_state"] == "linked"
    assert accounts.json()[0]["regos_partner_id"] == 41
    assert created[-1]["legal_status"] == "Natural"
    assert created[-1]["group_id"] == 3
    assert created[-1]["name"] == "Ada Lovelace"
    assert created[-1]["phones"] == "+998901110000"

    async with session_factory() as session:
        from sqlalchemy import select

        account = (await session.execute(select(PartnerTelegramAccount))).scalar_one()
        account.link_state = PartnerTelegramLinkState.unlinked.value
        account.regos_partner_id = None
        account.phone = "998909990099"
        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        bot.default_partner_group_id = 9
        await session.commit()
        public_key = bot.public_key

    async def one_partner(session, company_id, **kwargs):
        return {
            "partners": [{"id": 55, "name": "Matched", "phones": "998909990099"}],
            "next_offset": 0,
            "total": 1,
        }

    monkeypatch.setattr("app.services.partner_telegram.regos_partners.list_partners", one_partner)
    requested = await client.post(
        "/api/v1/partner-telegram/webapp/password/request",
        json={"public_key": public_key, "phone": "998909990099"},
    )
    assert requested.status_code == 200, requested.text
    async with session_factory() as session:
        from sqlalchemy import select

        from app.models import PartnerTelegramPasswordCode

        code = (await session.execute(select(PartnerTelegramPasswordCode))).scalar_one().code
    confirmed = await client.post(
        "/api/v1/partner-telegram/webapp/password/confirm",
        json={
            "public_key": public_key,
            "phone": "998909990099",
            "code": code,
            "password": "correct-horse",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["account"]["regos_partner_id"] == 55
    assert confirmed.json()["account"]["link_state"] == "linked"
    assert len(created) == 1


def test_resolve_enabled_pages_merges_bot_defaults_and_overrides():
    from app.services.partner_telegram import resolve_enabled_pages

    pages = resolve_enabled_pages(
        {"catalog": True, "orders": False, "unknown": False},
        {"orders": True, "payments": False, "create_orders": False},
    )
    assert pages["catalog"] is True
    assert pages["create_orders"] is False
    assert pages["orders"] is True
    assert pages["payments"] is False
    assert pages["dashboard"] is True
    assert "unknown" not in pages

    defaults = resolve_enabled_pages({}, {})
    assert defaults["create_orders"] is True


@pytest.mark.asyncio
async def test_partner_bot_saves_enabled_pages(client, monkeypatch):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-pages@test.com")
    saved = await _save_bot(client, token)
    assert saved["enabled_pages"]["catalog"] is True
    assert saved["enabled_pages"]["create_orders"] is True
    assert saved["enabled_pages"]["payments"] is True

    updated = await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(
            enabled_pages={
                "catalog": True,
                "create_orders": False,
                "dashboard": False,
                "orders": True,
                "purchases": False,
                "purchase_returns": True,
                "shipments": True,
                "shipment_returns": False,
                "payments": False,
                "reconciliation": True,
            }
        ),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert updated.status_code == 200, updated.text
    pages = updated.json()["enabled_pages"]
    assert pages["catalog"] is True
    assert pages["create_orders"] is False
    assert pages["dashboard"] is False
    assert pages["purchases"] is False
    assert pages["payments"] is False
    assert pages["reconciliation"] is True


@pytest.mark.asyncio
async def test_account_page_overrides_and_webapp_guard(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-page-override@test.com")
    await _save_bot(client, token)
    await client.patch(
        "/api/v1/partner-telegram/bot/settings",
        json=_settings_body(
            enabled_pages={
                "catalog": True,
                "dashboard": True,
                "orders": True,
                "purchases": True,
                "purchase_returns": True,
                "shipments": True,
                "shipment_returns": True,
                "payments": False,
                "reconciliation": True,
            }
        ),
        headers={"Authorization": f"Bearer {token}"},
    )
    account_id, company_id, _public_key = await _linked_account(session_factory)

    accounts = await client.get(
        "/api/v1/partner-telegram/accounts",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert accounts.status_code == 200, accounts.text
    row = next(item for item in accounts.json() if item["id"] == account_id)
    assert row["page_overrides"] == {}
    assert row["enabled_pages"]["payments"] is False
    assert row["enabled_pages"]["catalog"] is True

    patched = await client.patch(
        f"/api/v1/partner-telegram/accounts/{account_id}",
        json={"page_overrides": {"payments": True, "catalog": False}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["page_overrides"] == {"payments": True, "catalog": False}
    assert patched.json()["enabled_pages"]["payments"] is True
    assert patched.json()["enabled_pages"]["catalog"] is False

    cleared = await client.patch(
        f"/api/v1/partner-telegram/accounts/{account_id}",
        json={"page_overrides": {}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["page_overrides"] == {}
    assert cleared.json()["enabled_pages"]["payments"] is False

    from app.core.security import create_partner_telegram_token

    access = create_partner_telegram_token(account_id=account_id, company_id=company_id)

    async def defaults(session, company_id):
        return {
            "warehouse": {"id": 3, "name": "Main"},
            "price_type": {"id": 4, "name": "Wholesale"},
            "currency": {"id": 1, "name": "UZS"},
        }

    async def empty_products(session, company_id, endpoint, payload):
        return {"result": [], "next_offset": 0, "total": 0}

    monkeypatch.setattr("app.services.partner_telegram_webapp._shop_defaults", defaults)
    monkeypatch.setattr(
        "app.services.partner_telegram_webapp.regos_async_api_request_for_company",
        empty_products,
    )

    blocked = await client.get(
        "/api/v1/partner-telegram/webapp/payments",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert blocked.status_code == 403
    assert blocked.json()["code"] == "PARTNER_PAGE_DISABLED"

    allowed = await client.get(
        "/api/v1/partner-telegram/webapp/products",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert allowed.status_code == 200, allowed.text

    await client.patch(
        f"/api/v1/partner-telegram/accounts/{account_id}",
        json={"page_overrides": {"catalog": False}},
        headers={"Authorization": f"Bearer {token}"},
    )
    catalog_blocked = await client.get(
        "/api/v1/partner-telegram/webapp/products",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert catalog_blocked.status_code == 403
    assert catalog_blocked.json()["code"] == "PARTNER_PAGE_DISABLED"


@pytest.mark.asyncio
async def test_import_accounts_from_oked_and_custom_field(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-import@test.com")
    await _save_bot(client, token)
    auth = {"Authorization": f"Bearer {token}"}

    async def fake_custom_fields(session, company_id):
        return [{"id": 3, "key": "tg_id", "name": "Telegram ID", "entity_type": "Partner", "data_type": "string"}]

    monkeypatch.setattr(
        "app.services.partner_telegram.regos_fields_service.list_partner_custom_fields",
        fake_custom_fields,
    )

    fields = await client.get("/api/v1/partner-telegram/accounts/import-fields", headers=auth)
    assert fields.status_code == 200, fields.text
    field_ids = {item["id"] for item in fields.json()["fields"]}
    assert "oked" in field_ids
    assert "field:tg_id" in field_ids

    async def partners_page(session, company_id, **kwargs):
        return {
            "partners": [
                {"id": 1, "name": "Valid", "oked": "501001", "phones": "+998901111111", "fields": []},
                {"id": 2, "name": "Empty", "oked": None, "fields": []},
                {"id": 3, "name": "Invalid", "oked": "not-a-id", "fields": []},
                {
                    "id": 4,
                    "name": "Custom",
                    "oked": None,
                    "fields": [{"id": 3, "key": "tg_id", "name": "Telegram ID", "value": "777001"}],
                },
            ],
            "next_offset": 0,
            "total": 4,
        }

    monkeypatch.setattr("app.services.partner_telegram.regos_partners.list_partners", partners_page)

    first = await client.post(
        "/api/v1/partner-telegram/accounts/import-from-field",
        json={"field_id": "oked"},
        headers=auth,
    )
    assert first.status_code == 200, first.text
    assert first.json() == {
        "created": 1,
        "already_imported": 0,
        "skipped_empty": 2,
        "skipped_invalid": 1,
        "skipped_duplicate": 0,
        "skipped_partner_linked": 0,
        "total_partners": 4,
    }

    again = await client.post(
        "/api/v1/partner-telegram/accounts/import-from-field",
        json={"field_id": "oked"},
        headers=auth,
    )
    assert again.status_code == 200, again.text
    assert again.json()["created"] == 0
    assert again.json()["already_imported"] == 1
    assert again.json()["skipped_empty"] == 2
    assert again.json()["skipped_invalid"] == 1

    custom = await client.post(
        "/api/v1/partner-telegram/accounts/import-from-field",
        json={"field_id": "field:tg_id"},
        headers=auth,
    )
    assert custom.status_code == 200, custom.text
    assert custom.json()["created"] == 1
    assert custom.json()["skipped_empty"] == 3

    accounts = await client.get("/api/v1/partner-telegram/accounts", headers=auth)
    assert accounts.status_code == 200
    by_telegram = {row["telegram_user_id"]: row for row in accounts.json()}
    assert by_telegram[501001]["regos_partner_id"] == 1
    assert by_telegram[501001]["link_state"] == "linked"
    assert by_telegram[501001]["phone"] == "+998901111111"
    assert by_telegram[777001]["regos_partner_id"] == 4
    assert by_telegram[777001]["link_state"] == "linked"


@pytest.mark.asyncio
async def test_import_adds_partner_to_existing_telegram_and_allows_multi_telegram(
    client, monkeypatch, session_factory
):
    _mock_telegram_api(monkeypatch)
    token = await _owner_token(client, "partner-import-dup@test.com")
    await _save_bot(client, token)
    auth = {"Authorization": f"Bearer {token}"}

    async with session_factory() as session:
        from sqlalchemy import select

        bot = (await session.execute(select(PartnerTelegramBot))).scalar_one()
        session.add(
            _make_account(
                company_id=bot.company_id,
                bot_id=bot.id,
                telegram_user_id=9001,
                chat_id=9001,
                regos_partner_id=10,
                link_state=PartnerTelegramLinkState.linked.value,
            )
        )
        session.add(
            _make_account(
                company_id=bot.company_id,
                bot_id=bot.id,
                telegram_user_id=9002,
                chat_id=9002,
                regos_partner_id=20,
                link_state=PartnerTelegramLinkState.linked.value,
            )
        )
        await session.commit()

    async def partners_page(session, company_id, **kwargs):
        return {
            "partners": [
                {"id": 11, "name": "DupTelegram", "oked": "9001", "fields": []},
                {"id": 20, "name": "AlreadyLinkedPartner", "oked": "9003", "fields": []},
            ],
            "next_offset": 0,
            "total": 2,
        }

    monkeypatch.setattr("app.services.partner_telegram.regos_partners.list_partners", partners_page)

    response = await client.post(
        "/api/v1/partner-telegram/accounts/import-from-field",
        json={"field_id": "oked"},
        headers=auth,
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "created": 2,
        "already_imported": 0,
        "skipped_empty": 0,
        "skipped_invalid": 0,
        "skipped_duplicate": 0,
        "skipped_partner_linked": 0,
        "total_partners": 2,
    }

    accounts = await client.get("/api/v1/partner-telegram/accounts", headers=auth)
    assert accounts.status_code == 200
    by_telegram = {row["telegram_user_id"]: row for row in accounts.json()}
    assert {item["id"] for item in by_telegram[9001]["partners"]} == {10, 11}
    assert by_telegram[9001]["regos_partner_id"] == 10
    assert by_telegram[9003]["regos_partner_id"] == 20
    assert by_telegram[9003]["link_state"] == "linked"
