from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models import Company, SubscriptionCheckoutOrder, SubscriptionPayment
from app.models.subscription import SubscriptionStatus
from app.services import click_payments
from helpers import register_owner


@pytest.fixture
def click_env(monkeypatch):
    monkeypatch.setenv("SUBSCRIPTION_MONTHLY_PRICE_UZS", "100000")
    monkeypatch.setenv("CLICK_MERCHANT_ID", "m1")
    monkeypatch.setenv("CLICK_SERVICE_ID", "s1")
    monkeypatch.setenv("CLICK_MERCHANT_USER_ID", "u1")
    monkeypatch.setenv("CLICK_SECRET_KEY", "secret")
    monkeypatch.setenv("CLICK_RETURN_URL", "https://regosoptom.uz/billing")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _sign(payload: dict) -> str:
    return click_payments.click_generate_sign_string(
        str(payload["click_trans_id"]),
        str(payload["service_id"]),
        "secret",
        str(payload["merchant_trans_id"]),
        str(payload.get("merchant_prepare_id", "")),
        str(payload["amount"]),
        str(payload["action"]),
        str(payload["sign_time"]),
    )


@pytest.mark.asyncio
async def test_checkout_creates_rw_click_url(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    click_env,
) -> None:
    reg = await register_owner(client, email="checkout@test.com", company_name="Checkout Co")
    token = reg.json()["access_token"]

    created = await client.post(
        "/api/v1/billing/checkout",
        headers={"Authorization": f"Bearer {token}"},
        json={"period_months": 3},
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["order"]["amount"] == "300000.00" or float(body["order"]["amount"]) == 300000
    assert body["order"]["period_months"] == 3
    assert "transaction_param=rw_" in body["payment_url"]
    assert body["payment_url"].startswith("https://my.click.uz/services/pay?")


@pytest.mark.asyncio
async def test_click_prepare_complete_extends_subscription(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    click_env,
) -> None:
    reg = await register_owner(client, email="pay-click@test.com", company_name="Pay Click")
    token = reg.json()["access_token"]
    company_id = reg.json()["user"]["company_id"]

    async with session_factory() as session:
        company = await session.get(Company, company_id)
        assert company is not None
        company.subscription_expires_at = datetime.now(UTC) - timedelta(days=1)
        company.subscription_status = SubscriptionStatus.expired
        await session.commit()

    created = await client.post(
        "/api/v1/billing/checkout",
        headers={"Authorization": f"Bearer {token}"},
        json={"period_months": 1},
    )
    assert created.status_code == 200, created.text
    order_id = created.json()["order"]["id"]
    amount = str(int(float(created.json()["order"]["amount"])))
    merchant_trans_id = f"rw_{order_id}"

    prepare_payload = {
        "click_trans_id": "1001",
        "service_id": "s1",
        "merchant_trans_id": merchant_trans_id,
        "amount": amount,
        "action": "0",
        "sign_time": "2026-01-01 12:00:00",
    }
    prepare_payload["sign_string"] = _sign(prepare_payload)
    prepare = await client.post("/api/v1/click/prepare", data=prepare_payload)
    assert prepare.status_code == 200, prepare.text
    assert prepare.json()["error"] == 0
    assert prepare.json()["merchant_prepare_id"] == order_id

    complete_payload = {
        **prepare_payload,
        "action": "1",
        "merchant_prepare_id": order_id,
        "click_trans_id": "1001",
    }
    complete_payload["sign_string"] = _sign(complete_payload)
    complete = await client.post("/api/v1/click/complete", data=complete_payload)
    assert complete.status_code == 200, complete.text
    assert complete.json()["error"] == 0

    # Idempotent second complete
    again = await client.post("/api/v1/click/complete", data=complete_payload)
    assert again.status_code == 200
    assert again.json()["error"] == 0

    async with session_factory() as session:
        company = await session.get(Company, company_id)
        assert company is not None
        assert company.subscription_status == SubscriptionStatus.active
        expires = company.subscription_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=UTC)
        assert expires > datetime.now(UTC)
        order = await session.get(SubscriptionCheckoutOrder, order_id)
        assert order is not None
        assert order.status == "paid"
        assert order.payment_transaction_id == "1001"
        payments = list(
            (
                await session.execute(
                    select(SubscriptionPayment).where(
                        SubscriptionPayment.company_id == company_id
                    )
                )
            ).scalars()
        )
        assert len(payments) == 1



@pytest.mark.asyncio
async def test_click_rejects_bad_signature(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    click_env,
) -> None:
    reg = await register_owner(client, email="bad-sign@test.com", company_name="Bad Sign")
    token = reg.json()["access_token"]
    created = await client.post(
        "/api/v1/billing/checkout",
        headers={"Authorization": f"Bearer {token}"},
        json={"period_months": 1},
    )
    order_id = created.json()["order"]["id"]
    payload = {
        "click_trans_id": "9",
        "service_id": "s1",
        "merchant_trans_id": f"rw_{order_id}",
        "amount": "100000",
        "action": "0",
        "sign_time": "2026-01-01 12:00:00",
        "sign_string": "deadbeef",
    }
    prepare = await client.post("/api/v1/click/prepare", data=payload)
    assert prepare.status_code == 200
    assert prepare.json()["error"] == -1


@pytest.mark.asyncio
async def test_click_rejects_amount_mismatch(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    click_env,
) -> None:
    reg = await register_owner(client, email="amt@test.com", company_name="Amt Co")
    token = reg.json()["access_token"]
    created = await client.post(
        "/api/v1/billing/checkout",
        headers={"Authorization": f"Bearer {token}"},
        json={"period_months": 1},
    )
    order_id = created.json()["order"]["id"]
    payload = {
        "click_trans_id": "9",
        "service_id": "s1",
        "merchant_trans_id": f"rw_{order_id}",
        "amount": "1",
        "action": "0",
        "sign_time": "2026-01-01 12:00:00",
    }
    payload["sign_string"] = _sign(payload)
    prepare = await client.post("/api/v1/click/prepare", data=payload)
    assert prepare.status_code == 200
    assert prepare.json()["error"] == -2
