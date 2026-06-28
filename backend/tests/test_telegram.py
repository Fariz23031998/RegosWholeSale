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
            return {"ok": True, "result": True, "description": "Webhook was set"}
        if method == "deleteWebhook":
            return {"ok": True, "result": True, "description": "Webhook was deleted"}
        if method == "sendMessage":
            return {"ok": True, "result": {"message_id": 1}}
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
    types = response.json()["types"]
    assert "purchase" in types
    assert "wholesale" in types
    assert "payment" in types


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

    list_response = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    user_id = list_response.json()[0]["id"]
    assert set(list_response.json()[0]["notification_types"]) == {
        "purchase",
        "return_purchase",
        "wholesale",
        "wholesale_return",
        "payment",
        "inout",
        "movement",
    }

    update_response = await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={"notification_types": ["wholesale", "payment"], "receipt_language": "en"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["notification_types"] == ["payment", "wholesale"]
    assert update_response.json()["receipt_language"] == "en"

    empty_update = await client.patch(
        f"/api/v1/telegram/users/{user_id}",
        json={},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert empty_update.status_code == 400
    assert empty_update.json()["code"] == "TELEGRAM_USER_UPDATE_EMPTY"


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
