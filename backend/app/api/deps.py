from dataclasses import dataclass

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import forbidden, unauthorized
from app.core.security import decode_access_token, token_type
from app.database import get_db
from app.models import PlatformAdmin
from app.services.permissions import (
    POS_CONTEXT_CHANGE_PERMISSIONS,
    effective_permission_codes,
    get_user_with_permissions,
    has_permission,
)
from app.services.subscriptions import is_subscription_active
from sqlalchemy import select

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    id: int
    company_id: int
    role: str
    permissions: list[str]

    def has(self, code: str) -> bool:
        return has_permission(self.permissions, code)

    def has_any(self, *codes: str) -> bool:
        return any(self.has(code) for code in codes)

    def can_change_pos_context(self) -> bool:
        return self.has_any(*POS_CONTEXT_CHANGE_PERMISSIONS)


@dataclass
class CurrentPlatformAdmin:
    id: int
    email: str
    display_name: str


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_db),
) -> CurrentUser:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise unauthorized("Not authenticated", "NOT_AUTHENTICATED")
    try:
        payload = decode_access_token(credentials.credentials)
    except ValueError:
        raise unauthorized("Invalid token", "INVALID_TOKEN")

    if token_type(payload) == "platform":
        raise unauthorized("Invalid token", "INVALID_TOKEN")

    user_id = int(payload["sub"])
    user = await get_user_with_permissions(session, user_id)
    if not user or not user.is_active:
        raise unauthorized("Invalid token", "INVALID_TOKEN")

    if not is_subscription_active(user.company):
        raise forbidden("Subscription has expired", "SUBSCRIPTION_EXPIRED")

    perms = sorted(effective_permission_codes(user))
    return CurrentUser(
        id=user.id,
        company_id=user.company_id,
        role=user.role.value,
        permissions=perms,
    )


async def get_current_platform_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_db),
) -> CurrentPlatformAdmin:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise unauthorized("Not authenticated", "NOT_AUTHENTICATED")
    try:
        payload = decode_access_token(credentials.credentials)
    except ValueError:
        raise unauthorized("Invalid token", "INVALID_TOKEN")

    if token_type(payload) != "platform":
        raise unauthorized("Invalid token", "INVALID_TOKEN")

    admin_id = int(payload["sub"])
    result = await session.execute(select(PlatformAdmin).where(PlatformAdmin.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_active:
        raise unauthorized("Invalid token", "INVALID_TOKEN")

    return CurrentPlatformAdmin(
        id=admin.id,
        email=admin.email,
        display_name=admin.display_name,
    )


def require_permission(code: str):
    async def _checker(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if code not in current.permissions:
            raise forbidden(f"Missing permission: {code}", "FORBIDDEN")
        return current

    return _checker


def require_any_permission(*codes: str):
    async def _checker(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not any(code in current.permissions for code in codes):
            missing = ", ".join(codes)
            raise forbidden(f"Missing one of permissions: {missing}", "FORBIDDEN")
        return current

    return _checker
