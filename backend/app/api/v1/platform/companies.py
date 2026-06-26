from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentPlatformAdmin, get_current_platform_admin
from app.core.exceptions import bad_request, not_found
from app.database import get_db
from app.models import UserRole
from app.models.subscription import SubscriptionStatus
from app.schemas.platform import (
    CompanyOwnerSummary,
    CreatePlatformCompanyRequest,
    DashboardStatsResponse,
    PlatformCompanyDetail,
    PlatformCompanyListItem,
    PlatformCompanyListResponse,
    RecordSubscriptionPaymentRequest,
    RecordSubscriptionPaymentResponse,
    SubscriptionPaymentListItem,
    SubscriptionPaymentListResponse,
    SubscriptionPaymentResponse,
    UpdateSubscriptionPaymentRequest,
    UpdatePlatformCompanyRequest,
)
from app.services import platform_admin as platform_service
from app.services import subscription_payments as payment_service

router = APIRouter(tags=["platform-companies"])


def _owner_for_company(company) -> CompanyOwnerSummary | None:
    owner = next((u for u in company.users if u.role == UserRole.owner), None)
    if not owner:
        return None
    return CompanyOwnerSummary(id=owner.id, email=owner.email, display_name=owner.display_name)


def _list_item(company) -> PlatformCompanyListItem:
    owner = next((u for u in company.users if u.role == UserRole.owner), None) if hasattr(company, "users") else None
    return PlatformCompanyListItem(
        id=company.id,
        name=company.name,
        slug=company.slug,
        subscription_status=company.subscription_status.value,
        subscription_expires_at=company.subscription_expires_at,
        created_at=company.created_at,
        user_count=len(company.users) if hasattr(company, "users") else 0,
        owner_email=owner.email if owner else None,
    )


def _company_detail(company) -> PlatformCompanyDetail:
    return PlatformCompanyDetail(
        id=company.id,
        name=company.name,
        slug=company.slug,
        timezone=company.timezone,
        subscription_status=company.subscription_status.value,
        subscription_expires_at=company.subscription_expires_at,
        internal_notes=company.internal_notes,
        created_at=company.created_at,
        user_count=len(company.users),
        owner=_owner_for_company(company),
    )


def _payment_response(payment, *, recorded_by_name: str | None = None) -> SubscriptionPaymentResponse:
    admin_name = recorded_by_name
    if admin_name is None and payment.recorded_by is not None:
        admin_name = payment.recorded_by.display_name
    return SubscriptionPaymentResponse(
        id=payment.id,
        company_id=payment.company_id,
        amount=float(payment.amount),
        currency=payment.currency,
        period_months=payment.period_months,
        period_days=payment.period_days,
        paid_at=payment.paid_at,
        notes=payment.notes,
        recorded_by_name=admin_name,
        created_at=payment.created_at,
    )


@router.get("/stats", response_model=DashboardStatsResponse)
async def dashboard_stats(
    _current: CurrentPlatformAdmin = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_db),
) -> DashboardStatsResponse:
    stats = await platform_service.dashboard_stats(session)
    return DashboardStatsResponse(**stats)


@router.get("/companies", response_model=PlatformCompanyListResponse)
async def list_companies(
    status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    _current: CurrentPlatformAdmin = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_db),
) -> PlatformCompanyListResponse:
    sub_status = None
    if status:
        try:
            sub_status = SubscriptionStatus(status)
        except ValueError:
            raise bad_request("Invalid subscription status", "INVALID_STATUS")

    companies, total = await platform_service.list_companies(
        session, status=sub_status, search=search, offset=offset, limit=limit
    )
    items = [_list_item(c) for c in companies]

    return PlatformCompanyListResponse(items=items, total=total)


@router.get("/companies/{company_id}", response_model=PlatformCompanyDetail)
async def get_company(
    company_id: int,
    _current: CurrentPlatformAdmin = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_db),
) -> PlatformCompanyDetail:
    company = await platform_service.get_company_with_users(session, company_id)
    if not company:
        raise not_found("Company not found")
    return _company_detail(company)


@router.get("/payments", response_model=SubscriptionPaymentListResponse)
async def list_payments(
    company_id: int | None = Query(default=None),
    search: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    _current: CurrentPlatformAdmin = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_db),
) -> SubscriptionPaymentListResponse:
    rows, total = await payment_service.list_all_payments(
        session,
        company_id=company_id,
        search=search,
        offset=offset,
        limit=limit,
    )
    items = [
        SubscriptionPaymentListItem(
            **_payment_response(payment).model_dump(),
            company_name=company_name,
        )
        for payment, company_name in rows
    ]
    return SubscriptionPaymentListResponse(items=items, total=total)


@router.patch("/payments/{payment_id}", response_model=SubscriptionPaymentResponse)
async def update_payment(
    payment_id: int,
    body: UpdateSubscriptionPaymentRequest,
    _current: CurrentPlatformAdmin = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_db),
) -> SubscriptionPaymentResponse:
    payment = await payment_service.get_payment_by_id(session, payment_id)
    if not payment:
        raise not_found("Payment not found")

    payment = await payment_service.update_subscription_payment(
        session,
        payment,
        amount=Decimal(str(body.amount)) if body.amount is not None else None,
        currency=body.currency,
        period_months=body.period_months,
        paid_at=body.paid_at,
        notes=body.notes,
    )
    return _payment_response(payment)


@router.get("/companies/{company_id}/payments", response_model=list[SubscriptionPaymentResponse])
async def list_company_payments(
    company_id: int,
    _current: CurrentPlatformAdmin = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_db),
) -> list[SubscriptionPaymentResponse]:
    company = await payment_service.get_company_for_payment(session, company_id)
    if not company:
        raise not_found("Company not found")
    payments = await payment_service.list_company_payments(session, company_id)
    return [_payment_response(p) for p in payments]


@router.post(
    "/companies/{company_id}/payments",
    response_model=RecordSubscriptionPaymentResponse,
    status_code=201,
)
async def record_company_payment(
    company_id: int,
    body: RecordSubscriptionPaymentRequest,
    current: CurrentPlatformAdmin = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_db),
) -> RecordSubscriptionPaymentResponse:
    company = await payment_service.get_company_for_payment(session, company_id)
    if not company:
        raise not_found("Company not found")

    payment = await payment_service.record_subscription_payment(
        session,
        company,
        amount=Decimal(str(body.amount)),
        period_months=body.period_months,
        currency=body.currency,
        paid_at=body.paid_at,
        notes=body.notes,
        recorded_by_admin_id=current.id,
    )

    detail = await platform_service.get_company_with_users(session, company.id)
    assert detail is not None
    response = _payment_response(payment, recorded_by_name=current.display_name)
    return RecordSubscriptionPaymentResponse(
        payment=response,
        company=_company_detail(detail),
    )


@router.post("/companies", response_model=PlatformCompanyDetail, status_code=201)
async def create_company(
    body: CreatePlatformCompanyRequest,
    _current: CurrentPlatformAdmin = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_db),
) -> PlatformCompanyDetail:
    company, _owner = await platform_service.create_company_manual(
        session,
        company_name=body.company_name,
        owner_email=body.owner_email,
        owner_password=body.owner_password,
        owner_display_name=body.owner_display_name,
        trial_days=body.trial_days,
        active_days=body.active_days,
    )
    detail = await platform_service.get_company_with_users(session, company.id)
    assert detail is not None
    return _company_detail(detail)


@router.patch("/companies/{company_id}", response_model=PlatformCompanyDetail)
async def update_company(
    company_id: int,
    body: UpdatePlatformCompanyRequest,
    _current: CurrentPlatformAdmin = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_db),
) -> PlatformCompanyDetail:
    company = await platform_service.get_company_with_users(session, company_id)
    if not company:
        raise not_found("Company not found")

    sub_status = None
    if body.status is not None:
        try:
            sub_status = SubscriptionStatus(body.status)
        except ValueError:
            raise bad_request("Invalid subscription status", "INVALID_STATUS")

    company = await platform_service.update_company_subscription(
        session,
        company,
        status=sub_status,
        extend_days=body.extend_days,
        expires_at=body.expires_at,
        internal_notes=body.internal_notes,
        reset_subscription=bool(body.reset_subscription),
    )

    detail = await platform_service.get_company_with_users(session, company.id)
    assert detail is not None
    return _company_detail(detail)
