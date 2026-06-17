from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Permission, User, UserPermission, UserRole

PERMISSION_CODES = [
    ("pos.access", "Access POS terminal"),
    ("sales.read", "View sales history"),
    ("sales.write", "Create and modify sales"),
    ("returns.manage", "Process returns"),
    ("dashboard.read", "View dashboard analytics"),
    ("settings.manage", "Manage company and user settings"),
    ("users.manage", "Manage users, permissions, and schedules"),
]

ROLE_DEFAULTS: dict[UserRole, set[str]] = {
    UserRole.owner: {code for code, _ in PERMISSION_CODES},
    UserRole.admin: {code for code, _ in PERMISSION_CODES},
    UserRole.employee: {"pos.access", "sales.read", "sales.write"},
}


async def seed_permissions(session: AsyncSession) -> None:
    result = await session.execute(select(Permission))
    existing = {p.code for p in result.scalars().all()}
    for code, description in PERMISSION_CODES:
        if code not in existing:
            session.add(Permission(code=code, description=description))
    await session.flush()


async def get_all_permissions(session: AsyncSession) -> list[Permission]:
    result = await session.execute(select(Permission).order_by(Permission.code))
    return list(result.scalars().all())


async def get_user_with_permissions(session: AsyncSession, user_id: int) -> User | None:
    result = await session.execute(
        select(User)
        .where(User.id == user_id)
        .options(
            selectinload(User.company),
            selectinload(User.extra_permissions).selectinload(UserPermission.permission),
            selectinload(User.login_schedules),
        )
    )
    return result.scalar_one_or_none()


def effective_permission_codes(user: User) -> set[str]:
    if user.role == UserRole.owner:
        return ROLE_DEFAULTS[UserRole.owner]
    codes = set(ROLE_DEFAULTS.get(user.role, set()))
    for link in user.extra_permissions:
        codes.add(link.permission.code)
    return codes


async def set_user_permissions(session: AsyncSession, user: User, permission_codes: list[str]) -> set[str]:
    all_perms = await get_all_permissions(session)
    by_code = {p.code: p for p in all_perms}
    unknown = set(permission_codes) - set(by_code)
    if unknown:
        from app.core.exceptions import bad_request

        raise bad_request(f"Unknown permissions: {', '.join(sorted(unknown))}", "UNKNOWN_PERMISSION")

    await session.execute(delete(UserPermission).where(UserPermission.user_id == user.id))
    for code in permission_codes:
        session.add(UserPermission(user_id=user.id, permission_id=by_code[code].id))
    await session.flush()
    if user.role == UserRole.owner:
        return ROLE_DEFAULTS[UserRole.owner]
    return ROLE_DEFAULTS.get(user.role, set()) | set(permission_codes)
