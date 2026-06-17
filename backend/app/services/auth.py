from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import conflict, unauthorized
from app.core.security import create_access_token, hash_password, verify_password
from app.models import Company, User, UserPermission, UserRole
from app.services.permissions import effective_permission_codes, seed_permissions
from app.services.schedules import is_within_login_schedule
from app.services.users import slugify, unique_company_slug


async def register_owner(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    display_name: str,
    company_name: str,
    verification_code: str,
) -> tuple[User, Company, str]:
    from app.services.verification import check_verification_code

    await check_verification_code(session, email, verification_code)
    await seed_permissions(session)

    result = await session.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none():
        raise conflict("Email already registered", "EMAIL_EXISTS")

    slug = await unique_company_slug(session, slugify(company_name))
    company = Company(name=company_name, slug=slug, timezone="UTC", settings={})
    session.add(company)
    await session.flush()

    user = User(
        company_id=company.id,
        email=email,
        password_hash=hash_password(password),
        display_name=display_name,
        role=UserRole.owner,
        is_active=True,
    )
    session.add(user)
    await session.flush()

    token = _issue_token(user)
    return user, company, token


async def login_with_email(session: AsyncSession, *, email: str, password: str) -> tuple[User, str]:
    user = await _load_user_for_login(session, email=email)
    return await _authenticate(session, user, password)


async def login_with_company_login(
    session: AsyncSession, *, company_slug: str, login: str, password: str
) -> tuple[User, str]:
    result = await session.execute(select(Company).where(Company.slug == company_slug))
    company = result.scalar_one_or_none()
    if not company:
        raise unauthorized("Invalid credentials")

    result = await session.execute(
        select(User).where(User.company_id == company.id, User.login == login)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise unauthorized("Invalid credentials")

    user = await _load_user_for_login(session, user_id=user.id)
    return await _authenticate(session, user, password)


async def _load_user_for_login(
    session: AsyncSession, *, email: str | None = None, user_id: int | None = None
) -> User:
    query = select(User).options(
        selectinload(User.company),
        selectinload(User.extra_permissions).selectinload(UserPermission.permission),
        selectinload(User.login_schedules),
    )
    if email is not None:
        query = query.where(User.email == email)
    else:
        query = query.where(User.id == user_id)

    result = await session.execute(query)
    user = result.scalar_one_or_none()
    if not user:
        raise unauthorized("Invalid credentials")
    return user


async def _authenticate(session: AsyncSession, user: User, password: str) -> tuple[User, str]:
    if not verify_password(password, user.password_hash):
        raise unauthorized("Invalid credentials")
    if not user.is_active:
        from app.core.exceptions import forbidden

        raise forbidden("Account is deactivated", "ACCOUNT_INACTIVE")

    if not is_within_login_schedule(user.login_schedules, user.company.timezone):
        from app.core.exceptions import forbidden

        raise forbidden("Login not allowed at this time", "OUTSIDE_LOGIN_SCHEDULE")

    token = _issue_token(user)
    return user, token


async def reset_password(
    session: AsyncSession,
    *,
    email: str,
    verification_code: str,
    new_password: str,
) -> None:
    from app.services.verification import check_verification_code

    await check_verification_code(session, email, verification_code)
    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise unauthorized("Invalid credentials")
    user.password_hash = hash_password(new_password)
    await session.flush()


def _issue_token(user: User) -> str:
    perms = sorted(effective_permission_codes(user))
    return create_access_token(
        user_id=user.id,
        company_id=user.company_id,
        role=user.role.value,
        permissions=perms,
    )
