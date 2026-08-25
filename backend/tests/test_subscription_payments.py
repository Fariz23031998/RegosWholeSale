import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Company, SubscriptionPayment
from helpers import register_owner


@pytest.fixture(autouse=True)
async def seed_platform_admin(session_factory: async_sessionmaker[AsyncSession]):
    async with session_factory() as session:
        from app.services.platform_admin import create_platform_admin

        from app.models import PlatformAdmin

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


async def _platform_token(client: AsyncClient) -> str:
    login = await client.post(
        "/api/v1/platform/auth/login",
        json={"login": "platform@test.com", "password": "platform-pass-123"},
    )
    assert login.status_code == 200
    return login.json()["access_token"]


@pytest.mark.asyncio
async def test_list_all_payments_and_stats(
    client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    reg1 = await register_owner(client, email="pay1@test.com", company_name="Alpha Co")
    reg2 = await register_owner(client, email="pay2@test.com", company_name="Beta Co")
    company1_id = reg1.json()["user"]["company_id"]
    company2_id = reg2.json()["user"]["company_id"]
    token = await _platform_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    for company_id, amount in ((company1_id, 100000), (company2_id, 250000)):
        response = await client.post(
            f"/api/v1/platform/companies/{company_id}/payments",
            headers=headers,
            json={"amount": amount, "currency": "UZS", "period_months": 1},
        )
        assert response.status_code == 201

    listing = await client.get("/api/v1/platform/payments", headers=headers)
    assert listing.status_code == 200
    body = listing.json()
    assert body["total"] == 2
    assert len(body["items"]) == 2
    company_names = {item["company_name"] for item in body["items"]}
    assert company_names == {"Alpha Co", "Beta Co"}

    filtered = await client.get(
        f"/api/v1/platform/payments?search=Alpha",
        headers=headers,
    )
    assert filtered.status_code == 200
    assert filtered.json()["total"] == 1
    assert filtered.json()["items"][0]["company_name"] == "Alpha Co"

    stats = await client.get("/api/v1/platform/stats", headers=headers)
    assert stats.status_code == 200
    stats_body = stats.json()
    assert stats_body["payment_count"] == 2
    assert stats_body["payment_total"] == 350000.0


@pytest.mark.asyncio
async def test_update_payment(client: AsyncClient) -> None:
    reg = await register_owner(client, email="editpay@test.com", company_name="Edit Pay Co")
    company_id = reg.json()["user"]["company_id"]
    token = await _platform_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    created = await client.post(
        f"/api/v1/platform/companies/{company_id}/payments",
        headers=headers,
        json={"amount": 100000, "currency": "UZS", "period_months": 1, "notes": "Original"},
    )
    assert created.status_code == 201
    payment_id = created.json()["payment"]["id"]

    updated = await client.patch(
        f"/api/v1/platform/payments/{payment_id}",
        headers=headers,
        json={"amount": 150000, "notes": "Corrected"},
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["amount"] == 150000
    assert body["notes"] == "Corrected"
    assert body["period_months"] == 1


@pytest.mark.asyncio
async def test_record_payment_activates_subscription(
    client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    reg = await register_owner(client, email="pay@test.com", company_name="Pay Co")
    company_id = reg.json()["user"]["company_id"]
    token = await _platform_token(client)

    response = await client.post(
        f"/api/v1/platform/companies/{company_id}/payments",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "amount": 500000,
            "currency": "UZS",
            "period_months": 1,
            "notes": "Cash payment",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["payment"]["amount"] == 500000
    assert body["payment"]["period_months"] == 1
    assert body["payment"]["period_days"] == 30
    assert body["company"]["subscription_status"] == "active"

    listing = await client.get(
        f"/api/v1/platform/companies/{company_id}/payments",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert listing.status_code == 200
    assert len(listing.json()) == 1
    assert listing.json()[0]["notes"] == "Cash payment"

    async with session_factory() as session:
        company = await session.get(Company, company_id)
        assert company is not None
        assert company.subscription_status.value == "active"
        payments = (
            await session.execute(
                select(SubscriptionPayment).where(SubscriptionPayment.company_id == company_id)
            )
        ).scalars().all()
        assert len(payments) == 1
