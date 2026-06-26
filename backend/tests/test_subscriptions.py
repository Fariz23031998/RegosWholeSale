from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.security import decode_access_token, token_type
from app.models import Company, PlatformAdmin
from app.models.subscription import SubscriptionStatus
from helpers import register_owner


@pytest.mark.asyncio
async def test_registration_starts_seven_day_trial(
    client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    reg = await register_owner(client, email="trial@test.com", company_name="Trial Co")
    assert reg.status_code == 200
    company_id = reg.json()["user"]["company_id"]

    async with session_factory() as session:
        company = await session.get(Company, company_id)
        assert company is not None
        assert company.subscription_status == SubscriptionStatus.trial
        delta = company.subscription_expires_at.replace(tzinfo=UTC) - datetime.now(UTC)
        assert 6 <= delta.days <= 7


@pytest.mark.asyncio
async def test_expired_trial_blocks_login(
    client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    reg = await register_owner(client, email="expired@test.com", company_name="Expired Co")
    assert reg.status_code == 200
    company_id = reg.json()["user"]["company_id"]

    async with session_factory() as session:
        company = await session.get(Company, company_id)
        assert company is not None
        company.subscription_expires_at = datetime.now(UTC) - timedelta(days=1)
        company.subscription_status = SubscriptionStatus.expired
        await session.commit()

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "expired@test.com", "password": "password123"},
    )
    assert login.status_code == 403
    assert login.json()["code"] == "SUBSCRIPTION_EXPIRED"


@pytest.mark.asyncio
async def test_expired_trial_blocks_me(
    client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    reg = await register_owner(client, email="me-expired@test.com", company_name="Me Expired")
    token = reg.json()["access_token"]
    company_id = reg.json()["user"]["company_id"]

    async with session_factory() as session:
        company = await session.get(Company, company_id)
        assert company is not None
        company.subscription_expires_at = datetime.now(UTC) - timedelta(days=1)
        company.subscription_status = SubscriptionStatus.expired
        await session.commit()

    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 403
    assert me.json()["code"] == "SUBSCRIPTION_EXPIRED"


@pytest.mark.asyncio
async def test_platform_admin_extends_subscription(
    client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    reg = await register_owner(client, email="extend@test.com", company_name="Extend Co")
    company_id = reg.json()["user"]["company_id"]

    async with session_factory() as session:
        company = await session.get(Company, company_id)
        assert company is not None
        company.subscription_expires_at = datetime.now(UTC) - timedelta(days=1)
        company.subscription_status = SubscriptionStatus.expired
        await session.commit()

    login_blocked = await client.post(
        "/api/v1/auth/login",
        json={"email": "extend@test.com", "password": "password123"},
    )
    assert login_blocked.status_code == 403

    admin_login = await client.post(
        "/api/v1/platform/auth/login",
        json={"login": "platform@test.com", "password": "platform-pass-123"},
    )
    assert admin_login.status_code == 200
    admin_token = admin_login.json()["access_token"]

    extend = await client.patch(
        f"/api/v1/platform/companies/{company_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"extend_days": 30, "status": "active"},
    )
    assert extend.status_code == 200
    assert extend.json()["subscription_status"] == "active"

    login_ok = await client.post(
        "/api/v1/auth/login",
        json={"email": "extend@test.com", "password": "password123"},
    )
    assert login_ok.status_code == 200


@pytest.fixture(autouse=True)
async def seed_platform_admin(session_factory: async_sessionmaker[AsyncSession]):
    async with session_factory() as session:
        from app.services.platform_admin import create_platform_admin

        existing = await session.scalar(select(PlatformAdmin.id).limit(1))
        if existing is None:
            await create_platform_admin(
                session,
                email="platform@test.com",
                password="platform-pass-123",
                display_name="Test Platform Admin",
            )
            await session.commit()
