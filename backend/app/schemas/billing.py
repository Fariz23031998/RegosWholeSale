from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class BillingSubscriptionResponse(BaseModel):
    subscription_status: str
    subscription_expires_at: datetime | None
    subscription_active: bool
    monthly_price_uzs: int
    allowed_periods: list[int]
    checkout_enabled: bool
    currency: str = "UZS"


class CheckoutRequest(BaseModel):
    period_months: int = Field(..., description="1, 3, 6, or 12")


class CheckoutOrderResponse(BaseModel):
    id: str
    company_id: int
    amount: Decimal
    currency: str
    period_months: int
    period_days: int
    status: str
    payment_provider: str | None = None
    payment_transaction_id: str | None = None
    payment_url: str | None = None
    created_at: datetime | None = None
    paid_at: datetime | None = None
    expires_at: datetime


class CheckoutCreateResponse(BaseModel):
    order: CheckoutOrderResponse
    payment_url: str
