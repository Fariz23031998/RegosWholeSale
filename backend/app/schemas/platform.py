from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class PlatformLoginRequest(BaseModel):
    login: str = Field(min_length=1, max_length=255)
    password: str


class PlatformAdminResponse(BaseModel):
    id: int
    email: str
    username: str
    display_name: str
    is_active: bool
    created_at: datetime


class PlatformAuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    admin: PlatformAdminResponse


class CreatePlatformAdminRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=2, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=255)


class UpdatePlatformAdminRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    username: str | None = Field(default=None, min_length=2, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str | None = Field(default=None, min_length=8, max_length=128)
    is_active: bool | None = None


class ChangePlatformPasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class CompanyOwnerSummary(BaseModel):
    id: int
    email: str | None
    display_name: str


class PlatformCompanyListItem(BaseModel):
    id: int
    name: str
    slug: str
    subscription_status: str
    subscription_expires_at: datetime
    created_at: datetime
    user_count: int
    owner_email: str | None


class PlatformCompanyListResponse(BaseModel):
    items: list[PlatformCompanyListItem]
    total: int


class PlatformCompanyDetail(BaseModel):
    id: int
    name: str
    slug: str
    timezone: str
    subscription_status: str
    subscription_expires_at: datetime
    internal_notes: str | None
    created_at: datetime
    user_count: int
    owner: CompanyOwnerSummary | None


class CreatePlatformCompanyRequest(BaseModel):
    company_name: str = Field(min_length=1, max_length=255)
    owner_email: EmailStr
    owner_password: str = Field(min_length=8, max_length=128)
    owner_display_name: str = Field(min_length=1, max_length=255)
    trial_days: int | None = Field(default=None, ge=1, le=365)
    active_days: int | None = Field(default=None, ge=1, le=3650)


class UpdatePlatformCompanyRequest(BaseModel):
    status: str | None = None
    extend_days: int | None = Field(default=None, ge=1, le=3650)
    expires_at: datetime | None = None
    internal_notes: str | None = None
    reset_subscription: bool | None = None


class RecordSubscriptionPaymentRequest(BaseModel):
    amount: float = Field(gt=0)
    currency: str = Field(default="UZS", min_length=3, max_length=8)
    period_months: int = Field(default=1, ge=1, le=36)
    paid_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=2000)


class UpdateSubscriptionPaymentRequest(BaseModel):
    amount: float | None = Field(default=None, gt=0)
    currency: str | None = Field(default=None, min_length=3, max_length=8)
    period_months: int | None = Field(default=None, ge=1, le=36)
    paid_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=2000)


class SubscriptionPaymentResponse(BaseModel):
    id: int
    company_id: int
    amount: float
    currency: str
    period_months: int
    period_days: int
    paid_at: datetime
    notes: str | None
    recorded_by_name: str | None
    created_at: datetime


class SubscriptionPaymentListItem(SubscriptionPaymentResponse):
    company_name: str


class SubscriptionPaymentListResponse(BaseModel):
    items: list[SubscriptionPaymentListItem]
    total: int


class RecordSubscriptionPaymentResponse(BaseModel):
    payment: SubscriptionPaymentResponse
    company: PlatformCompanyDetail


class DashboardStatsResponse(BaseModel):
    total: int
    trial: int
    active: int
    expired: int
    suspended: int
    expiring_soon: int
    payment_count: int
    payment_total: float
