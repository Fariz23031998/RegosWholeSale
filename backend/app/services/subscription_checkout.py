"""Self-serve SaaS subscription checkout orders fulfilled via Click."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import bad_request, not_found
from app.models import Company, SubscriptionCheckoutOrder
from app.models.subscription_checkout_order import CheckoutOrderStatus
from app.services import click_payments
from app.services.subscription_payments import period_days_for_months, record_subscription_payment

ORDER_EXPIRATION_HOURS = 24


def checkout_amount_for_months(period_months: int) -> Decimal:
    if period_months not in click_payments.ALLOWED_CHECKOUT_PERIODS:
        raise bad_request("Invalid subscription period", "INVALID_PERIOD")
    monthly = get_settings().subscription_monthly_price_uzs
    if monthly <= 0:
        raise bad_request("Subscription checkout is not configured", "CHECKOUT_NOT_CONFIGURED")
    return Decimal(monthly * period_months)


async def create_checkout_order(
    session: AsyncSession,
    company: Company,
    *,
    period_months: int,
) -> tuple[SubscriptionCheckoutOrder, str]:
    if not click_payments.is_checkout_configured():
        raise bad_request("Subscription checkout is not configured", "CHECKOUT_NOT_CONFIGURED")

    amount = checkout_amount_for_months(period_months)
    now = datetime.now(UTC)
    order = SubscriptionCheckoutOrder(
        id=str(uuid.uuid4()),
        company_id=company.id,
        amount=amount,
        currency="UZS",
        period_months=period_months,
        period_days=period_days_for_months(period_months),
        status=CheckoutOrderStatus.pending.value,
        expires_at=now + timedelta(hours=ORDER_EXPIRATION_HOURS),
    )
    session.add(order)
    await session.flush()
    payment_url = click_payments.format_click_url(order_id=order.id, amount=amount)
    return order, payment_url


async def get_checkout_order(
    session: AsyncSession, order_id: str
) -> SubscriptionCheckoutOrder | None:
    result = await session.execute(
        select(SubscriptionCheckoutOrder).where(SubscriptionCheckoutOrder.id == order_id)
    )
    return result.scalar_one_or_none()


async def get_company_checkout_order(
    session: AsyncSession, *, company_id: int, order_id: str
) -> SubscriptionCheckoutOrder:
    order = await get_checkout_order(session, order_id)
    if order is None or order.company_id != company_id:
        raise not_found("Order not found", "ORDER_NOT_FOUND")
    _expire_if_needed(order)
    return order


def _expire_if_needed(order: SubscriptionCheckoutOrder) -> None:
    if order.status != CheckoutOrderStatus.pending.value:
        return
    expires_at = order.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if datetime.now(UTC) >= expires_at:
        order.status = CheckoutOrderStatus.expired.value


def _amount_matches(order: SubscriptionCheckoutOrder, amount_raw: object) -> bool:
    try:
        return float(amount_raw) == float(order.amount)
    except (TypeError, ValueError):
        return False


async def click_prepare(session: AsyncSession, payload: dict) -> dict:
    if not click_payments.verify_click_signature(payload):
        return {"error": -1, "error_note": "SIGN CHECK FAILED"}

    order_id = click_payments.order_id_from_merchant_trans_id(
        str(payload.get("merchant_trans_id", ""))
    )
    if not order_id:
        return {"error": -5, "error_note": "Order not found"}

    order = await get_checkout_order(session, order_id)
    if order is None:
        return {"error": -5, "error_note": "Order not found"}
    _expire_if_needed(order)

    if order.status == CheckoutOrderStatus.paid.value:
        return {"error": -4, "error_note": "Order is already paid"}
    if order.status != CheckoutOrderStatus.pending.value:
        return {"error": -5, "error_note": "Order not found"}
    if not _amount_matches(order, payload.get("amount")):
        return {"error": -2, "error_note": "Incorrect amount"}

    return {
        "click_trans_id": payload.get("click_trans_id"),
        "merchant_trans_id": payload.get("merchant_trans_id"),
        "merchant_prepare_id": order.id,
        "error": 0,
        "error_note": "Success",
    }


async def click_complete(session: AsyncSession, payload: dict) -> dict:
    if not click_payments.verify_click_signature(payload):
        return {"error": -1, "error_note": "SIGN CHECK FAILED"}

    order_id = click_payments.order_id_from_merchant_trans_id(
        str(payload.get("merchant_trans_id", ""))
    )
    if not order_id:
        return {"error": -5, "error_note": "Order not found"}

    order = await get_checkout_order(session, order_id)
    if order is None:
        return {"error": -5, "error_note": "Order not found"}
    _expire_if_needed(order)

    if not _amount_matches(order, payload.get("amount")):
        return {"error": -2, "error_note": "Incorrect amount"}

    click_trans_id = str(payload.get("click_trans_id", ""))

    if order.status == CheckoutOrderStatus.paid.value:
        return {
            "click_trans_id": click_trans_id,
            "merchant_trans_id": payload.get("merchant_trans_id"),
            "merchant_confirm_id": order.id,
            "error": 0,
            "error_note": "Success",
        }

    if order.status != CheckoutOrderStatus.pending.value:
        return {"error": -5, "error_note": "Order not found"}

    company = await session.get(Company, order.company_id)
    if company is None:
        return {"error": -5, "error_note": "Order not found"}

    await record_subscription_payment(
        session,
        company,
        amount=order.amount,
        period_months=order.period_months,
        currency=order.currency,
        notes=f"Click #{click_trans_id}" if click_trans_id else "Click payment",
        recorded_by_admin_id=None,
    )
    order.status = CheckoutOrderStatus.paid.value
    order.payment_provider = "click"
    order.payment_transaction_id = click_trans_id or None
    order.paid_at = datetime.now(UTC)
    await session.flush()

    return {
        "click_trans_id": click_trans_id,
        "merchant_trans_id": payload.get("merchant_trans_id"),
        "merchant_confirm_id": order.id,
        "error": 0,
        "error_note": "Success",
    }
