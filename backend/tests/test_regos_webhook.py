import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import TelegramUser
from tests.helpers import register_owner

INTEGRATION_TOKEN = "1" * 32

SAMPLE_WHOLESALE_DOC = {
    "id": 1,
    "code": "WS-001",
    "date": 1700000000,
    "stock": {"id": 10, "name": "Main warehouse"},
}

SAMPLE_WHOLESALE_OPS = [
    {
        "id": 1,
        "quantity": 2,
        "price": 100,
        "item": {"name": "Widget"},
    }
]

SAMPLE_PAYMENT_DOC = {
    "id": 2,
    "code": "PAY-001",
    "date": 1700000000,
    "amount": 5000,
    "type": {"name": "Cash"},
    "currency": {"name": "UZS"},
    "category": {"positive": False},
    "stock": {"name": "Main warehouse"},
}

SAMPLE_MOVEMENT_DOC = {
    "id": 3,
    "code": "MVT-001",
    "date": 1700000000,
    "stock_sender": {"name": "Warehouse A"},
    "stock_receiver": {"name": "Warehouse B"},
}

SAMPLE_MOVEMENT_OPS = [
    {
        "id": 1,
        "quantity": 1,
        "price": 50,
        "item": {"name": "Bolt"},
    }
]

CHEQUE_UUID = "f44289c4-6edc-48d0-a40f-63d718f35993"
SESSION_UUID = "6ab5087b-64fa-4cd2-8bc9-d5099e0fd45c"

SAMPLE_POS_CHEQUE = {
    "uuid": CHEQUE_UUID,
    "date": 1607608770,
    "code": "WEB-0000581",
    "session_code": "WEB-0000077",
    "cashier": {"full_name": "John Kennedy"},
    "amount": 200.0,
}

SAMPLE_POS_CHEQUE_OPS = [
    {
        "quantity": 2,
        "price": 100,
        "item": {"name": "Widget"},
    }
]

SAMPLE_POS_PAYMENTS = [
    {
        "uuid": "bddde1b2-555f-4942-a1ba-270f48b15d11",
        "has_storno": False,
        "type": {"name": "Cash"},
        "value": 120.0,
    },
    {
        "uuid": "cddde1b2-555f-4942-a1ba-270f48b15d12",
        "has_storno": False,
        "type": {"name": "Card"},
        "value": 80.0,
    },
]

CLOSED_POS_CHEQUE = {**SAMPLE_POS_CHEQUE, "closed": True, "sale_status": "Closed"}

SAMPLE_POS_SESSION = {
    "uuid": SESSION_UUID,
    "code": "WEB-0000004",
    "operating_cash_id": 1,
    "start_date": 1592573622,
    "start_user": {"full_name": "John Kennedy"},
    "start_amount": 10000.0,
    "close_date": 1592577622,
    "close_user": {"full_name": "John Kennedy"},
    "close_amount": 15000.0,
    "closed": True,
}


@pytest.fixture(autouse=True)
def webhook_env(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_BASE_URL", "https://example.com")
    from app.config import get_settings
    from app.services import regos_webhook as regos_webhook_service

    get_settings.cache_clear()
    regos_webhook_service.processed_webhook_events.clear()
    regos_webhook_service.notified_pos_cheque_receipts.clear()
    yield
    get_settings.cache_clear()
    regos_webhook_service.processed_webhook_events.clear()
    regos_webhook_service.notified_pos_cheque_receipts.clear()


async def _register_and_login(client: AsyncClient, email: str) -> str:
    reg = await register_owner(client, email=email, company_name="Webhook Co")
    assert reg.status_code == 200
    return reg.json()["access_token"]


async def _setup_company(
    client: AsyncClient,
    monkeypatch,
    *,
    with_bot: bool = True,
    subscriber_count: int = 2,
) -> str:
    auth_token = await _register_and_login(client, "regos-webhook@test.com")

    save_token = await client.put(
        "/api/v1/regos/tokens",
        json={"token": INTEGRATION_TOKEN, "is_replicable": False},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert save_token.status_code == 200

    if not with_bot:
        return auth_token

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "getMe":
            return {"ok": True, "result": {"username": "notify_bot", "is_bot": True}}
        if method == "setWebhook":
            return {"ok": True, "result": True}
        if method == "sendMessage":
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(f"Unexpected Telegram method: {method}")

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    save_bot = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "123456:ABC-DEF"},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert save_bot.status_code == 200
    webhook_secret = save_bot.json()["bot"]["webhook_url"].split("/")[-1]

    for idx in range(subscriber_count):
        user_id = 900000 + idx
        await client.post(
            f"/api/v1/telegram/webhook/{webhook_secret}",
            json={
                "update_id": idx + 1,
                "message": {
                    "message_id": idx + 1,
                    "from": {"id": user_id, "is_bot": False, "first_name": f"User{idx}"},
                    "chat": {"id": user_id, "type": "private"},
                    "text": "/start",
                },
            },
        )

    users_response = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert users_response.status_code == 200
    for user in users_response.json():
        activate = await client.patch(
            f"/api/v1/telegram/users/{user['id']}",
            json={"is_active": True},
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert activate.status_code == 200

    return auth_token


def _webhook_payload(
    event_action: str,
    document_id: int,
    *,
    event_id: str = "evt-1",
) -> dict:
    return {
        "action": "HandleWebhook",
        "event_id": event_id,
        "connected_integration_id": INTEGRATION_TOKEN,
        "data": {
            "action": event_action,
            "data": {"id": document_id},
        },
    }


def _webhook_payload_pos(
    event_action: str,
    resource_uuid: str,
    *,
    event_id: str = "evt-pos-1",
) -> dict:
    return {
        "action": "HandleWebhook",
        "event_id": event_id,
        "connected_integration_id": INTEGRATION_TOKEN,
        "data": {
            "action": event_action,
            "data": {"uuid": resource_uuid},
        },
    }


@pytest.mark.asyncio
async def test_wholesale_performed_notifies_all_subscribers(client, monkeypatch):
    await _setup_company(client, monkeypatch, subscriber_count=2)

    send_calls: list[int] = []

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "sendMessage":
            send_calls.append(int(payload["chat_id"]))
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        if endpoint == "DocWholeSale/Get":
            return {"ok": True, "result": [SAMPLE_WHOLESALE_DOC]}
        if endpoint == "WholesaleOperation/Get":
            return {"ok": True, "result": SAMPLE_WHOLESALE_OPS}
        raise AssertionError(endpoint)

    monkeypatch.setattr(
        "app.services.regos_document_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload("DocWholeSalePerformed", 1),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert len(send_calls) == 2
    assert send_calls == [900000, 900001]


@pytest.mark.asyncio
async def test_wholesale_performed_respects_subscriber_stock_scope(client, monkeypatch):
    auth_token = await _setup_company(client, monkeypatch, subscriber_count=2)

    users_response = await client.get(
        "/api/v1/telegram/users",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    users = users_response.json()
    assert len(users) == 2

    await client.patch(
        f"/api/v1/telegram/users/{users[0]['id']}",
        json={"stock_ids": [10]},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    await client.patch(
        f"/api/v1/telegram/users/{users[1]['id']}",
        json={"stock_ids": [99]},
        headers={"Authorization": f"Bearer {auth_token}"},
    )

    send_calls: list[int] = []

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "sendMessage":
            send_calls.append(int(payload["chat_id"]))
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        if endpoint == "DocWholeSale/Get":
            return {"ok": True, "result": [SAMPLE_WHOLESALE_DOC]}
        if endpoint == "WholesaleOperation/Get":
            return {"ok": True, "result": SAMPLE_WHOLESALE_OPS}
        raise AssertionError(endpoint)

    monkeypatch.setattr(
        "app.services.regos_document_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload("DocWholeSalePerformed", 1, event_id="scope-evt"),
    )
    assert response.status_code == 200
    assert send_calls == [900000]


@pytest.mark.asyncio
async def test_unknown_integration_returns_error(client):
    response = await client.post(
        "/api/v1/regos/webhook",
        json={
            "action": "HandleWebhook",
            "connected_integration_id": "9" * 32,
            "data": {"action": "DocWholeSalePerformed", "data": {"id": 1}},
        },
    )
    assert response.status_code == 200
    assert response.json()["ok"] is False


@pytest.mark.asyncio
async def test_duplicate_event_skipped(client, monkeypatch):
    await _setup_company(client, monkeypatch, subscriber_count=1)

    send_count = 0

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        nonlocal send_count
        if method == "sendMessage":
            send_count += 1
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        if endpoint == "DocWholeSale/Get":
            return {"ok": True, "result": [SAMPLE_WHOLESALE_DOC]}
        if endpoint == "WholesaleOperation/Get":
            return {"ok": True, "result": SAMPLE_WHOLESALE_OPS}
        raise AssertionError(endpoint)

    monkeypatch.setattr(
        "app.services.regos_document_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    payload = _webhook_payload("DocWholeSalePerformed", 1, event_id="dup-evt")

    first = await client.post("/api/v1/regos/webhook", json=payload)
    second = await client.post("/api/v1/regos/webhook", json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json().get("duplicate") is True
    assert send_count == 1


@pytest.mark.asyncio
async def test_no_telegram_bot_returns_ok_without_send(client, monkeypatch):
    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        if endpoint == "DocWholeSale/Get":
            return {"ok": True, "result": [SAMPLE_WHOLESALE_DOC]}
        if endpoint == "WholesaleOperation/Get":
            return {"ok": True, "result": SAMPLE_WHOLESALE_OPS}
        raise AssertionError(endpoint)

    monkeypatch.setattr(
        "app.services.regos_document_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    send_calls: list[int] = []

    async def track_send(bot_token: str, chat_id: int, text: str, parse_mode: str = "Markdown") -> bool:
        send_calls.append(chat_id)
        return True

    monkeypatch.setattr("app.services.telegram.send_message", track_send)

    await _setup_company(client, monkeypatch, with_bot=False)

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload("DocWholeSalePerformed", 1, event_id="no-bot-evt"),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert send_calls == []


@pytest.mark.asyncio
async def test_payment_performed_without_operations_fetch(client, monkeypatch):
    await _setup_company(client, monkeypatch, subscriber_count=1)

    endpoints_hit: list[str] = []
    send_count = 0

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        nonlocal send_count
        if method == "sendMessage":
            send_count += 1
            assert "\u041f\u043e\u043b\u0443\u0447\u0435\u043d\u043e" in payload["text"]
            assert "5 000" in payload["text"]
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        endpoints_hit.append(endpoint)
        if endpoint == "DocPayment/Get":
            return {"ok": True, "result": [SAMPLE_PAYMENT_DOC]}
        raise AssertionError(endpoint)

    monkeypatch.setattr(
        "app.services.regos_document_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload("DocPaymentPerformed", 2, event_id="pay-evt"),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert endpoints_hit == ["DocPayment/Get"]
    assert send_count == 1


@pytest.mark.asyncio
async def test_movement_performed_and_cancelled_format(client, monkeypatch):
    from app.services.document_telegram_format import format_movement_receipt

    message = format_movement_receipt(SAMPLE_MOVEMENT_DOC, SAMPLE_MOVEMENT_OPS)
    assert "Warehouse A" in message
    assert "Warehouse B" in message
    assert "Bolt" in message

    cancelled = format_movement_receipt(
        SAMPLE_MOVEMENT_DOC,
        SAMPLE_MOVEMENT_OPS,
        is_cancelled=True,
    )
    assert "\u041e\u0422\u041c\u0415\u041d\u0415\u041d\u041e" in cancelled

    await _setup_company(client, monkeypatch, subscriber_count=1)

    send_count = 0

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        nonlocal send_count
        if method == "sendMessage":
            send_count += 1
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        if endpoint == "DocMovement/Get":
            return {"ok": True, "result": [SAMPLE_MOVEMENT_DOC]}
        if endpoint == "MovementOperation/Get":
            return {"ok": True, "result": SAMPLE_MOVEMENT_OPS}
        raise AssertionError(endpoint)

    monkeypatch.setattr(
        "app.services.regos_document_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    performed = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload("DocMovementPerformed", 3, event_id="mvt-perf"),
    )
    cancelled_resp = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload("DocMovementPerformCanceled", 3, event_id="mvt-cancel"),
    )

    assert performed.status_code == 200
    assert cancelled_resp.status_code == 200
    assert send_count == 2


@pytest.mark.asyncio
async def test_wholesale_respects_user_notification_preferences(client, monkeypatch, session_factory):
    auth_token = await _setup_company(client, monkeypatch, subscriber_count=2)

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser).order_by(TelegramUser.telegram_user_id))
        users = list(result.scalars().all())
        users[0].notification_types = ["wholesale"]
        users[1].notification_types = ["payment"]
        await session.commit()

    send_calls: list[int] = []

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "sendMessage":
            send_calls.append(int(payload["chat_id"]))
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        if endpoint == "DocWholeSale/Get":
            return {"ok": True, "result": [SAMPLE_WHOLESALE_DOC]}
        if endpoint == "WholesaleOperation/Get":
            return {"ok": True, "result": SAMPLE_WHOLESALE_OPS}
        raise AssertionError(endpoint)

    monkeypatch.setattr(
        "app.services.regos_document_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload("DocWholeSalePerformed", 1, event_id="pref-evt"),
    )
    assert response.status_code == 200
    assert send_calls == [900000]


@pytest.mark.asyncio
async def test_wholesale_sent_in_subscriber_language(client, monkeypatch, session_factory):
    auth_token = await _setup_company(client, monkeypatch, subscriber_count=2)

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser).order_by(TelegramUser.telegram_user_id))
        users = list(result.scalars().all())
        users[0].receipt_language = "en"
        users[1].receipt_language = "ru"
        await session.commit()

    sent_texts: list[str] = []

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "sendMessage":
            sent_texts.append(payload["text"])
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        if endpoint == "DocWholeSale/Get":
            return {"ok": True, "result": [SAMPLE_WHOLESALE_DOC]}
        if endpoint == "WholesaleOperation/Get":
            return {"ok": True, "result": SAMPLE_WHOLESALE_OPS}
        raise AssertionError(endpoint)

    monkeypatch.setattr(
        "app.services.regos_document_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload("DocWholeSalePerformed", 1, event_id="lang-evt"),
    )
    assert response.status_code == 200
    assert len(sent_texts) == 2
    assert any("Document №" in text for text in sent_texts)
    assert any("Документ №" in text for text in sent_texts)


@pytest.mark.asyncio
async def test_regos_token_config_includes_webhook_url(client):
    auth_token = await _register_and_login(client, "webhook-url@test.com")

    response = await client.get(
        "/api/v1/regos/tokens",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert response.status_code == 200
    assert response.json()["webhook_url"] == "https://example.com/api/v1/regos/webhook"


def _fake_pos_regos(endpoint, request_data):
    if endpoint == "doccheque/get":
        return {"ok": True, "result": [SAMPLE_POS_CHEQUE]}
    if endpoint == "doccheque/getshort":
        return {"ok": True, "result": [SAMPLE_POS_CHEQUE], "total": 1}
    if endpoint == "chequeitemoperation/get":
        return {"ok": True, "result": SAMPLE_POS_CHEQUE_OPS}
    if endpoint == "chequepaymentoperation/get":
        return {"ok": True, "result": SAMPLE_POS_PAYMENTS}
    if endpoint == "doccashsession/get":
        return {"ok": True, "result": [SAMPLE_POS_SESSION]}
    raise AssertionError(endpoint)


async def _fake_session_cheque_batch(session, company_id, steps, **kwargs):
    return {
        step["key"]: {
            "ok": True,
            "result": (
                SAMPLE_POS_CHEQUE_OPS
                if step["key"].startswith("ops:")
                else SAMPLE_POS_PAYMENTS
            ),
        }
        for step in steps
    }


@pytest.mark.asyncio
async def test_doc_cheque_closed_notifies_subscribers(client, monkeypatch):
    await _setup_company(client, monkeypatch, subscriber_count=2)

    send_calls: list[int] = []

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "sendMessage":
            send_calls.append(int(payload["chat_id"]))
            assert payload["parse_mode"] == "HTML"
            assert "Widget" in payload["text"]
            assert "Cash: 120" in payload["text"]
            assert "Card: 80" in payload["text"]
            assert "Total paid: 200" in payload["text"]
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        return _fake_pos_regos(endpoint, request_data)

    monkeypatch.setattr(
        "app.services.regos_pos_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload_pos("DocChequeClosed", CHEQUE_UUID, event_id="cheque-closed"),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert len(send_calls) == 2


@pytest.mark.asyncio
async def test_doc_cheque_canceled_respects_notification_filter(client, monkeypatch, session_factory):
    await _setup_company(client, monkeypatch, subscriber_count=2)

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser).order_by(TelegramUser.telegram_user_id))
        users = list(result.scalars().all())
        users[0].notification_types = ["pos_cheque"]
        users[1].notification_types = ["wholesale"]
        await session.commit()

    send_calls: list[int] = []

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "sendMessage":
            send_calls.append(int(payload["chat_id"]))
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        return _fake_pos_regos(endpoint, request_data)

    monkeypatch.setattr(
        "app.services.regos_pos_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload_pos("DocChequeCanceled", CHEQUE_UUID, event_id="cheque-cancel"),
    )
    assert response.status_code == 200
    assert send_calls == [900000]


@pytest.mark.asyncio
async def test_doc_cheque_closed_respects_granular_filter(client, monkeypatch, session_factory):
    await _setup_company(client, monkeypatch, subscriber_count=2)

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser).order_by(TelegramUser.telegram_user_id))
        users = list(result.scalars().all())
        users[0].notification_types = ["pos_cheque_closed"]
        users[1].notification_types = ["pos_cheque_cancelled"]
        await session.commit()

    send_calls: list[int] = []

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "sendMessage":
            send_calls.append(int(payload["chat_id"]))
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        return _fake_pos_regos(endpoint, request_data)

    monkeypatch.setattr(
        "app.services.regos_pos_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload_pos("DocChequeClosed", CHEQUE_UUID, event_id="cheque-closed-filter"),
    )
    assert response.status_code == 200
    assert send_calls == [900000]


@pytest.mark.asyncio
async def test_doc_cheque_return_respects_granular_filter(client, monkeypatch, session_factory):
    await _setup_company(client, monkeypatch, subscriber_count=2)

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser).order_by(TelegramUser.telegram_user_id))
        users = list(result.scalars().all())
        users[0].notification_types = ["pos_cheque_return"]
        users[1].notification_types = ["pos_cheque_closed"]
        await session.commit()

    send_calls: list[int] = []

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "sendMessage":
            send_calls.append(int(payload["chat_id"]))
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        if endpoint == "doccheque/get":
            return {"ok": True, "result": [{**SAMPLE_POS_CHEQUE, "is_return": True}]}
        return _fake_pos_regos(endpoint, request_data)

    monkeypatch.setattr(
        "app.services.regos_pos_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload_pos("DocChequeClosed", CHEQUE_UUID, event_id="cheque-return-filter"),
    )
    assert response.status_code == 200
    assert send_calls == [900000]


@pytest.mark.asyncio
async def test_pos_cheque_pay_debt_with_any_pos_leaf(client, monkeypatch, session_factory):
    await _setup_company(client, monkeypatch, subscriber_count=2)

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser).order_by(TelegramUser.telegram_user_id))
        users = list(result.scalars().all())
        users[0].notification_types = ["pos_cheque_cancelled"]
        users[1].notification_types = ["wholesale_performed"]
        await session.commit()

    send_calls: list[int] = []

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "sendMessage":
            send_calls.append(int(payload["chat_id"]))
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        if endpoint == "doccheque/get":
            return {
                "ok": True,
                "result": [{**CLOSED_POS_CHEQUE, "payments_amount": 500.0}],
            }
        if endpoint == "chequeitemoperation/get":
            return {"ok": True, "result": []}
        if endpoint == "chequepaymentoperation/get":
            return {"ok": True, "result": SAMPLE_POS_PAYMENTS}
        raise AssertionError(endpoint)

    monkeypatch.setattr(
        "app.services.regos_pos_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload_pos("POSChequePayDebt", CHEQUE_UUID, event_id="cheque-debt-filter"),
    )
    assert response.status_code == 200
    assert send_calls == [900000]


@pytest.mark.asyncio
async def test_pos_cheque_pay_debt_notifies(client, monkeypatch):
    await _setup_company(client, monkeypatch, subscriber_count=1)

    send_count = 0

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        nonlocal send_count
        if method == "sendMessage":
            send_count += 1
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        if endpoint == "doccheque/get":
            return {
                "ok": True,
                "result": [{**CLOSED_POS_CHEQUE, "payments_amount": 500.0}],
            }
        if endpoint == "chequeitemoperation/get":
            return {"ok": True, "result": []}
        if endpoint == "chequepaymentoperation/get":
            return {"ok": True, "result": SAMPLE_POS_PAYMENTS}
        raise AssertionError(endpoint)

    monkeypatch.setattr(
        "app.services.regos_pos_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload_pos("POSChequePayDebt", CHEQUE_UUID, event_id="cheque-debt"),
    )
    assert response.status_code == 200
    assert send_count == 1


@pytest.mark.asyncio
async def test_pos_cheque_pay_debt_skipped_while_cheque_open(client, monkeypatch):
    await _setup_company(client, monkeypatch, subscriber_count=1)

    send_count = 0

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        nonlocal send_count
        if method == "sendMessage":
            send_count += 1
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        return _fake_pos_regos(endpoint, request_data)

    monkeypatch.setattr(
        "app.services.regos_pos_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload_pos("POSChequePayDebt", CHEQUE_UUID, event_id="cheque-debt-open"),
    )
    assert response.status_code == 200
    assert send_count == 0


@pytest.mark.asyncio
async def test_split_payment_checkout_sends_single_closed_receipt(client, monkeypatch):
    await _setup_company(client, monkeypatch, subscriber_count=1)

    send_count = 0
    sent_texts: list[str] = []
    cheque_states = [SAMPLE_POS_CHEQUE, SAMPLE_POS_CHEQUE, CLOSED_POS_CHEQUE]
    cheque_fetch_index = 0

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        nonlocal send_count
        if method == "sendMessage":
            send_count += 1
            sent_texts.append(payload["text"])
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        nonlocal cheque_fetch_index
        if endpoint == "doccheque/get":
            cheque = cheque_states[cheque_fetch_index]
            cheque_fetch_index += 1
            return {"ok": True, "result": [cheque]}
        return _fake_pos_regos(endpoint, request_data)

    monkeypatch.setattr(
        "app.services.regos_pos_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    for index, event_id in enumerate(
        ("split-pay-cash", "split-pay-card", "split-pay-closed"),
        start=1,
    ):
        response = await client.post(
            "/api/v1/regos/webhook",
            json=_webhook_payload_pos(
                "POSChequePayDebt" if index < 3 else "DocChequeClosed",
                CHEQUE_UUID,
                event_id=event_id,
            ),
        )
        assert response.status_code == 200

    assert send_count == 1
    assert "Cash: 120" in sent_texts[0]
    assert "Card: 80" in sent_texts[0]
    assert "120" in sent_texts[0]
    assert "80" in sent_texts[0]
    assert "200" in sent_texts[0]


@pytest.mark.asyncio
async def test_doc_session_opened_notifies(client, monkeypatch):
    await _setup_company(client, monkeypatch, subscriber_count=1)

    send_count = 0

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        nonlocal send_count
        if method == "sendMessage":
            send_count += 1
            assert "WEB-0000004" in payload["text"]
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        return _fake_pos_regos(endpoint, request_data)

    monkeypatch.setattr(
        "app.services.regos_pos_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload_pos("DocSessionOpened", SESSION_UUID, event_id="session-open"),
    )
    assert response.status_code == 200
    assert send_count == 1


@pytest.mark.asyncio
async def test_doc_session_closed_notifies(client, monkeypatch):
    await _setup_company(client, monkeypatch, subscriber_count=1)

    send_count = 0
    sent_payloads: list[dict] = []
    document_calls: list[dict] = []

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        nonlocal send_count
        if method == "sendMessage":
            send_count += 1
            sent_payloads.append(payload)
            assert "Итоги смены" in payload["text"]
            assert "Продажи: 200" in payload["text"]
            assert "reply_markup" not in payload
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    async def fake_send_document(
        bot_token: str,
        chat_id: int,
        file_bytes: bytes,
        filename: str,
        *,
        caption: str | None = None,
    ) -> bool:
        document_calls.append(
            {
                "chat_id": chat_id,
                "filename": filename,
                "size": len(file_bytes),
                "caption": caption,
            }
        )
        return True

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)
    monkeypatch.setattr("app.services.telegram.send_document", fake_send_document)

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        return _fake_pos_regos(endpoint, request_data)

    monkeypatch.setattr(
        "app.services.regos_pos_fetch.regos_async_api_request_for_company",
        fake_regos,
    )
    monkeypatch.setattr(
        "app.services.regos_pos_fetch.regos_batch_request_chunks_for_company",
        _fake_session_cheque_batch,
    )

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload_pos("DocSessionClosed", SESSION_UUID, event_id="session-close"),
    )
    assert response.status_code == 200
    assert send_count == 1
    assert sent_payloads
    assert len(document_calls) == 1
    assert document_calls[0]["filename"] == "WEB-0000004-report.xlsx"
    assert document_calls[0]["size"] > 0
    assert document_calls[0]["caption"]
