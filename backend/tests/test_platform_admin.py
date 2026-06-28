import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.security import decode_access_token, token_type
from app.models import PlatformAdmin
from helpers import register_owner


@pytest.fixture(autouse=True)
async def seed_platform_admin(session_factory: async_sessionmaker[AsyncSession]):
    async with session_factory() as session:
        from app.services.platform_admin import create_platform_admin

        existing = await session.scalar(select(PlatformAdmin.id).limit(1))
        if existing is None:
            await create_platform_admin(
                session,
                email="platform@test.com",
                username="platform-admin",
                password="platform-pass-123",
                display_name="Test Platform Admin",
            )
            await session.commit()


@pytest.mark.asyncio
async def test_platform_login_token_type(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/platform/auth/login",
        json={"login": "platform@test.com", "password": "platform-pass-123"},
    )
    assert response.status_code == 200
    payload = decode_access_token(response.json()["access_token"])
    assert token_type(payload) == "platform"


@pytest.mark.asyncio
async def test_tenant_token_rejected_on_platform_endpoints(client: AsyncClient) -> None:
    reg = await register_owner(client, email="tenant@test.com", company_name="Tenant Co")
    tenant_token = reg.json()["access_token"]

    stats = await client.get(
        "/api/v1/platform/stats",
        headers={"Authorization": f"Bearer {tenant_token}"},
    )
    assert stats.status_code == 401


@pytest.mark.asyncio
async def test_platform_token_rejected_on_tenant_endpoints(client: AsyncClient) -> None:
    login = await client.post(
        "/api/v1/platform/auth/login",
        json={"login": "platform@test.com", "password": "platform-pass-123"},
    )
    platform_token = login.json()["access_token"]

    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {platform_token}"},
    )
    assert me.status_code == 401


@pytest.mark.asyncio
async def test_platform_admin_crud(client: AsyncClient) -> None:
    login = await client.post(
        "/api/v1/platform/auth/login",
        json={"login": "platform@test.com", "password": "platform-pass-123"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post(
        "/api/v1/platform/admins",
        headers=headers,
        json={
            "email": "second-admin@test.com",
            "username": "second-admin",
            "password": "second-pass-123",
            "display_name": "Second Admin",
        },
    )
    assert create.status_code == 201

    listing = await client.get("/api/v1/platform/admins", headers=headers)
    assert listing.status_code == 200
    emails = {item["email"] for item in listing.json()}
    assert "second-admin@test.com" in emails


@pytest.mark.asyncio
async def test_platform_login_with_username(client: AsyncClient) -> None:
    login = await client.post(
        "/api/v1/platform/auth/login",
        json={"login": "platform-admin", "password": "platform-pass-123"},
    )
    assert login.status_code == 200
    assert login.json()["admin"]["email"] == "platform@test.com"


@pytest.mark.asyncio
async def test_platform_change_password(client: AsyncClient) -> None:
    login = await client.post(
        "/api/v1/platform/auth/login",
        json={"login": "platform@test.com", "password": "platform-pass-123"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    bad = await client.post(
        "/api/v1/platform/auth/change-password",
        headers=headers,
        json={"current_password": "wrong", "new_password": "new-pass-12345"},
    )
    assert bad.status_code == 401

    ok = await client.post(
        "/api/v1/platform/auth/change-password",
        headers=headers,
        json={"current_password": "platform-pass-123", "new_password": "new-pass-12345"},
    )
    assert ok.status_code == 200

    relogin = await client.post(
        "/api/v1/platform/auth/login",
        json={"login": "platform-admin", "password": "new-pass-12345"},
    )
    assert relogin.status_code == 200


@pytest.mark.asyncio
async def test_reset_subscription(client: AsyncClient) -> None:
    reg = await register_owner(client, email="reset@test.com", company_name="Reset Co")
    company_id = reg.json()["user"]["company_id"]

    login = await client.post(
        "/api/v1/platform/auth/login",
        json={"login": "platform@test.com", "password": "platform-pass-123"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    payment = await client.post(
        f"/api/v1/platform/companies/{company_id}/payments",
        headers=headers,
        json={"amount": 100000, "currency": "UZS", "period_months": 3},
    )
    assert payment.status_code == 201
    assert payment.json()["company"]["subscription_status"] == "active"

    reset = await client.patch(
        f"/api/v1/platform/companies/{company_id}",
        headers=headers,
        json={"reset_subscription": True},
    )
    assert reset.status_code == 200
    assert reset.json()["subscription_status"] == "trial"


@pytest.mark.asyncio
async def test_manual_company_creation(client: AsyncClient) -> None:
    login = await client.post(
        "/api/v1/platform/auth/login",
        json={"login": "platform@test.com", "password": "platform-pass-123"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post(
        "/api/v1/platform/companies",
        headers=headers,
        json={
            "company_name": "Manual Co",
            "owner_email": "manual-owner@test.com",
            "owner_password": "password123",
            "owner_display_name": "Manual Owner",
            "active_days": 60,
        },
    )
    assert create.status_code == 201
    assert create.json()["subscription_status"] == "active"
    assert create.json()["owner"]["email"] == "manual-owner@test.com"

    tenant_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "manual-owner@test.com", "password": "password123"},
    )
    assert tenant_login.status_code == 200
