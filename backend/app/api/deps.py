from dataclasses import dataclass

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import forbidden, unauthorized
from app.core.security import decode_access_token, token_type
from app.database import get_db
from app.models import Company, PartnerTelegramAccount, PlatformAdmin
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
class CurrentPartnerAccount:
    id: int
    company_id: int
    telegram_user_id: int
    regos_partner_id: int | None
    link_state: str
    language_code: str | None
    phone: str | None
    first_name: str | None
    last_name: str | None


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

    if token_type(payload) != "tenant":
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


async def get_partner_telegram_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_db),
) -> CurrentPartnerAccount:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise unauthorized("Not authenticated", "NOT_AUTHENTICATED")
    try:
        payload = decode_access_token(credentials.credentials)
    except ValueError:
        raise unauthorized("Invalid token", "INVALID_TOKEN")

    if token_type(payload) != "partner_telegram":
        raise unauthorized("Invalid token", "INVALID_TOKEN")

    account_id = int(payload["sub"])
    company_id = int(payload["company_id"])
    account = await session.get(PartnerTelegramAccount, account_id)
    if account is None or account.company_id != company_id:
        raise unauthorized("Invalid token", "INVALID_TOKEN")
    if not account.is_active:
        raise unauthorized(
            "This Telegram account is deactivated.",
            "PARTNER_TELEGRAM_INACTIVE",
        )

    company = await session.get(Company, company_id)
    if company is None or not is_subscription_active(company):
        raise forbidden("Subscription has expired", "SUBSCRIPTION_EXPIRED")

    return CurrentPartnerAccount(
        id=account.id,
        company_id=account.company_id,
        telegram_user_id=account.telegram_user_id,
        regos_partner_id=account.regos_partner_id,
        link_state=account.link_state,
        language_code=account.language_code,
        phone=account.phone,
        first_name=account.first_name,
        last_name=account.last_name,
    )


def require_linked_partner_account(
    current: CurrentPartnerAccount = Depends(get_partner_telegram_account),
) -> CurrentPartnerAccount:
    if current.link_state != "linked" or not current.regos_partner_id:
        raise forbidden("Partner account is not linked", "PARTNER_TELEGRAM_NOT_LINKED")
    return current


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
