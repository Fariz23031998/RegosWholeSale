from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import conflict, not_found, unauthorized
from app.core.security import (
    create_platform_access_token,
    hash_password,
    verify_password,
)
from app.models import Company, PlatformAdmin, User, UserRole
from app.models.subscription import SubscriptionStatus
from app.services.subscription_payments import payment_aggregate_stats
from app.services.subscriptions import extend_subscription, set_subscription, start_trial
from app.services.users import slugify, unique_company_slug


def normalize_platform_username(value: str) -> str:
    return value.strip().lower()


async def ensure_username_available(
    session: AsyncSession, username: str, *, exclude_admin_id: int | None = None
) -> None:
    normalized = normalize_platform_username(username)
    query = select(PlatformAdmin).where(func.lower(PlatformAdmin.username) == normalized)
    if exclude_admin_id is not None:
        query = query.where(PlatformAdmin.id != exclude_admin_id)
    existing = await session.execute(query)
    if existing.scalar_one_or_none():
        raise conflict("Username already taken", "USERNAME_EXISTS")


async def login_platform_admin(
    session: AsyncSession, *, login: str, password: str
) -> tuple[PlatformAdmin, str]:
    normalized = login.strip()
    if "@" in normalized:
        result = await session.execute(
            select(PlatformAdmin).where(PlatformAdmin.email == normalized.lower())
        )
    else:
        lookup = normalize_platform_username(normalized)
        result = await session.execute(
            select(PlatformAdmin).where(
                or_(
                    func.lower(PlatformAdmin.username) == lookup,
                    func.lower(PlatformAdmin.display_name) == normalized.lower(),
                )
            )
        )
    admin = result.scalar_one_or_none()
    if not admin or not verify_password(password, admin.password_hash):
        raise unauthorized("Invalid credentials")
    if not admin.is_active:
        from app.core.exceptions import forbidden

        raise forbidden("Account is deactivated", "ACCOUNT_INACTIVE")
    token = create_platform_access_token(admin_id=admin.id)
    return admin, token


async def get_platform_admin(session: AsyncSession, admin_id: int) -> PlatformAdmin | None:
    result = await session.execute(select(PlatformAdmin).where(PlatformAdmin.id == admin_id))
    return result.scalar_one_or_none()


async def list_platform_admins(session: AsyncSession) -> list[PlatformAdmin]:
    result = await session.execute(select(PlatformAdmin).order_by(PlatformAdmin.id))
    return list(result.scalars().all())


async def create_platform_admin(
    session: AsyncSession,
    *,
    email: str,
    username: str,
    password: str,
    display_name: str,
) -> PlatformAdmin:
    normalized = email.lower().strip()
    existing = await session.execute(
        select(PlatformAdmin).where(PlatformAdmin.email == normalized)
    )
    if existing.scalar_one_or_none():
        raise conflict("Email already registered", "EMAIL_EXISTS")

    await ensure_username_available(session, username)

    admin = PlatformAdmin(
        email=normalized,
        username=normalize_platform_username(username),
        password_hash=hash_password(password),
        display_name=display_name,
        is_active=True,
    )
    session.add(admin)
    await session.flush()
    return admin


async def update_platform_admin(
    session: AsyncSession,
    admin: PlatformAdmin,
    *,
    display_name: str | None = None,
    username: str | None = None,
    password: str | None = None,
    is_active: bool | None = None,
) -> PlatformAdmin:
    if display_name is not None:
        admin.display_name = display_name
    if username is not None:
        await ensure_username_available(session, username, exclude_admin_id=admin.id)
        admin.username = normalize_platform_username(username)
    if password is not None:
        admin.password_hash = hash_password(password)
    if is_active is not None:
        admin.is_active = is_active
    await session.flush()
    return admin


async def change_platform_admin_password(
    session: AsyncSession,
    admin: PlatformAdmin,
    *,
    current_password: str,
    new_password: str,
) -> PlatformAdmin:
    if not verify_password(current_password, admin.password_hash):
        raise unauthorized("Current password is incorrect", "INVALID_CURRENT_PASSWORD")
    admin.password_hash = hash_password(new_password)
    await session.flush()
    return admin


async def bootstrap_platform_admin(session: AsyncSession) -> None:
    from app.config import get_settings

    settings = get_settings()
    if not settings.platform_admin_email or not settings.platform_admin_password:
        return

    count = await session.scalar(select(func.count()).select_from(PlatformAdmin))
    if count and count > 0:
        return

    await create_platform_admin(
        session,
        email=settings.platform_admin_email,
        username=normalize_platform_username(
            settings.platform_admin_email.split("@", 1)[0] or "admin"
        ),
        password=settings.platform_admin_password,
        display_name="Platform Admin",
    )


async def list_companies(
    session: AsyncSession,
    *,
    status: SubscriptionStatus | None = None,
    search: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[Company], int]:
    query = select(Company).options(selectinload(Company.users))
    count_query = select(func.count()).select_from(Company)

    if status is not None:
        query = query.where(Company.subscription_status == status)
        count_query = count_query.where(Company.subscription_status == status)

    if search:
        term = f"%{search.strip()}%"
        owner_subq = (
            select(User.company_id)
            .where(User.role == UserRole.owner, User.email.ilike(term))
            .scalar_subquery()
        )
        filter_clause = or_(
            Company.name.ilike(term),
            Company.slug.ilike(term),
            Company.id.in_(owner_subq),
        )
        query = query.where(filter_clause)
        count_query = count_query.where(filter_clause)

    total = await session.scalar(count_query) or 0
    result = await session.execute(
        query.order_by(Company.id.desc()).offset(offset).limit(limit)
    )
    return list(result.scalars().all()), total


async def get_company_with_users(session: AsyncSession, company_id: int) -> Company | None:
    result = await session.execute(
        select(Company)
        .options(selectinload(Company.users))
        .where(Company.id == company_id)
    )
    return result.scalar_one_or_none()


async def create_company_manual(
    session: AsyncSession,
    *,
    company_name: str,
    owner_email: str,
    owner_password: str,
    owner_display_name: str,
    trial_days: int | None = None,
    active_days: int | None = None,
) -> tuple[Company, User]:
    from app.services.permissions import seed_permissions

    await seed_permissions(session)
    normalized_email = owner_email.lower().strip()

    existing = await session.execute(select(User).where(User.email == normalized_email))
    if existing.scalar_one_or_none():
        raise conflict("Email already registered", "EMAIL_EXISTS")

    slug = await unique_company_slug(session, slugify(company_name))
    company = Company(name=company_name, slug=slug, timezone="UTC", settings={})

    if trial_days is not None:
        now = datetime.now(UTC)
        company.subscription_status = SubscriptionStatus.trial
        company.subscription_expires_at = now + timedelta(days=trial_days)
    elif active_days is not None:
        extend_subscription(company, days=active_days, status=SubscriptionStatus.active)
    else:
        extend_subscription(company, days=365, status=SubscriptionStatus.active)

    session.add(company)
    await session.flush()

    user = User(
        company_id=company.id,
        email=normalized_email,
        password_hash=hash_password(owner_password),
        display_name=owner_display_name,
        role=UserRole.owner,
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return company, user


async def update_company_subscription(
    session: AsyncSession,
    company: Company,
    *,
    status: SubscriptionStatus | None = None,
    extend_days: int | None = None,
    expires_at: datetime | None = None,
    internal_notes: str | None = None,
    reset_subscription: bool = False,
) -> Company:
    if reset_subscription:
        start_trial(company)
    elif extend_days is not None:
        extend_subscription(
            company,
            days=extend_days,
            status=status or SubscriptionStatus.active,
        )
    elif status is not None or expires_at is not None:
        set_subscription(
            company,
            status=status or company.subscription_status,
            expires_at=expires_at,
        )

    if internal_notes is not None:
        company.internal_notes = internal_notes or None

    await session.flush()
    return company


async def dashboard_stats(session: AsyncSession) -> dict[str, int]:
    now = datetime.now(UTC)
    soon = now + timedelta(days=7)

    total = await session.scalar(select(func.count()).select_from(Company)) or 0
    trial = await session.scalar(
        select(func.count())
        .select_from(Company)
        .where(Company.subscription_status == SubscriptionStatus.trial)
    ) or 0
    active = await session.scalar(
        select(func.count())
        .select_from(Company)
        .where(Company.subscription_status == SubscriptionStatus.active)
    ) or 0
    expired = await session.scalar(
        select(func.count())
        .select_from(Company)
        .where(Company.subscription_status == SubscriptionStatus.expired)
    ) or 0
    suspended = await session.scalar(
        select(func.count())
        .select_from(Company)
        .where(Company.subscription_status == SubscriptionStatus.suspended)
    ) or 0
    expiring_soon = await session.scalar(
        select(func.count())
        .select_from(Company)
        .where(
            Company.subscription_status.in_(
                [SubscriptionStatus.trial, SubscriptionStatus.active]
            ),
            Company.subscription_expires_at <= soon,
            Company.subscription_expires_at > now,
        )
    ) or 0

    payment_count, payment_total = await payment_aggregate_stats(session)

    return {
        "total": total,
        "trial": trial,
        "active": active,
        "expired": expired,
        "suspended": suspended,
        "expiring_soon": expiring_soon,
        "payment_count": payment_count,
        "payment_total": payment_total,
    }
