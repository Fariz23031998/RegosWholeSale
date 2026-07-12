import pytest
from datetime import datetime, timedelta, timezone
from httpx import AsyncClient
from sqlalchemy import select
from unittest.mock import patch

from app.models import EventsLog
from app.services import events_log as events_log_service
from tests.helpers import register_owner


@pytest.mark.asyncio
async def test_events_log_service(session_factory) -> None:
    company_id = 1

    async with session_factory() as db_session:
        since = datetime.now(timezone.utc) - timedelta(hours=1)
        assert await events_log_service.has_history_since(db_session, company_id, since) is True

        await events_log_service.record_product_changes(
            db_session, company_id, "product_updated", [101, 102], "ItemEdited"
        )
        await events_log_service.record_product_changes(
            db_session, company_id, "product_removed", [103], "ItemDeleted"
        )
        await events_log_service.record_product_changes(
            db_session, company_id, "groups_invalidated", None, "ItemGroupEdited"
        )
        await db_session.commit()

        stmt = select(EventsLog).where(EventsLog.company_id == company_id)
        result = await db_session.execute(stmt)
        rows = result.scalars().all()
        assert len(rows) == 4  # 2 updated + 1 removed + 1 groups invalidated

        since_recent = datetime.now(timezone.utc) - timedelta(minutes=10)
        assert await events_log_service.has_history_since(db_session, company_id, since_recent) is True

        since_old = datetime.now(timezone.utc) - timedelta(days=40)
        assert await events_log_service.has_history_since(db_session, company_id, since_old) is False

        changes = await events_log_service.get_changes_since(db_session, company_id, since_recent)
        assert changes.updated_item_ids == [101, 102]
        assert changes.removed_item_ids == [103]
        assert changes.groups_invalidated is True

        deleted_count = await events_log_service.cleanup_old_entries(db_session, company_id, retention_days=1)
        assert deleted_count == 0

        deleted_count = await events_log_service.cleanup_old_entries(db_session, company_id, retention_days=-1)
        assert deleted_count == 4
        await db_session.commit()


@pytest.mark.asyncio
async def test_sync_products_endpoint(client: AsyncClient, session_factory) -> None:
    reg = await register_owner(client, email="sync-owner@test.com", company_name="Sync Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    company_id = reg.json()["user"]["company_id"]

    since_str = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    response = await client.get(
        "/api/v1/regos/products/sync",
        params={"since": since_str},
        headers=headers,
    )
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["full_sync_required"] is False
    assert res_data["updated_products"] == []
    assert res_data["removed_product_ids"] == []
    assert res_data["groups_invalidated"] is False

    async with session_factory() as db_session:
        await events_log_service.record_product_changes(
            db_session, company_id, "product_updated", [42], "ItemEdited"
        )
        await db_session.commit()

    since_str = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat().replace("+00:00", "Z")
    dummy_product = {
        "id": "42",
        "regos_item_id": 42,
        "name": "Sync Test Item",
        "sku": "SYNC-01",
        "category": "Test",
        "price": 100.0,
        "stock": 10.0,
    }
    with patch("app.services.regos_products.get_products_by_ids", return_value=[dummy_product]):
        response = await client.get(
            "/api/v1/regos/products/sync",
            params={"since": since_str},
            headers=headers,
        )
        assert response.status_code == 200
        res_data = response.json()
        assert res_data["full_sync_required"] is False
        assert len(res_data["updated_products"]) == 1
        assert res_data["updated_products"][0]["name"] == "Sync Test Item"
        assert res_data["removed_product_ids"] == []
        assert res_data["groups_invalidated"] is False

    since_old_str = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat().replace("+00:00", "Z")
    response = await client.get(
        "/api/v1/regos/products/sync",
        params={"since": since_old_str},
        headers=headers,
    )
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["full_sync_required"] is True
    assert "synced_at" in res_data


@pytest.mark.asyncio
async def test_events_log_meta_changes(session_factory) -> None:
    company_id = 1
    async with session_factory() as db_session:
        since = datetime.now(timezone.utc) - timedelta(minutes=10)
        await events_log_service.record_reference_options_invalidated(
            db_session, company_id, ["warehouse", "price_type"], "StockEdited"
        )
        await events_log_service.record_payment_type_changes(
            db_session,
            company_id,
            events_log_service.CHANGE_PAYMENT_TYPE_UPD,
            [7],
            "PaymentTypeAdded",
        )
        await events_log_service.record_settings_updated(
            db_session,
            company_id,
            scope="company",
            namespace="receipt_templates",
        )
        await events_log_service.record_settings_updated(
            db_session,
            company_id,
            scope="employee",
            namespace="regos_defaults",
            user_id=42,
        )
        await db_session.commit()

        meta = await events_log_service.get_meta_changes_since(db_session, company_id, since)
        assert meta.reference_kinds == ["price_type", "warehouse"]
        assert meta.payment_types_invalidated is True
        assert len(meta.settings) == 2
        namespaces = {(s.scope, s.namespace, s.user_id) for s in meta.settings}
        assert ("company", "receipt_templates", None) in namespaces
        assert ("employee", "regos_defaults", 42) in namespaces

        # Product query must ignore meta events.
        product_changes = await events_log_service.get_changes_since(
            db_session, company_id, since
        )
        assert product_changes.updated_item_ids == []
        assert product_changes.removed_item_ids == []
        assert product_changes.groups_invalidated is False


@pytest.mark.asyncio
async def test_sync_meta_endpoint(client: AsyncClient, session_factory) -> None:
    reg = await register_owner(client, email="meta-sync-owner@test.com", company_name="Meta Sync Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    company_id = reg.json()["user"]["company_id"]

    since_str = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    response = await client.get(
        "/api/v1/regos/meta/sync",
        params={"since": since_str},
        headers=headers,
    )
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["full_sync_required"] is False
    assert res_data["reference_kinds"] == []
    assert res_data["payment_types_invalidated"] is False
    assert res_data["settings"] == []

    async with session_factory() as db_session:
        await events_log_service.record_reference_options_invalidated(
            db_session, company_id, ["partner"], "PartnerEdited"
        )
        await events_log_service.record_settings_updated(
            db_session,
            company_id,
            scope="company",
            namespace="pos",
        )
        await db_session.commit()

    since_str = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat().replace("+00:00", "Z")
    response = await client.get(
        "/api/v1/regos/meta/sync",
        params={"since": since_str},
        headers=headers,
    )
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["full_sync_required"] is False
    assert res_data["reference_kinds"] == ["partner"]
    assert res_data["settings"] == [
        {"scope": "company", "namespace": "pos", "user_id": None}
    ]

    since_old_str = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat().replace("+00:00", "Z")
    response = await client.get(
        "/api/v1/regos/meta/sync",
        params={"since": since_old_str},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["full_sync_required"] is True
