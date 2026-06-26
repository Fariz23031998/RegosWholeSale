from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models import Company, SubscriptionPayment
from app.models.subscription import SubscriptionStatus
from app.services.subscriptions import extend_subscription

settings = get_settings()


def period_days_for_months(months: int) -> int:
    return months * settings.subscription_days_per_month


async def list_all_payments(
    session: AsyncSession,
    *,
    company_id: int | None = None,
    search: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[tuple[SubscriptionPayment, str]], int]:
    query = (
        select(SubscriptionPayment, Company.name)
        .join(Company, SubscriptionPayment.company_id == Company.id)
        .options(selectinload(SubscriptionPayment.recorded_by))
    )
    count_query = select(func.count()).select_from(SubscriptionPayment).join(
        Company, SubscriptionPayment.company_id == Company.id
    )

    if company_id is not None:
        query = query.where(SubscriptionPayment.company_id == company_id)
        count_query = count_query.where(SubscriptionPayment.company_id == company_id)

    if search:
        term = f"%{search.strip()}%"
        filter_clause = or_(
            Company.name.ilike(term),
            SubscriptionPayment.notes.ilike(term),
            SubscriptionPayment.currency.ilike(term),
        )
        query = query.where(filter_clause)
        count_query = count_query.where(filter_clause)

    total = await session.scalar(count_query) or 0
    result = await session.execute(
        query.order_by(
            SubscriptionPayment.paid_at.desc(), SubscriptionPayment.id.desc()
        )
        .offset(offset)
        .limit(limit)
    )
    return list(result.all()), total


async def payment_aggregate_stats(session: AsyncSession) -> tuple[int, float]:
    count = await session.scalar(select(func.count()).select_from(SubscriptionPayment)) or 0
    total = await session.scalar(select(func.coalesce(func.sum(SubscriptionPayment.amount), 0))) or 0
    return count, float(total)


async def list_company_payments(
    session: AsyncSession, company_id: int
) -> list[SubscriptionPayment]:
    result = await session.execute(
        select(SubscriptionPayment)
        .options(selectinload(SubscriptionPayment.recorded_by))
        .where(SubscriptionPayment.company_id == company_id)
        .order_by(SubscriptionPayment.paid_at.desc(), SubscriptionPayment.id.desc())
    )
    return list(result.scalars().all())


async def record_subscription_payment(
    session: AsyncSession,
    company: Company,
    *,
    amount: Decimal,
    period_months: int,
    currency: str = "UZS",
    paid_at: datetime | None = None,
    notes: str | None = None,
    recorded_by_admin_id: int | None = None,
) -> SubscriptionPayment:
    days = period_days_for_months(period_months)
    extend_subscription(company, days=days, status=SubscriptionStatus.active)

    payment = SubscriptionPayment(
        company_id=company.id,
        amount=amount,
        currency=currency.upper(),
        period_months=period_months,
        period_days=days,
        paid_at=paid_at or datetime.now(UTC),
        notes=notes,
        recorded_by_admin_id=recorded_by_admin_id,
    )
    session.add(payment)
    await session.flush()
    return payment


async def get_payment_by_id(
    session: AsyncSession, payment_id: int
) -> SubscriptionPayment | None:
    result = await session.execute(
        select(SubscriptionPayment)
        .options(selectinload(SubscriptionPayment.recorded_by))
        .where(SubscriptionPayment.id == payment_id)
    )
    return result.scalar_one_or_none()


async def update_subscription_payment(
    session: AsyncSession,
    payment: SubscriptionPayment,
    *,
    amount: Decimal | None = None,
    currency: str | None = None,
    period_months: int | None = None,
    paid_at: datetime | None = None,
    notes: str | None = None,
) -> SubscriptionPayment:
    if amount is not None:
        payment.amount = amount
    if currency is not None:
        payment.currency = currency.upper()
    if period_months is not None:
        payment.period_months = period_months
        payment.period_days = period_days_for_months(period_months)
    if paid_at is not None:
        payment.paid_at = paid_at
    if notes is not None:
        payment.notes = notes or None
    await session.flush()
    return payment


async def get_company_for_payment(session: AsyncSession, company_id: int) -> Company | None:
    result = await session.execute(select(Company).where(Company.id == company_id))
    return result.scalar_one_or_none()
