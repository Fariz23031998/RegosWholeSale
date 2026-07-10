import asyncio

import pytest
from httpx import AsyncClient

from app.services.settings_events import get_settings_event_hub, publish_settings_updated
from tests.helpers import register_owner


@pytest.mark.asyncio
async def test_settings_event_hub_publish_subscribe() -> None:
    hub = get_settings_event_hub()

    async def collect() -> dict:
        async for event in hub.subscribe(company_id=42):
            return event
        raise AssertionError("No event received")

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)

    publish_settings_updated(
        42,
        scope="company",
        namespace="pos",
    )

    event = await asyncio.wait_for(task, timeout=2)
    assert event["type"] == "settings_updated"
    assert event["scope"] == "company"
    assert event["namespace"] == "pos"
    assert "occurred_at" in event


@pytest.mark.asyncio
async def test_settings_event_hub_employee_event() -> None:
    hub = get_settings_event_hub()

    async def collect() -> dict:
        async for event in hub.subscribe(company_id=10):
            return event
        raise AssertionError("No event received")

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)

    publish_settings_updated(
        10,
        scope="employee",
        namespace="regos_defaults",
        user_id=5,
    )

    event = await asyncio.wait_for(task, timeout=2)
    assert event["type"] == "settings_updated"
    assert event["scope"] == "employee"
    assert event["namespace"] == "regos_defaults"
    assert event["user_id"] == 5


@pytest.mark.asyncio
async def test_settings_events_sse_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/api/v1/settings-events")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_settings_events_sse_accepts_query_token(client: AsyncClient) -> None:
    reg = await register_owner(client, email="settings-sse@test.com", company_name="Settings SSE Co")
    token = reg.json()["access_token"]

    async with client.stream(
        "GET",
        "/api/v1/settings-events",
        params={"access_token": token},
        timeout=2,
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")


@pytest.mark.asyncio
async def test_patch_company_pos_publishes_settings_event(client: AsyncClient) -> None:
    reg = await register_owner(client, email="settings-patch@test.com", company_name="Settings Patch Co")
    auth_token = reg.json()["access_token"]
    company_id = reg.json()["user"]["company_id"]

    hub = get_settings_event_hub()

    async def collect() -> dict:
        async for event in hub.subscribe(company_id=company_id):
            return event
        raise AssertionError("No event received")

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)

    response = await client.patch(
        "/api/v1/company/settings/pos",
        json={"allow_out_of_stock": True},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert response.status_code == 200

    event = await asyncio.wait_for(task, timeout=2)
    assert event["type"] == "settings_updated"
    assert event["scope"] == "company"
    assert event["namespace"] == "pos"
