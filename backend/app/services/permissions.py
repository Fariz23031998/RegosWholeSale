from typing import Any, Literal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Permission, User, UserPermission, UserRole
from app.models.permission import PermissionEffect

PERMISSION_CODES = [
    ("pos.access", "Access POS terminal"),
    ("pos.change_warehouse", "Change selected warehouse on sell screen"),
    ("pos.change_price_type", "Change selected price type on sell screen"),
    ("pos.change_partner", "Change selected customer or partner on sell screen"),
    ("pos.apply_discount", "Apply discounts on sales"),
    ("pos.modify_price", "Modify product prices on sales"),
    ("sales.read", "View sales history"),
    ("sales.write", "Create and modify sales"),
    ("sales.postpone", "Postpone sales"),
    ("sales.continue", "Continue postponed sales"),
    ("returns.manage", "Process returns"),
    ("documents.print", "Print receipts, invoices, and documents"),
    ("dashboard.read", "View dashboard analytics"),
    ("settings.manage", "Manage company and user settings"),
    ("users.manage", "Manage users, permissions, and schedules"),
    # Legacy — seeded for migration compatibility; not in ROLE_DEFAULTS
    ("pos.override_regos", "Override warehouse, price type, and partner on sell screen"),
]

LEGACY_OVERRIDE_REGOS = "pos.override_regos"
SPLIT_OVERRIDE_PERMISSIONS = (
    "pos.change_warehouse",
    "pos.change_price_type",
    "pos.change_partner",
)
POS_CONTEXT_CHANGE_PERMISSIONS = SPLIT_OVERRIDE_PERMISSIONS

ALL_PERMISSION_CODES = {code for code, _ in PERMISSION_CODES}

ROLE_DEFAULTS: dict[UserRole, set[str]] = {
    UserRole.owner: {code for code, _ in PERMISSION_CODES if code != LEGACY_OVERRIDE_REGOS},
    UserRole.admin: {code for code, _ in PERMISSION_CODES if code != LEGACY_OVERRIDE_REGOS},
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


def _expand_legacy_override(stored_codes: set[str]) -> set[str]:
    if LEGACY_OVERRIDE_REGOS not in stored_codes:
        return stored_codes
    expanded = stored_codes - {LEGACY_OVERRIDE_REGOS}
    expanded.update(SPLIT_OVERRIDE_PERMISSIONS)
    return expanded


def get_user_permission_rules(user: User) -> list[dict[str, str]]:
    if user.role in (UserRole.owner, UserRole.admin):
        return []
    return [
        {"code": link.permission.code, "effect": link.effect.value}
        for link in user.extra_permissions
        if link.permission.code != LEGACY_OVERRIDE_REGOS
    ]


def effective_permission_codes(user: User) -> set[str]:
    if user.role in (UserRole.owner, UserRole.admin):
        return set(ROLE_DEFAULTS[user.role])

    codes = set(ROLE_DEFAULTS.get(user.role, set()))
    allows: set[str] = set()
    denies: set[str] = set()
    for link in user.extra_permissions:
        code = link.permission.code
        if link.effect == PermissionEffect.allow:
            allows.add(code)
        else:
            denies.add(code)

    allows = _expand_legacy_override(allows)
    denies = _expand_legacy_override(denies)
    codes |= allows
    codes -= denies
    return codes


def has_permission(permissions: set[str] | list[str], code: str) -> bool:
    return code in permissions


async def set_user_permission_rules(
    session: AsyncSession,
    user: User,
    rules: list[dict[str, Any]],
) -> set[str]:
    if user.role in (UserRole.owner, UserRole.admin):
        from app.core.exceptions import bad_request

        raise bad_request(
            "Cannot set permission rules for owner or admin accounts",
            "INVALID_OPERATION",
        )

    all_perms = await get_all_permissions(session)
    by_code = {p.code: p for p in all_perms}

    normalized: dict[str, Literal["allow", "deny"]] = {}
    for rule in rules:
        code = rule["code"]
        effect = rule["effect"]
        if code == LEGACY_OVERRIDE_REGOS:
            continue
        if code not in by_code:
            from app.core.exceptions import bad_request

            raise bad_request(f"Unknown permission: {code}", "UNKNOWN_PERMISSION")
        if effect not in ("allow", "deny"):
            from app.core.exceptions import bad_request

            raise bad_request(f"Invalid permission effect: {effect}", "INVALID_PERMISSION_EFFECT")
        normalized[code] = effect

    await session.execute(delete(UserPermission).where(UserPermission.user_id == user.id))
    for code, effect in normalized.items():
        session.add(
            UserPermission(
                user_id=user.id,
                permission_id=by_code[code].id,
                effect=PermissionEffect.allow if effect == "allow" else PermissionEffect.deny,
            )
        )
    await session.flush()
    if user.role in (UserRole.owner, UserRole.admin):
        return set(ROLE_DEFAULTS[user.role])
    codes = set(ROLE_DEFAULTS.get(user.role, set()))
    allows = _expand_legacy_override({code for code, effect in normalized.items() if effect == "allow"})
    denies = _expand_legacy_override({code for code, effect in normalized.items() if effect == "deny"})
    codes |= allows
    codes -= denies
    return codes


async def set_user_permissions(session: AsyncSession, user: User, permission_codes: list[str]) -> set[str]:
    """Backward-compatible allow-only assignment."""
    rules = [{"code": code, "effect": "allow"} for code in permission_codes]
    return await set_user_permission_rules(session, user, rules)
