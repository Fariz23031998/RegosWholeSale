import re
from datetime import time

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import bad_request, conflict, not_found
from app.core.security import hash_password
from app.models import LoginSchedule, User, UserRole
from app.models.permission import UserPermission
from app.services.permissions import (
    effective_permission_codes,
    get_user_permission_rules,
    set_user_permission_rules,
)


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "company"


async def unique_company_slug(session: AsyncSession, base: str) -> str:
    from app.models import Company

    slug = base
    counter = 1
    while True:
        result = await session.execute(select(Company).where(Company.slug == slug))
        if not result.scalar_one_or_none():
            return slug
        counter += 1
        slug = f"{base}-{counter}"


def parse_time(value: str) -> time:
    parts = value.split(":")
    if len(parts) < 2:
        raise bad_request(f"Invalid time format: {value}", "INVALID_TIME")
    return time(int(parts[0]), int(parts[1]))


async def apply_schedules(session: AsyncSession, user: User, schedules: list[dict] | None) -> None:
    await session.execute(delete(LoginSchedule).where(LoginSchedule.user_id == user.id))
    if not schedules:
        return
    for item in schedules:
        session.add(
            LoginSchedule(
                user_id=user.id,
                day_of_week=item["day_of_week"],
                start_time=parse_time(item["start_time"]),
                end_time=parse_time(item["end_time"]),
            )
        )


async def list_company_users(session: AsyncSession, company_id: int) -> list[User]:
    result = await session.execute(
        select(User)
        .where(User.company_id == company_id)
        .options(
            selectinload(User.extra_permissions).selectinload(UserPermission.permission),
            selectinload(User.login_schedules),
        )
        .order_by(User.id)
    )
    return list(result.scalars().all())


async def get_company_user(session: AsyncSession, company_id: int, user_id: int) -> User:
    result = await session.execute(
        select(User)
        .where(User.id == user_id, User.company_id == company_id)
        .options(
            selectinload(User.extra_permissions).selectinload(UserPermission.permission),
            selectinload(User.login_schedules),
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise not_found("User not found")
    return user


async def ensure_login_available(
    session: AsyncSession, login: str, *, exclude_user_id: int | None = None
) -> None:
    result = await session.execute(select(User).where(User.login == login))
    existing = result.scalar_one_or_none()
    if existing and existing.id != exclude_user_id:
        raise conflict("Login already exists", "LOGIN_EXISTS")


async def create_employee(
    session: AsyncSession,
    *,
    company_id: int,
    login: str,
    password: str,
    display_name: str,
    role: UserRole,
    permission_rules: list[dict] | None,
    schedules: list[dict] | None,
) -> User:
    if role == UserRole.owner:
        raise bad_request("Cannot create another owner via this endpoint", "INVALID_ROLE")

    await ensure_login_available(session, login)

    user = User(
        company_id=company_id,
        login=login,
        password_hash=hash_password(password),
        display_name=display_name,
        role=role,
        is_active=True,
    )
    session.add(user)
    await session.flush()

    if permission_rules is not None:
        await set_user_permission_rules(session, user, permission_rules)
    await apply_schedules(session, user, schedules)
    await session.flush()
    return user


async def update_user(
    session: AsyncSession,
    user: User,
    *,
    display_name: str | None = None,
    login: str | None = None,
    password: str | None = None,
    role: UserRole | None = None,
    is_active: bool | None = None,
    permission_rules: list[dict] | None = None,
    schedules: list[dict] | None = None,
) -> User:
    if display_name is not None:
        user.display_name = display_name
    if login is not None and login != user.login:
        await ensure_login_available(session, login, exclude_user_id=user.id)
        user.login = login
    if password is not None:
        user.password_hash = hash_password(password)
    if role is not None:
        if user.role == UserRole.owner and role != UserRole.owner:
            raise bad_request("Cannot change owner role", "INVALID_ROLE")
        if role == UserRole.owner:
            raise bad_request("Cannot promote to owner", "INVALID_ROLE")
        user.role = role
    if is_active is not None:
        if user.role == UserRole.owner and not is_active:
            raise bad_request("Cannot deactivate owner", "INVALID_OPERATION")
        user.is_active = is_active
    if permission_rules is not None:
        await set_user_permission_rules(session, user, permission_rules)
    if schedules is not None:
        await apply_schedules(session, user, schedules)
    await session.flush()
    return user


def user_to_dict(user: User) -> dict:
    return {
        "id": user.id,
        "company_id": user.company_id,
        "email": user.email,
        "login": user.login,
        "display_name": user.display_name,
        "role": user.role.value,
        "is_active": user.is_active,
        "permissions": sorted(effective_permission_codes(user)),
        "permission_rules": get_user_permission_rules(user),
        "schedules": [
            {
                "id": s.id,
                "day_of_week": s.day_of_week,
                "start_time": s.start_time.strftime("%H:%M"),
                "end_time": s.end_time.strftime("%H:%M"),
            }
            for s in user.login_schedules
        ],
    }
