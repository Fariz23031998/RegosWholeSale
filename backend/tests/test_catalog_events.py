import asyncio

import pytest
from httpx import AsyncClient

from app.services.catalog_events import (
    get_catalog_event_hub,
    publish_groups_invalidated,
    publish_payment_types_removed,
    publish_payment_types_updated,
    publish_products_removed,
    publish_products_updated,
    publish_reference_options_invalidated,
)
from tests.helpers import register_owner

INTEGRATION_TOKEN = "2" * 32


@pytest.mark.asyncio
async def test_catalog_event_hub_publish_subscribe() -> None:
    hub = get_catalog_event_hub()

    async def collect() -> dict:
        async for event in hub.subscribe(company_id=99):
            return event
        raise AssertionError("No event received")

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)

    publish_products_updated(
        99,
        regos_item_ids=[101, 102],
        source_action="ItemEdited",
    )

    event = await asyncio.wait_for(task, timeout=2)
    assert event["type"] == "products_updated"
    assert event["regos_item_ids"] == [101, 102]
    assert event["source_action"] == "ItemEdited"


@pytest.mark.asyncio
async def test_catalog_event_hub_removed_and_groups() -> None:
    hub = get_catalog_event_hub()
    received: list[dict] = []

    async def collect() -> None:
        count = 0
        async for event in hub.subscribe(company_id=77):
            received.append(event)
            count += 1
            if count >= 2:
                return

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)

    publish_products_removed(77, regos_item_ids=[5], source_action="ItemDeleted")
    publish_groups_invalidated(77, source_action="ItemGroupEdited")

    await asyncio.wait_for(task, timeout=2)
    assert received[0]["type"] == "products_removed"
    assert received[0]["regos_item_ids"] == [5]
    assert received[1]["type"] == "groups_invalidated"


@pytest.mark.asyncio
async def test_catalog_events_sse_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/api/v1/regos/catalog-events")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_catalog_events_sse_accepts_query_token(client: AsyncClient) -> None:
    reg = await register_owner(client, email="catalog-sse@test.com", company_name="Catalog SSE Co")
    token = reg.json()["access_token"]

    async with client.stream(
        "GET",
        "/api/v1/regos/catalog-events",
        params={"access_token": token},
        timeout=2,
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")


@pytest.mark.asyncio
async def test_item_edited_webhook_publishes_catalog_event(client: AsyncClient) -> None:
    reg = await register_owner(client, email="catalog-webhook@test.com", company_name="Catalog Webhook Co")
    auth_token = reg.json()["access_token"]
    company_id = reg.json()["user"]["company_id"]

    save_token = await client.put(
        "/api/v1/regos/tokens",
        json={"token": INTEGRATION_TOKEN, "is_replicable": False},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert save_token.status_code == 200

    from app.services import regos_webhook as regos_webhook_service

    regos_webhook_service.processed_webhook_events.clear()

    hub = get_catalog_event_hub()

    async def collect() -> dict:
        async for event in hub.subscribe(company_id=company_id):
            return event
        raise AssertionError("No event received")

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)

    response = await client.post(
        "/api/v1/regos/webhook",
        json={
            "action": "HandleWebhook",
            "event_id": "catalog-item-edited-1",
            "connected_integration_id": INTEGRATION_TOKEN,
            "data": {
                "action": "ItemEdited",
                "data": {"id": 101},
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    event = await asyncio.wait_for(task, timeout=2)
    assert event["type"] == "products_updated"
    assert event["regos_item_ids"] == [101]
    assert event["source_action"] == "ItemEdited"


@pytest.mark.asyncio
async def test_catalog_event_hub_payment_types() -> None:
    hub = get_catalog_event_hub()
    received: list[dict] = []

    async def collect() -> None:
        count = 0
        async for event in hub.subscribe(company_id=55):
            received.append(event)
            count += 1
            if count >= 2:
                return

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)

    publish_payment_types_updated(55, payment_type_ids=[3, 4], source_action="PaymentTypeAdded")
    publish_payment_types_removed(55, payment_type_ids=[3], source_action="PaymentTypeDeleted")

    await asyncio.wait_for(task, timeout=2)
    assert received[0]["type"] == "payment_types_updated"
    assert received[0]["payment_type_ids"] == [3, 4]
    assert received[0]["source_action"] == "PaymentTypeAdded"
    assert received[1]["type"] == "payment_types_removed"
    assert received[1]["payment_type_ids"] == [3]
    assert received[1]["source_action"] == "PaymentTypeDeleted"


@pytest.mark.asyncio
async def test_catalog_event_hub_reference_options_invalidated() -> None:
    hub = get_catalog_event_hub()

    async def collect() -> dict:
        async for event in hub.subscribe(company_id=88):
            return event
        raise AssertionError("No event received")

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)

    publish_reference_options_invalidated(
        88,
        kinds=["partner", "warehouse"],
        source_action="PartnerEdited",
    )

    event = await asyncio.wait_for(task, timeout=2)
    assert event["type"] == "reference_options_invalidated"
    assert event["kinds"] == ["partner", "warehouse"]
    assert event["source_action"] == "PartnerEdited"


@pytest.mark.asyncio
async def test_stock_added_webhook_publishes_reference_options_invalidated(
    client: AsyncClient,
) -> None:
    reg = await register_owner(
        client, email="stock-webhook@test.com", company_name="Stock Webhook Co"
    )
    auth_token = reg.json()["access_token"]
    company_id = reg.json()["user"]["company_id"]

    save_token = await client.put(
        "/api/v1/regos/tokens",
        json={"token": INTEGRATION_TOKEN, "is_replicable": False},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert save_token.status_code == 200

    from app.services import regos_webhook as regos_webhook_service

    regos_webhook_service.processed_webhook_events.clear()

    hub = get_catalog_event_hub()

    async def collect() -> dict:
        async for event in hub.subscribe(company_id=company_id):
            return event
        raise AssertionError("No event received")

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)

    response = await client.post(
        "/api/v1/regos/webhook",
        json={
            "action": "HandleWebhook",
            "event_id": "stock-added-1",
            "connected_integration_id": INTEGRATION_TOKEN,
            "data": {
                "action": "StockAdded",
                "data": {"id": 12},
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    event = await asyncio.wait_for(task, timeout=2)
    assert event["type"] == "reference_options_invalidated"
    assert event["kinds"] == ["warehouse"]
    assert event["source_action"] == "StockAdded"


@pytest.mark.asyncio
async def test_partner_edited_webhook_publishes_reference_options_invalidated(
    client: AsyncClient,
) -> None:
    reg = await register_owner(
        client, email="partner-webhook@test.com", company_name="Partner Webhook Co"
    )
    auth_token = reg.json()["access_token"]
    company_id = reg.json()["user"]["company_id"]

    save_token = await client.put(
        "/api/v1/regos/tokens",
        json={"token": INTEGRATION_TOKEN, "is_replicable": False},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert save_token.status_code == 200

    from app.services import regos_webhook as regos_webhook_service

    regos_webhook_service.processed_webhook_events.clear()

    hub = get_catalog_event_hub()

    async def collect() -> dict:
        async for event in hub.subscribe(company_id=company_id):
            return event
        raise AssertionError("No event received")

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)

    response = await client.post(
        "/api/v1/regos/webhook",
        json={
            "action": "HandleWebhook",
            "event_id": "partner-edited-1",
            "connected_integration_id": INTEGRATION_TOKEN,
            "data": {
                "action": "PartnerEdited",
                "data": {"id": 44},
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    event = await asyncio.wait_for(task, timeout=2)
    assert event["type"] == "reference_options_invalidated"
    assert event["kinds"] == ["partner"]
    assert event["source_action"] == "PartnerEdited"


@pytest.mark.asyncio
async def test_price_type_deleted_webhook_publishes_reference_options_invalidated(
    client: AsyncClient,
) -> None:
    reg = await register_owner(
        client, email="price-type-webhook@test.com", company_name="Price Type Webhook Co"
    )
    auth_token = reg.json()["access_token"]
    company_id = reg.json()["user"]["company_id"]

    save_token = await client.put(
        "/api/v1/regos/tokens",
        json={"token": INTEGRATION_TOKEN, "is_replicable": False},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert save_token.status_code == 200

    from app.services import regos_webhook as regos_webhook_service

    regos_webhook_service.processed_webhook_events.clear()

    hub = get_catalog_event_hub()

    async def collect() -> dict:
        async for event in hub.subscribe(company_id=company_id):
            return event
        raise AssertionError("No event received")

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)

    response = await client.post(
        "/api/v1/regos/webhook",
        json={
            "action": "HandleWebhook",
            "event_id": "price-type-deleted-1",
            "connected_integration_id": INTEGRATION_TOKEN,
            "data": {
                "action": "PriceTypeDeleted",
                "data": {"id": 8},
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    event = await asyncio.wait_for(task, timeout=2)
    assert event["type"] == "reference_options_invalidated"
    assert event["kinds"] == ["price_type"]
    assert event["source_action"] == "PriceTypeDeleted"


@pytest.mark.asyncio
async def test_payment_type_edited_webhook_publishes_catalog_event(client: AsyncClient) -> None:
    reg = await register_owner(
        client, email="payment-type-webhook@test.com", company_name="Payment Type Webhook Co"
    )
    auth_token = reg.json()["access_token"]
    company_id = reg.json()["user"]["company_id"]

    save_token = await client.put(
        "/api/v1/regos/tokens",
        json={"token": INTEGRATION_TOKEN, "is_replicable": False},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert save_token.status_code == 200

    from app.services import regos_webhook as regos_webhook_service

    regos_webhook_service.processed_webhook_events.clear()

    hub = get_catalog_event_hub()

    async def collect() -> dict:
        async for event in hub.subscribe(company_id=company_id):
            return event
        raise AssertionError("No event received")

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)

    response = await client.post(
        "/api/v1/regos/webhook",
        json={
            "action": "HandleWebhook",
            "event_id": "payment-type-edited-1",
            "connected_integration_id": INTEGRATION_TOKEN,
            "data": {
                "action": "PaymentTypeEdited",
                "data": {"id": 7},
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    event = await asyncio.wait_for(task, timeout=2)
    assert event["type"] == "payment_types_updated"
    assert event["payment_type_ids"] == [7]
    assert event["source_action"] == "PaymentTypeEdited"


@pytest.mark.asyncio
async def test_payment_type_deleted_webhook_publishes_catalog_event(client: AsyncClient) -> None:
    reg = await register_owner(
        client, email="payment-type-deleted@test.com", company_name="Payment Type Deleted Co"
    )
    auth_token = reg.json()["access_token"]
    company_id = reg.json()["user"]["company_id"]

    save_token = await client.put(
        "/api/v1/regos/tokens",
        json={"token": INTEGRATION_TOKEN, "is_replicable": False},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert save_token.status_code == 200

    from app.services import regos_webhook as regos_webhook_service

    regos_webhook_service.processed_webhook_events.clear()

    hub = get_catalog_event_hub()

    async def collect() -> dict:
        async for event in hub.subscribe(company_id=company_id):
            return event
        raise AssertionError("No event received")

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)

    response = await client.post(
        "/api/v1/regos/webhook",
        json={
            "action": "HandleWebhook",
            "event_id": "payment-type-deleted-1",
            "connected_integration_id": INTEGRATION_TOKEN,
            "data": {
                "action": "PaymentTypeDeleted",
                "data": {"id": 9},
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    event = await asyncio.wait_for(task, timeout=2)
    assert event["type"] == "payment_types_removed"
    assert event["payment_type_ids"] == [9]
    assert event["source_action"] == "PaymentTypeDeleted"
