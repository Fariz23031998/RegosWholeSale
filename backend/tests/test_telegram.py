import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import TelegramBot, TelegramUser
from tests.helpers import register_owner


@pytest.fixture(autouse=True)
def telegram_env(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_BASE_URL", "https://example.com")
    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def _register_and_login(client: AsyncClient, email: str, company_name: str = "Test Co"):
    reg = await register_owner(
        client,
        email=email,
        company_name=company_name,
    )
    assert reg.status_code == 200
    return reg.json()["access_token"]


def _mock_telegram_api(monkeypatch):
    async def fake_call(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "getMe":
            return {"ok": True, "result": {"id": 1, "username": "test_bot", "is_bot": True}}
        if method == "setWebhook":
            assert payload and payload.get("url", "").startswith("https://example.com/api/v1/telegram/webhook/")
            assert payload.get("allowed_updates") == ["message", "callback_query", "my_chat_member"]
            return {"ok": True, "result": True, "description": "Webhook was set"}
        if method == "deleteWebhook":
            return {"ok": True, "result": True, "description": "Webhook was deleted"}
        if method == "sendMessage":
            return {"ok": True, "result": {"message_id": 1}}
        if method == "answerCallbackQuery":
            return {"ok": True, "result": True}
        raise AssertionError(f"Unexpected Telegram API method: {method}")

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_call)


@pytest.mark.asyncio
async def test_save_telegram_bot_registers_webhook(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "owner-telegram@test.com")

    response = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "123456:ABC-DEF"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Telegram bot saved and webhook registered"
    assert data["bot"]["configured"] is True
    assert data["bot"]["bot_username"] == "test_bot"
    assert data["bot"]["token_masked"].endswith("DEF")

    get_response = await client.get(
        "/api/v1/telegram/bot",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert get_response.status_code == 200
    assert get_response.json()["configured"] is True


@pytest.mark.asyncio
async def test_save_telegram_bot_requires_webhook_base_url(client, monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_BASE_URL", "")
    from app.config import get_settings

    get_settings.cache_clear()
    token = await _register_and_login(client, "nowebhook-telegram@test.com")

    response = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "123456:ABC-DEF"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "TELEGRAM_WEBHOOK_NOT_CONFIGURED"


@pytest.mark.asyncio
async def test_webhook_start_creates_user(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "webhook-telegram@test.com")

    save_response = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "123456:ABC-DEF"},
        headers={"Authorization": f"Bearer {token}"},
    )
    webhook_secret = save_response.json()["bot"]["webhook_url"].split("/")[-1]

    update = {
        "update_id": 1,
        "message": {
            "message_id": 10,
            "from": {
                "id": 999888,
                "is_bot": False,
                "first_name": "Alice",
                "last_name": "Smith",
                "username": "alice",
                "language_code": "en",
            },
            "chat": {"id": 999888, "type": "private", "first_name": "Alice", "username": "alice"},
            "text": "/start",
        },
    }

    webhook_response = await client.post(
        f"/api/v1/telegram/webhook/{webhook_secret}",
        json=update,
        headers={"X-Telegram-Bot-Api-Secret-Token": webhook_secret},
    )
    assert webhook_response.status_code == 200
    assert webhook_response.json()["ok"] is True

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser))
        users = list(result.scalars().all())
        assert len(users) == 1
        assert users[0].telegram_user_id == 999888
        assert users[0].chat_id == 999888
        assert users[0].chat_type == "private"
        assert users[0].username == "alice"
        assert users[0].first_name == "Alice"
        assert users[0].is_active is False


@pytest.mark.asyncio
async def test_webhook_start_is_idempotent(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "idempotent-telegram@test.com")

    save_response = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "123456:ABC-DEF"},
        headers={"Authorization": f"Bearer {token}"},
    )
    webhook_secret = save_response.json()["bot"]["webhook_url"].split("/")[-1]

    update = {
        "update_id": 2,
        "message": {
            "message_id": 11,
            "from": {
                "id": 777666,
                "is_bot": False,
                "first_name": "Bob",
                "username": "bob",
            },
            "chat": {"id": 777666, "type": "private", "first_name": "Bob"},
            "text": "/start",
        },
    }

    for _ in range(2):
        response = await client.post(
            f"/api/v1/telegram/webhook/{webhook_secret}",
            json=update,
        )
        assert response.status_code == 200

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser))
        users = list(result.scalars().all())
        assert len(users) == 1
        assert users[0].username == "bob"
        assert users[0].is_active is False


@pytest.mark.asyncio
async def test_webhook_start_does_not_reactivate_inactive_user(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "reactivate-telegram@test.com")

    save_response = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "123456:ABC-DEF"},
        headers={"Authorization": f"Bearer {token}"},
    )
    webhook_secret = save_response.json()["bot"]["webhook_url"].split("/")[-1]

    update = {
        "update_id": 7,
        "message": {
            "message_id": 14,
            "from": {
                "id": 333222,
                "is_bot": False,
                "first_name": "Eve",
                "username": "eve",
            },
            "chat": {"id": 333222, "type": "private", "first_name": "Eve"},
            "text": "/start",
        },
    }

    await client.post(f"/api/v1/telegram/webhook/{webhook_secret}", json=update)

    list_response = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    user_id = list_response.json()[0]["id"]
    assert list_response.json()[0]["is_active"] is False

    activate_response = await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={"is_active": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert activate_response.status_code == 200
    assert activate_response.json()["is_active"] is True

    deactivate_response = await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={"is_active": False},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert deactivate_response.status_code == 200

    await client.post(f"/api/v1/telegram/webhook/{webhook_secret}", json=update)

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser))
        user = result.scalar_one()
        assert user.is_active is False


@pytest.mark.asyncio
async def test_list_telegram_users_scoped_to_company(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)

    token_a = await _register_and_login(client, "company-a-telegram@test.com", "Company A")
    save_a = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "111111:AAA"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    secret_a = save_a.json()["bot"]["webhook_url"].split("/")[-1]

    token_b = await _register_and_login(client, "company-b-telegram@test.com", "Company B")
    save_b = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "222222:BBB"},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    secret_b = save_b.json()["bot"]["webhook_url"].split("/")[-1]

    await client.post(
        f"/api/v1/telegram/webhook/{secret_a}",
        json={
            "update_id": 3,
            "message": {
                "message_id": 1,
                "from": {"id": 100, "is_bot": False, "first_name": "A-user"},
                "chat": {"id": 100, "type": "private"},
                "text": "/start",
            },
        },
    )
    await client.post(
        f"/api/v1/telegram/webhook/{secret_b}",
        json={
            "update_id": 4,
            "message": {
                "message_id": 2,
                "from": {"id": 200, "is_bot": False, "first_name": "B-user"},
                "chat": {"id": 200, "type": "private"},
                "text": "/start",
            },
        },
    )

    list_a = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert list_a.status_code == 200
    users_a = list_a.json()
    assert len(users_a) == 1
    assert users_a[0]["first_name"] == "A-user"

    list_b = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert list_b.status_code == 200
    users_b = list_b.json()
    assert len(users_b) == 1
    assert users_b[0]["first_name"] == "B-user"


@pytest.mark.asyncio
async def test_webhook_unknown_secret_returns_404(client):
    response = await client.post(
        "/api/v1/telegram/webhook/unknown-secret",
        json={"update_id": 1, "message": {"text": "/start"}},
    )
    assert response.status_code == 404
    assert response.json()["code"] == "TELEGRAM_WEBHOOK_NOT_FOUND"


@pytest.mark.asyncio
async def test_delete_telegram_bot(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "delete-telegram@test.com")

    save_response = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "123456:ABC-DEF"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert save_response.status_code == 200

    delete_response = await client.delete(
        "/api/v1/telegram/bot",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert delete_response.status_code == 200

    async with session_factory() as session:
        result = await session.execute(select(TelegramBot))
        assert result.scalar_one_or_none() is None

    get_response = await client.get(
        "/api/v1/telegram/bot",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert get_response.json()["configured"] is False


@pytest.mark.asyncio
async def test_list_notification_types(client):
    token = await _register_and_login(client, "notification-types@test.com")

    response = await client.get(
        "/api/v1/telegram/notification-types",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    payload = response.json()
    types = payload["types"]
    assert "purchase_performed" in types
    assert "wholesale_performed" in types
    assert "payment_performed" in types
    assert "categories" in payload
    pos_cheque = next(item for item in payload["categories"] if item["id"] == "pos_cheque")
    assert set(pos_cheque["subcategories"]) == {
        "pos_cheque_closed",
        "pos_cheque_cancelled",
        "pos_cheque_return",
    }


@pytest.mark.asyncio
async def test_update_telegram_user_notification_types(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "update-notifications@test.com")

    save_response = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "123456:ABC-DEF"},
        headers={"Authorization": f"Bearer {token}"},
    )
    webhook_secret = save_response.json()["bot"]["webhook_url"].split("/")[-1]

    await client.post(
        f"/api/v1/telegram/webhook/{webhook_secret}",
        json={
            "update_id": 5,
            "message": {
                "message_id": 12,
                "from": {"id": 555444, "is_bot": False, "first_name": "Carol"},
                "chat": {"id": 555444, "type": "private"},
                "text": "/start",
            },
        },
    )

    from app.services.telegram_notifications import ALL_NOTIFICATION_TYPES

    list_response = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    user_id = list_response.json()[0]["id"]
    assert set(list_response.json()[0]["notification_types"]) == set(ALL_NOTIFICATION_TYPES)

    update_response = await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={
            "notification_types": ["wholesale_performed", "payment_performed"],
            "receipt_language": "en",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert update_response.status_code == 200
    assert set(update_response.json()["notification_types"]) == {
        "payment_performed",
        "wholesale_performed",
    }
    assert update_response.json()["receipt_language"] == "en"

    legacy_update = await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={"notification_types": ["pos_cheque"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert legacy_update.status_code == 422

    empty_update = await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert empty_update.status_code == 400
    assert empty_update.json()["code"] == "TELEGRAM_USER_UPDATE_EMPTY"


@pytest.mark.asyncio
async def test_update_telegram_user_scope_filters(client, monkeypatch):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "scope-user-telegram@test.com")

    save_response = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "123456:ABC-DEF"},
        headers={"Authorization": f"Bearer {token}"},
    )
    webhook_secret = save_response.json()["bot"]["webhook_url"].split("/")[-1]

    await client.post(
        f"/api/v1/telegram/webhook/{webhook_secret}",
        json={
            "update_id": 50,
            "message": {
                "message_id": 50,
                "from": {"id": 777666, "is_bot": False, "first_name": "Scope"},
                "chat": {"id": 777666, "type": "private"},
                "text": "/start",
            },
        },
    )

    list_response = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    user_id = list_response.json()[0]["id"]
    assert list_response.json()[0]["stock_ids"] == []
    assert list_response.json()[0]["cashier_ids"] == []
    assert list_response.json()[0]["firm_ids"] == []

    update_response = await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={"stock_ids": [10, 11], "cashier_ids": [5], "firm_ids": [4]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["stock_ids"] == [10, 11]
    assert update_response.json()["cashier_ids"] == [5]
    assert update_response.json()["firm_ids"] == [4]

    clear_response = await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={"stock_ids": [], "cashier_ids": [], "firm_ids": []},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert clear_response.status_code == 200
    assert clear_response.json()["stock_ids"] == []
    assert clear_response.json()["cashier_ids"] == []
    assert clear_response.json()["firm_ids"] == []


@pytest.mark.asyncio
async def test_delete_telegram_user(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "delete-user-telegram@test.com")

    save_response = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "123456:ABC-DEF"},
        headers={"Authorization": f"Bearer {token}"},
    )
    webhook_secret = save_response.json()["bot"]["webhook_url"].split("/")[-1]

    await client.post(
        f"/api/v1/telegram/webhook/{webhook_secret}",
        json={
            "update_id": 6,
            "message": {
                "message_id": 13,
                "from": {"id": 444333, "is_bot": False, "first_name": "Dave"},
                "chat": {"id": 444333, "type": "private"},
                "text": "/start",
            },
        },
    )

    list_response = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    user_id = list_response.json()[0]["id"]

    delete_response = await client.delete(
        f"/api/v1/telegram/users/{user_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["message"] == "Telegram user deleted"

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser))
        assert result.scalar_one_or_none() is None

    list_after = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert list_after.json() == []


@pytest.mark.asyncio
async def test_delete_telegram_user_not_found(client):
    token = await _register_and_login(client, "delete-missing-telegram@test.com")

    response = await client.delete(
        "/api/v1/telegram/users/999999",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404
    assert response.json()["code"] == "TELEGRAM_USER_NOT_FOUND"


@pytest.mark.asyncio
async def test_send_document_returns_false_on_api_error(monkeypatch):
    class FakeResponse:
        async def json(self):
            return {"ok": False, "description": "bad"}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class FakeClientSession:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def post(self, url, data=None):
            return FakeResponse()

    monkeypatch.setattr("app.services.telegram.aiohttp.ClientSession", FakeClientSession)

    from app.services.telegram import send_document

    assert await send_document("token", 1, b"x", "report.xlsx") is False


def test_split_telegram_message_returns_single_chunk_when_under_limit():
    from app.services.telegram import split_telegram_message, telegram_text_units

    text = "hello\nworld"
    assert split_telegram_message(text) == [text]
    assert telegram_text_units(text) <= 4096


def test_split_telegram_message_splits_at_line_boundaries():
    from app.services.telegram import TELEGRAM_MESSAGE_MAX_LENGTH, split_telegram_message, telegram_text_units

    line = "x" * 100
    lines = [line] * 50
    text = "\n".join(lines)
    chunks = split_telegram_message(text)

    assert len(chunks) > 1
    assert "".join(chunks) == text
    for chunk in chunks[:-1]:
        assert chunk.endswith("\n")
        assert len(chunk) <= TELEGRAM_MESSAGE_MAX_LENGTH
        assert telegram_text_units(chunk) <= TELEGRAM_MESSAGE_MAX_LENGTH
    assert len(chunks[-1]) <= TELEGRAM_MESSAGE_MAX_LENGTH
    assert telegram_text_units(chunks[-1]) <= TELEGRAM_MESSAGE_MAX_LENGTH


def test_split_telegram_message_hard_splits_when_line_exceeds_limit():
    from app.services.telegram import TELEGRAM_MESSAGE_MAX_LENGTH, split_telegram_message, telegram_text_units

    text = "a" * (TELEGRAM_MESSAGE_MAX_LENGTH + 100)
    chunks = split_telegram_message(text)

    assert len(chunks) == 2
    assert chunks[0] == "a" * TELEGRAM_MESSAGE_MAX_LENGTH
    assert chunks[1] == "a" * 100
    assert "".join(chunks) == text
    for chunk in chunks:
        assert telegram_text_units(chunk) <= TELEGRAM_MESSAGE_MAX_LENGTH


def test_split_telegram_message_respects_utf16_units():
    from app.services.telegram import TELEGRAM_MESSAGE_MAX_LENGTH, split_telegram_message, telegram_text_units

    # One emoji is 1 Python character but 2 UTF-16 code units.
    text = "🧾" + ("x" * 4095)
    assert len(text) == TELEGRAM_MESSAGE_MAX_LENGTH
    assert telegram_text_units(text) == TELEGRAM_MESSAGE_MAX_LENGTH + 1

    chunks = split_telegram_message(text)
    assert len(chunks) == 2
    assert "".join(chunks) == text
    for chunk in chunks:
        assert telegram_text_units(chunk) <= TELEGRAM_MESSAGE_MAX_LENGTH


def test_split_telegram_message_23_item_receipt():
    from app.services.document_telegram_format import format_partner_receipt
    from app.services.telegram import TELEGRAM_MESSAGE_MAX_LENGTH, split_telegram_message, telegram_text_units

    doc = {
        "code": "PUR-00123",
        "date": 1700000000,
        "partner": {"name": "ООО Торговый дом", "phone": "+998901234567"},
        "currency": {"name": "UZS"},
        "exchange_rate": 12650.25,
        "attached_user": {"full_name": "Иванов Иван"},
    }
    long_name = "Консервированные овощи марка Premium Quality 500г упаковка 24шт арт. ABC-12345"
    note = "Партия № 2024/15, срок годности до 12.2026"
    operations = [
        {
            "quantity": 1234.56,
            "cost": 12500.5,
            "item": {"name": f"{long_name} #{index}"},
            "description": note,
        }
        for index in range(1, 24)
    ]

    message = format_partner_receipt(
        doc,
        operations,
        "Склад основной",
        use_cost=True,
        lang="ru",
    )
    chunks = split_telegram_message(message)

    assert len(chunks) > 1
    assert "".join(chunks) == message
    for chunk in chunks:
        assert telegram_text_units(chunk) <= TELEGRAM_MESSAGE_MAX_LENGTH


def test_split_telegram_message_91_short_item_receipt_respects_entity_limit():
    from app.services.document_telegram_format import format_partner_receipt
    from app.services.telegram import (
        TELEGRAM_MESSAGE_MAX_LENGTH,
        TELEGRAM_SAFE_FORMATTING_ENTITIES,
        _estimate_markdown_entities,
        split_telegram_message,
        telegram_text_units,
    )

    doc = {
        "code": "PUR-00091",
        "date": 1700000000,
        "partner": {"name": "Supplier"},
        "currency": {"name": "UZS"},
    }
    operations = [
        {"quantity": 1, "cost": 100, "item": {"name": f"Item {index}"}}
        for index in range(1, 92)
    ]
    message = format_partner_receipt(
        doc,
        operations,
        "Main warehouse",
        use_cost=True,
        lang="en",
    )
    chunks = split_telegram_message(message)

    assert len(chunks) > 1
    assert "".join(chunks) == message
    for chunk in chunks:
        assert telegram_text_units(chunk) <= TELEGRAM_MESSAGE_MAX_LENGTH
        assert _estimate_markdown_entities(chunk) <= TELEGRAM_SAFE_FORMATTING_ENTITIES


@pytest.mark.asyncio
async def test_send_message_splits_long_text(monkeypatch):
    from app.services.telegram import TELEGRAM_MESSAGE_MAX_LENGTH, send_message, telegram_text_units

    sent_texts: list[str] = []

    async def fake_api_call(bot_token, method, payload=None):
        assert method == "sendMessage"
        sent_texts.append(payload["text"])
        return {"ok": True, "result": {"message_id": len(sent_texts)}}

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_api_call)

    line = "line\n"
    text = line * (TELEGRAM_MESSAGE_MAX_LENGTH // len(line) + 10)
    assert await send_message("token", 1, text) is True
    assert len(sent_texts) > 1
    assert "".join(sent_texts) == text
    for chunk in sent_texts[:-1]:
        assert chunk.endswith("\n")
        assert len(chunk) <= TELEGRAM_MESSAGE_MAX_LENGTH
        assert telegram_text_units(chunk) <= TELEGRAM_MESSAGE_MAX_LENGTH


@pytest.mark.asyncio
async def test_send_message_retries_without_parse_mode_on_failure(monkeypatch):
    from app.core.exceptions import bad_request
    from app.services.telegram import send_message

    payloads: list[dict] = []

    async def fake_api_call(bot_token, method, payload=None):
        assert method == "sendMessage"
        payloads.append(dict(payload or {}))
        if "parse_mode" in payload:
            raise bad_request("Can't parse entities", "TELEGRAM_API_ERROR")
        return {"ok": True, "result": {"message_id": len(payloads)}}

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_api_call)

    assert await send_message("token", 1, "hello *world*") is True
    assert len(payloads) == 2
    assert payloads[0]["parse_mode"] == "Markdown"
    assert "parse_mode" not in payloads[1]
    assert payloads[1]["text"] == "hello *world*"


@pytest.mark.asyncio
async def test_send_message_reply_markup_only_on_first_chunk(monkeypatch):
    from app.services.telegram import TELEGRAM_MESSAGE_MAX_LENGTH, send_message

    payloads: list[dict] = []

    async def fake_api_call(bot_token, method, payload=None):
        payloads.append(payload)
        return {"ok": True, "result": {"message_id": len(payloads)}}

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_api_call)

    markup = {"inline_keyboard": [[{"text": "Go", "callback_data": "go"}]]}
    text = ("x\n" * (TELEGRAM_MESSAGE_MAX_LENGTH // 2)) + "tail"
    assert await send_message("token", 1, text, reply_markup=markup) is True
    assert len(payloads) > 1
    assert payloads[0]["reply_markup"] == markup
    assert "reply_markup" not in payloads[1]


GROUP_START_UPDATE = {
    "update_id": 100,
    "message": {
        "message_id": 50,
        "from": {
            "id": 111222,
            "is_bot": False,
            "first_name": "Admin",
            "username": "groupadmin",
            "language_code": "en",
        },
        "chat": {
            "id": -1001234567890,
            "type": "supergroup",
            "title": "Warehouse Alerts",
        },
        "text": "/start@test_bot",
    },
}


async def _save_bot_and_get_secret(client: AsyncClient, token: str) -> str:
    save_response = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "123456:ABC-DEF"},
        headers={"Authorization": f"Bearer {token}"},
    )
    return save_response.json()["bot"]["webhook_url"].split("/")[-1]


@pytest.mark.asyncio
async def test_webhook_start_creates_supergroup_subscriber(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "group-telegram@test.com")
    webhook_secret = await _save_bot_and_get_secret(client, token)

    response = await client.post(
        f"/api/v1/telegram/webhook/{webhook_secret}",
        json=GROUP_START_UPDATE,
    )
    assert response.status_code == 200

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser))
        users = list(result.scalars().all())
        assert len(users) == 1
        assert users[0].chat_id == -1001234567890
        assert users[0].chat_type == "supergroup"
        assert users[0].title == "Warehouse Alerts"
        assert users[0].telegram_user_id == 111222
        assert users[0].is_active is False


@pytest.mark.asyncio
async def test_webhook_start_does_not_reactivate_inactive_group(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "reactivate-group-telegram@test.com")
    webhook_secret = await _save_bot_and_get_secret(client, token)

    await client.post(f"/api/v1/telegram/webhook/{webhook_secret}", json=GROUP_START_UPDATE)

    list_response = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    user_id = list_response.json()[0]["id"]
    assert list_response.json()[0]["chat_type"] == "supergroup"

    await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={"is_active": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={"is_active": False},
        headers={"Authorization": f"Bearer {token}"},
    )

    updated = {**GROUP_START_UPDATE, "message": {**GROUP_START_UPDATE["message"], "chat": {
        **GROUP_START_UPDATE["message"]["chat"],
        "title": "Renamed Alerts",
    }}}
    await client.post(f"/api/v1/telegram/webhook/{webhook_secret}", json=updated)

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser))
        user = result.scalar_one()
        assert user.is_active is False
        assert user.title == "Renamed Alerts"


@pytest.mark.asyncio
async def test_my_chat_member_add_creates_pending_group(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "my-chat-member-add@test.com")
    webhook_secret = await _save_bot_and_get_secret(client, token)

    update = {
        "update_id": 101,
        "my_chat_member": {
            "chat": {
                "id": -1009876543210,
                "type": "supergroup",
                "title": "Sales Team",
            },
            "new_chat_member": {
                "user": {"id": 1, "is_bot": True, "username": "test_bot"},
                "status": "member",
            },
        },
    }
    response = await client.post(f"/api/v1/telegram/webhook/{webhook_secret}", json=update)
    assert response.status_code == 200

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser))
        user = result.scalar_one()
        assert user.chat_id == -1009876543210
        assert user.title == "Sales Team"
        assert user.telegram_user_id == 0
        assert user.is_active is False


@pytest.mark.asyncio
async def test_my_chat_member_removal_deactivates_group(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "my-chat-member-remove@test.com")
    webhook_secret = await _save_bot_and_get_secret(client, token)

    await client.post(f"/api/v1/telegram/webhook/{webhook_secret}", json=GROUP_START_UPDATE)

    list_response = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    user_id = list_response.json()[0]["id"]
    await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={"is_active": True},
        headers={"Authorization": f"Bearer {token}"},
    )

    removal_update = {
        "update_id": 102,
        "my_chat_member": {
            "chat": GROUP_START_UPDATE["message"]["chat"],
            "new_chat_member": {
                "user": {"id": 1, "is_bot": True, "username": "test_bot"},
                "status": "left",
            },
        },
    }
    await client.post(f"/api/v1/telegram/webhook/{webhook_secret}", json=removal_update)

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser))
        user = result.scalar_one()
        assert user.is_active is False


@pytest.mark.asyncio
async def test_notify_company_subscribers_sends_to_active_group(client, monkeypatch, session_factory):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "notify-group-telegram@test.com")
    webhook_secret = await _save_bot_and_get_secret(client, token)

    await client.post(f"/api/v1/telegram/webhook/{webhook_secret}", json=GROUP_START_UPDATE)

    list_response = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    user_id = list_response.json()[0]["id"]
    await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={"is_active": True, "notification_types": ["payment_performed"]},
        headers={"Authorization": f"Bearer {token}"},
    )

    sent_chat_ids: list[int] = []

    async def fake_send_message(bot_token, chat_id, text, parse_mode="Markdown", reply_markup=None):
        sent_chat_ids.append(chat_id)
        return True

    monkeypatch.setattr("app.services.telegram.send_message", fake_send_message)

    async with session_factory() as session:
        from app.services.telegram import notify_company_subscribers

        result = await session.execute(select(TelegramUser))
        company_id = result.scalar_one().company_id

        count = await notify_company_subscribers(
            session,
            company_id,
            notification_type="payment_performed",
            build_message=lambda lang: "payment alert",
        )
        assert count == 1
        assert sent_chat_ids == [-1001234567890]


@pytest.mark.asyncio
async def test_notify_company_subscribers_skips_inactive_subscription(
    client, monkeypatch, session_factory
):
    from datetime import UTC, datetime, timedelta

    from app.models import Company
    from app.models.subscription import SubscriptionStatus

    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "notify-expired-telegram@test.com")
    webhook_secret = await _save_bot_and_get_secret(client, token)

    await client.post(f"/api/v1/telegram/webhook/{webhook_secret}", json=GROUP_START_UPDATE)

    list_response = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    user_id = list_response.json()[0]["id"]
    await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={"is_active": True, "notification_types": ["payment_performed"]},
        headers={"Authorization": f"Bearer {token}"},
    )

    sent_chat_ids: list[int] = []

    async def fake_send_message(bot_token, chat_id, text, parse_mode="Markdown", reply_markup=None):
        sent_chat_ids.append(chat_id)
        return True

    monkeypatch.setattr("app.services.telegram.send_message", fake_send_message)

    async with session_factory() as session:
        from app.services.telegram import notify_company_subscribers

        result = await session.execute(select(TelegramUser))
        company_id = result.scalar_one().company_id
        company = await session.get(Company, company_id)
        assert company is not None
        company.subscription_status = SubscriptionStatus.expired
        company.subscription_expires_at = datetime.now(UTC) - timedelta(days=1)
        await session.commit()

        count = await notify_company_subscribers(
            session,
            company_id,
            notification_type="payment_performed",
            build_message=lambda lang: "payment alert",
        )
        assert count == 0
        assert sent_chat_ids == []


def test_select_notification_recipients_skips_private_when_group_linked():
    from app.models import TelegramUser
    from app.services.telegram import select_notification_recipients

    private = TelegramUser(
        company_id=1,
        telegram_user_id=111222,
        chat_id=111222,
        chat_type="private",
        is_active=True,
        notification_types=["payment_performed"],
    )
    group = TelegramUser(
        company_id=1,
        telegram_user_id=111222,
        chat_id=-1001234567890,
        chat_type="supergroup",
        title="Alerts",
        is_active=True,
        notification_types=["payment_performed"],
    )

    recipients = select_notification_recipients([private, group], "payment_performed")

    assert [recipient.chat_id for recipient in recipients] == [-1001234567890]


def test_select_notification_recipients_keeps_unrelated_private_and_group():
    from app.models import TelegramUser
    from app.services.telegram import select_notification_recipients

    private = TelegramUser(
        company_id=1,
        telegram_user_id=999888,
        chat_id=999888,
        chat_type="private",
        is_active=True,
        notification_types=["payment_performed"],
    )
    group = TelegramUser(
        company_id=1,
        telegram_user_id=111222,
        chat_id=-1001234567890,
        chat_type="supergroup",
        title="Alerts",
        is_active=True,
        notification_types=["payment_performed"],
    )

    recipients = select_notification_recipients([private, group], "payment_performed")

    assert sorted(recipient.chat_id for recipient in recipients) == [-1001234567890, 999888]


@pytest.mark.asyncio
async def test_notify_company_subscribers_skips_private_when_group_linked(
    client,
    monkeypatch,
    session_factory,
):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "notify-dedupe-telegram@test.com")
    webhook_secret = await _save_bot_and_get_secret(client, token)

    private_update = {
        "update_id": 200,
        "message": {
            "message_id": 10,
            "from": {
                "id": 111222,
                "is_bot": False,
                "first_name": "Admin",
                "username": "groupadmin",
                "language_code": "en",
            },
            "chat": {"id": 111222, "type": "private", "first_name": "Admin", "username": "groupadmin"},
            "text": "/start",
        },
    }
    await client.post(f"/api/v1/telegram/webhook/{webhook_secret}", json=private_update)
    await client.post(f"/api/v1/telegram/webhook/{webhook_secret}", json=GROUP_START_UPDATE)

    list_response = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    for user in list_response.json():
        await client.patch(
            f"/api/v1/telegram/users/{user['id']}",
            json={"is_active": True, "notification_types": ["payment_performed"]},
            headers={"Authorization": f"Bearer {token}"},
        )

    sent_chat_ids: list[int] = []

    async def fake_send_message(bot_token, chat_id, text, parse_mode="Markdown", reply_markup=None):
        sent_chat_ids.append(chat_id)
        return True

    monkeypatch.setattr("app.services.telegram.send_message", fake_send_message)

    async with session_factory() as session:
        from app.services.telegram import notify_company_subscribers

        result = await session.execute(select(TelegramUser))
        company_id = result.scalars().first().company_id

        count = await notify_company_subscribers(
            session,
            company_id,
            notification_type="payment_performed",
            build_message=lambda lang: "payment alert",
        )
        assert count == 1
        assert sent_chat_ids == [-1001234567890]


@pytest.mark.asyncio
async def test_out_of_stock_excel_callback_authorizes_by_chat_id_in_group(
    client,
    monkeypatch,
    session_factory,
):
    _mock_telegram_api(monkeypatch)
    token = await _register_and_login(client, "oos-group-callback@test.com")
    webhook_secret = await _save_bot_and_get_secret(client, token)

    await client.post(f"/api/v1/telegram/webhook/{webhook_secret}", json=GROUP_START_UPDATE)

    list_response = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    user_id = list_response.json()[0]["id"]
    patch_response = await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={
            "is_active": True,
            "notification_types": ["out_of_stock"],
            "receipt_language": "en",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert patch_response.status_code == 200

    sent_documents: list[int] = []

    async def fake_send_document(bot_token, chat_id, file_bytes, filename, *, caption=None):
        sent_documents.append(chat_id)
        return True

    monkeypatch.setattr("app.services.telegram.send_document", fake_send_document)

    async def fake_report(session, company_id, *, stock_ids=None, all_stocks=True):
        return [{"product_name": "Test", "stock_name": "Main"}]

    monkeypatch.setattr(
        "app.services.regos_out_of_stock.get_out_of_stock_report",
        fake_report,
    )
    monkeypatch.setattr(
        "app.services.out_of_stock_excel.generate_out_of_stock_excel",
        lambda report, lang="en": b"excel",
    )
    monkeypatch.setattr(
        "app.services.out_of_stock_excel.out_of_stock_report_filename",
        lambda: "out_of_stock.xlsx",
    )

    callback_update = {
        "update_id": 103,
        "callback_query": {
            "id": "cb1",
            "from": {"id": 999999, "language_code": "ru"},
            "message": {
                "chat": GROUP_START_UPDATE["message"]["chat"],
            },
            "data": "oos_excel",
        },
    }
    response = await client.post(
        f"/api/v1/telegram/webhook/{webhook_secret}",
        json=callback_update,
    )
    assert response.status_code == 200
    assert sent_documents == [-1001234567890]
