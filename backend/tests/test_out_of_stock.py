from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import OutOfStockProduct, TelegramUser
from app.services import out_of_stock_products as out_of_stock_products_service
from app.services import regos_document_fetch as doc_fetch
from app.services import regos_out_of_stock as out_of_stock_service
from app.services.document_telegram_format import format_out_of_stock_notification
from tests.helpers import register_owner

INTEGRATION_TOKEN = "2" * 32

SAMPLE_WHOLESALE_DOC = {
    "id": 1,
    "code": "WS-001",
    "date": 1700000000,
    "stock": {"id": 10, "name": "Main warehouse"},
}

SAMPLE_WHOLESALE_OPS = [
    {
        "id": 1,
        "item_id": 101,
        "quantity": 2,
        "price": 100,
        "item": {"id": 101, "name": "Widget"},
    }
]

SAMPLE_INOUT_INCOME_DOC = {
    "id": 2,
    "code": "IN-001",
    "date": 1700000000,
    "inout_type": 1,
    "stock": {"id": 10, "name": "Main warehouse"},
}

SAMPLE_INOUT_OUTCOME_DOC = {
    "id": 3,
    "code": "OUT-001",
    "date": 1700000000,
    "inout_type": 2,
    "stock": {"id": 10, "name": "Main warehouse"},
}

SAMPLE_MOVEMENT_DOC = {
    "id": 4,
    "code": "MVT-001",
    "date": 1700000000,
    "stock_sender": {"id": 11, "name": "Warehouse A"},
    "stock_receiver": {"id": 12, "name": "Warehouse B"},
}

SAMPLE_MOVEMENT_OPS = [
    {
        "id": 1,
        "item_id": 101,
        "quantity": 1,
        "price": 50,
        "item": {"id": 101, "name": "Bolt"},
    }
]

CHEQUE_UUID = "f44289c4-6edc-48d0-a40f-63d718f35993"

SAMPLE_POS_CHEQUE = {
    "uuid": CHEQUE_UUID,
    "date": 1607608770,
    "code": "WEB-0000581",
    "session_code": "WEB-0000077",
    "cashier": {"full_name": "John Kennedy"},
    "amount": 200.0,
    "is_return": False,
}

SAMPLE_POS_CHEQUE_OPS = [
    {
        "quantity": 2,
        "price": 100,
        "stock_id": 10,
        "item": {"id": 101, "name": "Widget"},
    }
]

SAMPLE_POS_PAYMENTS = [
    {
        "uuid": "bddde1b2-555f-4942-a1ba-270f48b15d11",
        "has_storno": False,
        "type": {"name": "Cash"},
        "value": 200.0,
    }
]

PRICE_TYPE_DEFAULTS = {"price_type": {"id": 22, "name": "Retail"}}


def test_resolve_stock_id_wholesale_uses_document_stock():
    stock_id = out_of_stock_service.resolve_stock_id_for_event(
        "DocWholeSalePerformed",
        SAMPLE_WHOLESALE_DOC,
    )
    assert stock_id == 10


def test_resolve_stock_id_inout_outcome_only():
    assert (
        out_of_stock_service.resolve_stock_id_for_event(
            "DocInOutPerformed",
            SAMPLE_INOUT_OUTCOME_DOC,
        )
        == 10
    )
    assert (
        out_of_stock_service.resolve_stock_id_for_event(
            "DocInOutPerformed",
            SAMPLE_INOUT_INCOME_DOC,
        )
        is None
    )


def test_resolve_stock_id_inout_cancel_income():
    assert (
        out_of_stock_service.resolve_stock_id_for_event(
            "DocInOutPerformCanceled",
            SAMPLE_INOUT_INCOME_DOC,
        )
        == 10
    )
    assert (
        out_of_stock_service.resolve_stock_id_for_event(
            "DocInOutPerformCanceled",
            SAMPLE_INOUT_OUTCOME_DOC,
        )
        is None
    )


def test_resolve_stock_id_movement_sender_and_receiver():
    assert (
        out_of_stock_service.resolve_stock_id_for_event(
            "DocMovementPerformed",
            SAMPLE_MOVEMENT_DOC,
        )
        == 11
    )
    assert (
        out_of_stock_service.resolve_stock_id_for_event(
            "DocMovementPerformCanceled",
            SAMPLE_MOVEMENT_DOC,
        )
        == 12
    )


def test_resolve_stock_id_returns_to_partner_performed():
    doc = {"stock": {"id": 15}}
    assert (
        out_of_stock_service.resolve_stock_id_for_event(
            "DocReturnsToPartnerPerformed",
            doc,
        )
        == 15
    )


def test_item_ids_from_operations():
    assert doc_fetch.item_ids_from_operations(SAMPLE_WHOLESALE_OPS) == [101]
    assert doc_fetch.item_ids_from_operations(
        [
            {"item_id": 5},
            {"item": {"id": 6}},
            {"item_id": 5},
            {"item_id": 0},
        ]
    ) == [5, 6]


def test_item_ids_by_stock_from_cheque_operations():
    grouped = out_of_stock_service._item_ids_by_stock_from_cheque_operations(
        [
            {
                "quantity": 2,
                "stock_id": 10,
                "item": {"id": 101},
            },
            {
                "quantity": 1,
                "stock_id": 11,
                "item_id": 102,
            },
            {
                "quantity": 1,
                "stock_id": 10,
                "has_storno": True,
                "item": {"id": 103},
            },
            {
                "quantity": -1,
                "stock_id": 10,
                "item": {"id": 104},
            },
        ]
    )
    assert grouped == {10: [101], 11: [102]}


def test_format_out_of_stock_notification():
    message = format_out_of_stock_notification(
        "Widget",
        "Main warehouse",
        allowed=0,
        min_quantity=5,
        code="W-001",
        barcode="4601234567890",
        last_purchase_cost=7000,
        price=22000,
        lang="en",
    )
    assert "Out of stock" in message
    assert "Widget" in message
    assert "Main warehouse" in message
    assert "W-001" in message
    assert "4601234567890" in message
    assert "7" in message and "000" in message
    assert "22" in message and "000" in message


@pytest.mark.asyncio
async def test_fetch_items_stock_at_warehouse(session_factory):
    async with session_factory() as session:
        with patch(
            "app.services.regos_out_of_stock.get_stored_regos_defaults",
            new_callable=AsyncMock,
            return_value=PRICE_TYPE_DEFAULTS,
        ), patch(
            "app.services.regos_out_of_stock.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            return_value={
                "ok": True,
                "result": [
                    {
                        "item": {
                            "id": 101,
                            "name": "Widget",
                            "min_quantity": 5,
                            "code": "W-001",
                            "base_barcode": "4601234567890",
                        },
                        "quantity": {"allowed": 0},
                        "price": 22000,
                        "last_purchase_cost": 7000,
                    }
                ],
            },
        ):
            items = await out_of_stock_service.fetch_items_stock_at_warehouse(
                session,
                company_id=1,
                stock_id=10,
                item_ids=[101],
            )

    assert len(items) == 1
    assert items[0]["product_id"] == 101
    assert items[0]["allowed"] == 0
    assert items[0]["min_quantity"] == 5
    assert items[0]["name"] == "Widget"
    assert items[0]["code"] == "W-001"
    assert items[0]["barcode"] == "4601234567890"
    assert items[0]["last_purchase_cost"] == 7000
    assert items[0]["price"] == 22000


@pytest.mark.asyncio
async def test_check_and_record_out_of_stock_notifies_and_persists(session_factory):
    async with session_factory() as session:
        with patch(
            "app.services.regos_out_of_stock.get_stored_regos_defaults",
            new_callable=AsyncMock,
            return_value=PRICE_TYPE_DEFAULTS,
        ), patch(
            "app.services.regos_out_of_stock.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            return_value={
                "ok": True,
                "result": [
                    {
                        "item": {"id": 101, "name": "Widget", "min_quantity": 5},
                        "quantity": {"allowed": 3},
                    }
                ],
            },
        ), patch(
            "app.services.regos_out_of_stock.telegram_service.notify_company_subscribers",
            new_callable=AsyncMock,
            return_value=2,
        ) as notify_mock, patch(
            "app.services.regos_out_of_stock.telegram_service.send_out_of_stock_excel_prompt",
            new_callable=AsyncMock,
            return_value=2,
        ) as excel_prompt_mock:
            notified = await out_of_stock_service.check_and_record_out_of_stock(
                session,
                company_id=1,
                event_action="DocWholeSalePerformed",
                document=SAMPLE_WHOLESALE_DOC,
                operations=SAMPLE_WHOLESALE_OPS,
            )
            await session.commit()

    assert notified == 1
    notify_mock.assert_awaited_once()
    assert notify_mock.await_args.kwargs["notification_type"] == "out_of_stock"
    assert notify_mock.await_args.kwargs["scope"].stock_ids == frozenset({10})
    excel_prompt_mock.assert_awaited_once()
    assert excel_prompt_mock.await_args.kwargs["scope"].stock_ids == frozenset({10})

    async with session_factory() as session:
        rows = (
            await session.execute(select(OutOfStockProduct).where(OutOfStockProduct.company_id == 1))
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].product_id == 101
        assert rows[0].stock_id == 10


@pytest.mark.asyncio
async def test_check_and_record_out_of_stock_skips_above_minimum(session_factory):
    async with session_factory() as session:
        with patch(
            "app.services.regos_out_of_stock.get_stored_regos_defaults",
            new_callable=AsyncMock,
            return_value=PRICE_TYPE_DEFAULTS,
        ), patch(
            "app.services.regos_out_of_stock.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            return_value={
                "ok": True,
                "result": [
                    {
                        "item": {"id": 101, "name": "Widget", "min_quantity": 5},
                        "quantity": {"allowed": 10},
                    }
                ],
            },
        ), patch(
            "app.services.regos_out_of_stock.telegram_service.notify_company_subscribers",
            new_callable=AsyncMock,
        ) as notify_mock, patch(
            "app.services.regos_out_of_stock.telegram_service.send_out_of_stock_excel_prompt",
            new_callable=AsyncMock,
        ) as excel_prompt_mock:
            notified = await out_of_stock_service.check_and_record_out_of_stock(
                session,
                company_id=1,
                event_action="DocWholeSalePerformed",
                document=SAMPLE_WHOLESALE_DOC,
                operations=SAMPLE_WHOLESALE_OPS,
            )
            await session.commit()

    assert notified == 0
    notify_mock.assert_not_awaited()
    excel_prompt_mock.assert_not_awaited()

    async with session_factory() as session:
        rows = (await session.execute(select(OutOfStockProduct))).scalars().all()
        assert rows == []


@pytest.mark.asyncio
async def test_get_out_of_stock_report_reconciles_and_removes_recovered(session_factory):
    async with session_factory() as session:
        session.add_all(
            [
                OutOfStockProduct(company_id=1, product_id=101, stock_id=10),
                OutOfStockProduct(company_id=1, product_id=102, stock_id=10),
            ]
        )
        await session.commit()

    async with session_factory() as session:
        with patch(
            "app.services.regos_out_of_stock.get_stored_regos_defaults",
            new_callable=AsyncMock,
            return_value=PRICE_TYPE_DEFAULTS,
        ), patch(
            "app.services.regos_out_of_stock.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            return_value={
                "ok": True,
                "result": [
                    {
                        "item": {
                            "id": 101,
                            "name": "Widget",
                            "min_quantity": 5,
                            "code": "W-001",
                            "base_barcode": "4601234567890",
                        },
                        "quantity": {"allowed": 2},
                        "price": 22000,
                        "last_purchase_cost": 7000,
                    },
                    {
                        "item": {"id": 102, "name": "Bolt", "min_quantity": 1},
                        "quantity": {"allowed": 10},
                    },
                ],
            },
        ), patch(
            "app.services.regos_out_of_stock.doc_fetch.fetch_stock_name",
            new_callable=AsyncMock,
            return_value="Main warehouse",
        ):
            report = await out_of_stock_service.get_out_of_stock_report(session, company_id=1)
            await session.commit()

    assert len(report) == 1
    assert report[0]["product_id"] == 101
    assert report[0]["product_name"] == "Widget"
    assert report[0]["code"] == "W-001"
    assert report[0]["barcode"] == "4601234567890"
    assert report[0]["stock_name"] == "Main warehouse"
    assert report[0]["quantity"] == 2
    assert report[0]["min_quantity"] == 5
    assert report[0]["last_purchase_cost"] == 7000
    assert report[0]["price"] == 22000

    async with session_factory() as session:
        rows = (await session.execute(select(OutOfStockProduct))).scalars().all()
        assert len(rows) == 1
        assert rows[0].product_id == 101


@pytest.mark.asyncio
async def test_clean_out_of_stock_products(session_factory):
    async with session_factory() as session:
        old_row = OutOfStockProduct(
            company_id=1,
            product_id=101,
            stock_id=10,
            created_at=datetime.now(UTC) - timedelta(days=8),
        )
        recent_row = OutOfStockProduct(
            company_id=1,
            product_id=102,
            stock_id=10,
        )
        session.add_all([old_row, recent_row])
        await session.commit()

    async with session_factory() as session:
        deleted = await out_of_stock_products_service.clean_out_of_stock_products(session)
        await session.commit()
        assert deleted == 1
        remaining = (await session.execute(select(OutOfStockProduct))).scalars().all()
        assert len(remaining) == 1
        assert remaining[0].product_id == 102


@pytest.fixture(autouse=True)
def webhook_env(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_BASE_URL", "https://example.com")
    from app.config import get_settings
    from app.services import regos_webhook as regos_webhook_service

    get_settings.cache_clear()
    regos_webhook_service.processed_webhook_events.clear()
    yield
    get_settings.cache_clear()
    regos_webhook_service.processed_webhook_events.clear()


def _webhook_payload(event_action: str, document_id: int, *, event_id: str = "oos-evt-1") -> dict:
    return {
        "action": "HandleWebhook",
        "event_id": event_id,
        "connected_integration_id": INTEGRATION_TOKEN,
        "data": {
            "action": event_action,
            "data": {"id": document_id},
        },
    }


async def _setup_webhook_company(client: AsyncClient, monkeypatch, session_factory) -> None:
    reg = await register_owner(client, email="oos-webhook@test.com", company_name="OOS Co")
    auth_token = reg.json()["access_token"]

    save_token = await client.put(
        "/api/v1/regos/tokens",
        json={"token": INTEGRATION_TOKEN, "is_replicable": False},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert save_token.status_code == 200

    save_defaults = await client.patch(
        "/api/v1/company/settings",
        json={"settings": {"regos_defaults": {"price_type": {"id": 22, "name": "Retail"}}}},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert save_defaults.status_code == 200

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "getMe":
            return {"ok": True, "result": {"username": "notify_bot", "is_bot": True}}
        if method == "setWebhook":
            return {"ok": True, "result": True}
        if method == "sendMessage":
            return {"ok": True, "result": {"message_id": 1}}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    save_bot = await client.put(
        "/api/v1/telegram/bot",
        json={"bot_token": "123456:ABC-DEF"},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert save_bot.status_code == 200
    webhook_secret = save_bot.json()["bot"]["webhook_url"].split("/")[-1]

    await client.post(
        f"/api/v1/telegram/webhook/{webhook_secret}",
        json={
            "update_id": 1,
            "message": {
                "message_id": 1,
                "from": {"id": 900001, "is_bot": False, "first_name": "User"},
                "chat": {"id": 900001, "type": "private"},
                "text": "/start",
            },
        },
    )

    async with session_factory() as session:
        result = await session.execute(select(TelegramUser))
        telegram_user = result.scalar_one()
        telegram_user.is_active = True
        await session.commit()


@pytest.mark.asyncio
async def test_wholesale_webhook_triggers_out_of_stock_notification(client, monkeypatch, session_factory):
    await _setup_webhook_company(client, monkeypatch, session_factory)

    oos_messages: list[str] = []
    excel_prompts: list[dict] = []

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        if endpoint == "DocWholeSale/Get":
            return {"ok": True, "result": [SAMPLE_WHOLESALE_DOC]}
        if endpoint == "WholesaleOperation/Get":
            return {"ok": True, "result": SAMPLE_WHOLESALE_OPS}
        if endpoint == "item/getext":
            return {
                "ok": True,
                "result": [
                    {
                        "item": {
                            "id": 101,
                            "name": "Widget",
                            "min_quantity": 5,
                        },
                        "quantity": {"allowed": 2},
                        "price": 22000,
                        "last_purchase_cost": 7000,
                    }
                ],
            }
        raise AssertionError(endpoint)

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "sendMessage":
            if payload.get("reply_markup"):
                excel_prompts.append(payload)
            else:
                oos_messages.append(payload["text"])
            return {"ok": True, "result": {"message_id": 1}}
        if method in {"getMe", "setWebhook"}:
            return {"ok": True, "result": True}
        raise AssertionError(method)

    monkeypatch.setattr(
        "app.services.regos_document_fetch.regos_async_api_request_for_company",
        fake_regos,
    )
    monkeypatch.setattr(
        "app.services.regos_out_of_stock.regos_async_api_request_for_company",
        fake_regos,
    )
    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload("DocWholeSalePerformed", 1),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    async with session_factory() as session:
        rows = (await session.execute(select(OutOfStockProduct))).scalars().all()
        assert len(rows) == 1
        assert rows[0].product_id == 101
        assert rows[0].stock_id == 10

    assert len(oos_messages) >= 1
    assert any(
        "Widget" in message and ("Out of stock" in message or "Нет в наличии" in message)
        for message in oos_messages
    )
    assert len(excel_prompts) == 1
    button = excel_prompts[0]["reply_markup"]["inline_keyboard"][0][0]
    assert button["callback_data"] == "oos_excel"
    assert button["text"] in {"Download Excel", "Скачать Excel"}


@pytest.mark.asyncio
async def test_operation_document_schedules_out_of_stock_in_background(monkeypatch):
    from unittest.mock import MagicMock

    from app.services import regos_webhook as regos_webhook_service

    background_tasks = MagicMock()
    scheduled: list[tuple] = []
    background_tasks.add_task.side_effect = lambda func, *args: scheduled.append((func, args))

    monkeypatch.setattr(
        regos_webhook_service.doc_fetch,
        "fetch_document",
        AsyncMock(return_value=SAMPLE_WHOLESALE_DOC),
    )
    monkeypatch.setattr(
        regos_webhook_service.doc_fetch,
        "fetch_operations",
        AsyncMock(return_value=SAMPLE_WHOLESALE_OPS),
    )
    monkeypatch.setattr(
        regos_webhook_service.telegram_service,
        "notify_company_subscribers",
        AsyncMock(return_value=1),
    )

    event_spec = regos_webhook_service.EVENT_SPECS["DocWholeSalePerformed"]
    await regos_webhook_service._process_operation_document(
        AsyncMock(),
        company_id=1,
        document_id=1,
        event_spec=event_spec,
        event_action="DocWholeSalePerformed",
        background_tasks=background_tasks,
    )

    assert len(scheduled) == 1
    func, args = scheduled[0]
    assert func.__name__ == "process_out_of_stock_for_document"
    assert args == (1, "DocWholeSalePerformed", SAMPLE_WHOLESALE_DOC, SAMPLE_WHOLESALE_OPS)


@pytest.mark.asyncio
async def test_out_of_stock_excel_callback_sends_report(client, monkeypatch, session_factory):
    from unittest.mock import AsyncMock, patch

    await _setup_webhook_company(client, monkeypatch, session_factory)

    async with session_factory() as session:
        from app.models import TelegramBot

        bot = (await session.execute(select(TelegramBot))).scalar_one()
        webhook_secret = bot.webhook_secret
        session.add(OutOfStockProduct(company_id=bot.company_id, product_id=101, stock_id=10))
        await session.commit()

    document_calls: list[dict] = []

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

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "answerCallbackQuery":
            return {"ok": True, "result": True}
        if method in {"getMe", "setWebhook", "sendMessage"}:
            return {"ok": True, "result": True}
        raise AssertionError(method)

    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)
    monkeypatch.setattr("app.services.telegram.send_document", fake_send_document)

    sample_report = [
        {
            "product_id": 101,
            "product_name": "Widget",
            "code": "W-001",
            "barcode": "",
            "stock_id": 10,
            "stock_name": "Main warehouse",
            "quantity": 2.0,
            "min_quantity": 5.0,
            "last_purchase_cost": 7000.0,
            "price": 22000.0,
            "detected_at": datetime.now(UTC),
        }
    ]

    with patch(
        "app.services.regos_out_of_stock.get_out_of_stock_report",
        new_callable=AsyncMock,
        return_value=sample_report,
    ):
        response = await client.post(
            f"/api/v1/telegram/webhook/{webhook_secret}",
            json={
                "update_id": 99,
                "callback_query": {
                    "id": "callback-1",
                    "from": {"id": 900001, "language_code": "en"},
                    "message": {"chat": {"id": 900001}},
                    "data": "oos_excel",
                },
            },
        )

    assert response.status_code == 200
    assert len(document_calls) == 1
    assert document_calls[0]["filename"] == "out-of-stock-report.xlsx"
    assert document_calls[0]["size"] > 0


def _webhook_payload_pos(
    event_action: str,
    resource_uuid: str,
    *,
    event_id: str = "oos-pos-evt-1",
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
async def test_check_and_record_out_of_stock_from_cheque_skips_return_cheque(session_factory):
    async with session_factory() as session:
        with patch(
            "app.services.regos_out_of_stock.fetch_items_stock_at_warehouse",
            new_callable=AsyncMock,
        ) as fetch_mock:
            notified = await out_of_stock_service.check_and_record_out_of_stock_from_cheque(
                session,
                company_id=1,
                cheque={**SAMPLE_POS_CHEQUE, "is_return": True},
                operations=SAMPLE_POS_CHEQUE_OPS,
            )

    assert notified == 0
    fetch_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_doc_cheque_closed_webhook_triggers_out_of_stock_notification(
    client, monkeypatch, session_factory
):
    await _setup_webhook_company(client, monkeypatch, session_factory)

    oos_messages: list[str] = []

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        if endpoint == "doccheque/get":
            return {"ok": True, "result": [SAMPLE_POS_CHEQUE]}
        if endpoint == "chequeitemoperation/get":
            return {"ok": True, "result": SAMPLE_POS_CHEQUE_OPS}
        if endpoint == "chequepaymentoperation/get":
            return {"ok": True, "result": SAMPLE_POS_PAYMENTS}
        if endpoint == "item/getext":
            return {
                "ok": True,
                "result": [
                    {
                        "item": {
                            "id": 101,
                            "name": "Widget",
                            "min_quantity": 5,
                        },
                        "quantity": {"allowed": 2},
                        "price": 22000,
                        "last_purchase_cost": 7000,
                    }
                ],
            }
        if endpoint == "Stock/Get":
            return {"ok": True, "result": [{"id": 10, "name": "Main warehouse"}]}
        raise AssertionError(endpoint)

    async def fake_telegram(bot_token: str, method: str, payload: dict | None = None) -> dict:
        if method == "sendMessage":
            oos_messages.append(payload["text"])
            return {"ok": True, "result": {"message_id": 1}}
        if method in {"getMe", "setWebhook"}:
            return {"ok": True, "result": True}
        raise AssertionError(method)

    monkeypatch.setattr(
        "app.services.regos_pos_fetch.regos_async_api_request_for_company",
        fake_regos,
    )
    monkeypatch.setattr(
        "app.services.regos_out_of_stock.regos_async_api_request_for_company",
        fake_regos,
    )
    monkeypatch.setattr(
        "app.services.regos_document_fetch.regos_async_api_request_for_company",
        fake_regos,
    )
    monkeypatch.setattr("app.services.telegram._telegram_api_call", fake_telegram)

    response = await client.post(
        "/api/v1/regos/webhook",
        json=_webhook_payload_pos("DocChequeClosed", CHEQUE_UUID),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    async with session_factory() as session:
        rows = (await session.execute(select(OutOfStockProduct))).scalars().all()
        assert len(rows) == 1
        assert rows[0].product_id == 101
        assert rows[0].stock_id == 10

    assert any(
        "Widget" in message and ("Out of stock" in message or "Нет в наличии" in message)
        for message in oos_messages
    )
