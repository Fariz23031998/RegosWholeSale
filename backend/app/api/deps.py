from dataclasses import dataclass

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import forbidden, unauthorized
from app.core.security import decode_access_token
from app.database import get_db
from app.services.permissions import get_user_with_permissions

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    id: int
    company_id: int
    role: str
    permissions: list[str]


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

    user_id = int(payload["sub"])
    user = await get_user_with_permissions(session, user_id)
    if not user or not user.is_active:
        raise unauthorized("Invalid token", "INVALID_TOKEN")

    from app.services.permissions import effective_permission_codes

    perms = sorted(effective_permission_codes(user))
    return CurrentUser(
        id=user.id,
        company_id=user.company_id,
        role=user.role.value,
        permissions=perms,
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
