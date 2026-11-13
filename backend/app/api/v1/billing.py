from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user_allow_expired
from app.database import get_db
from app.models import Company
from app.schemas.billing import (
    BillingSubscriptionResponse,
    CheckoutCreateResponse,
    CheckoutOrderResponse,
    CheckoutRequest,
)
from app.services import click_payments
from app.services import subscription_checkout as checkout_service
from app.services.subscriptions import is_subscription_active

router = APIRouter(prefix="/billing", tags=["billing"])


def _order_response(
    order, *, payment_url: str | None = None
) -> CheckoutOrderResponse:
    return CheckoutOrderResponse(
        id=order.id,
        company_id=order.company_id,
        amount=order.amount,
        currency=order.currency,
        period_months=order.period_months,
        period_days=order.period_days,
        status=order.status,
        payment_provider=order.payment_provider,
        payment_transaction_id=order.payment_transaction_id,
        payment_url=payment_url,
        created_at=getattr(order, "created_at", None),
        paid_at=order.paid_at,
        expires_at=order.expires_at,
    )


@router.get("/subscription", response_model=BillingSubscriptionResponse)
async def get_billing_subscription(
    current: CurrentUser = Depends(get_current_user_allow_expired),
    session: AsyncSession = Depends(get_db),
) -> BillingSubscriptionResponse:
    from app.config import get_settings

    company = await session.get(Company, current.company_id)
    settings = get_settings()
    active = bool(company and is_subscription_active(company))
    return BillingSubscriptionResponse(
        subscription_status=company.subscription_status.value if company else "expired",
        subscription_expires_at=company.subscription_expires_at if company else None,
        subscription_active=active,
        monthly_price_uzs=settings.subscription_monthly_price_uzs,
        allowed_periods=list(click_payments.ALLOWED_CHECKOUT_PERIODS),
        checkout_enabled=click_payments.is_checkout_configured(),
    )


@router.post("/checkout", response_model=CheckoutCreateResponse)
async def create_checkout(
    body: CheckoutRequest,
    current: CurrentUser = Depends(get_current_user_allow_expired),
    session: AsyncSession = Depends(get_db),
) -> CheckoutCreateResponse:
    from app.core.exceptions import not_found

    company = await session.get(Company, current.company_id)
    if company is None:
        raise not_found("Company not found", "COMPANY_NOT_FOUND")
    order, payment_url = await checkout_service.create_checkout_order(
        session, company, period_months=body.period_months
    )
    await session.commit()
    return CheckoutCreateResponse(
        order=_order_response(order, payment_url=payment_url),
        payment_url=payment_url,
    )


@router.get("/orders/{order_id}", response_model=CheckoutOrderResponse)
async def get_checkout_order(
    order_id: str,
    current: CurrentUser = Depends(get_current_user_allow_expired),
    session: AsyncSession = Depends(get_db),
) -> CheckoutOrderResponse:
    order = await checkout_service.get_company_checkout_order(
        session, company_id=current.company_id, order_id=order_id
    )
    await session.commit()
    payment_url = None
    if order.status == "pending" and click_payments.is_checkout_configured():
        try:
            payment_url = click_payments.format_click_url(
                order_id=order.id, amount=order.amount
            )
        except ValueError:
            payment_url = None
    return _order_response(order, payment_url=payment_url)
