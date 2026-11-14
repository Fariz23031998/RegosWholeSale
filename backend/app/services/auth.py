import re
import secrets
import string

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import bad_request, conflict, forbidden, unauthorized
from app.core.regos_api import regos_async_api_request
from app.core.regos_oauth import regos_oauth_service
from app.core.security import create_access_token, hash_password, verify_password
from app.models import Company, RegosToken, User, UserPermission, UserRole
from app.services.permissions import effective_permission_codes, seed_permissions
from app.services.regos_tokens import upsert_token
from app.services.schedules import is_within_login_schedule
from app.services.subscriptions import mark_expired_if_needed, start_trial
from app.services.users import ensure_login_available, slugify, unique_company_slug

_USER_LOGIN_LOAD_OPTIONS = (
    selectinload(User.company),
    selectinload(User.extra_permissions).selectinload(UserPermission.permission),
    selectinload(User.login_schedules),
)


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
    start_trial(company)
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


async def login_with_login(
    session: AsyncSession, *, login: str, password: str
) -> tuple[User, str]:
    user = await _load_user_for_login(session, login=login)
    return await _authenticate(session, user, password)


async def login_with_regos_integration(
    session: AsyncSession,
    *,
    integration_token: str,
) -> tuple[User, Company, str, bool]:
    """Authenticate via Regos Integration Catalog token. Returns requires_password_setup."""
    await seed_permissions(session)

    bearer_token = await regos_oauth_service.acquire_access_token()
    regos_result = await regos_async_api_request(
        endpoint="User/Get",
        request_data={"ids": [1]},
        token=integration_token,
        bearer_token=bearer_token,
    )

    rows = regos_result.get("result")
    if not isinstance(rows, list) or not rows:
        raise bad_request("Regos User/Get returned no users", "REGOS_USER_NOT_FOUND")

    regos_user = rows[0] if isinstance(rows[0], dict) else None
    if not regos_user:
        raise bad_request("Regos User/Get returned no users", "REGOS_USER_NOT_FOUND")

    email = str(regos_user.get("email") or "").strip().lower()
    full_name = str(regos_user.get("full_name") or "").strip() or "Regos User"
    phone = str(regos_user.get("main_phone") or "").strip()
    if phone and not phone.startswith("+"):
        phone = f"+{phone}"

    if not email and not phone:
        raise bad_request(
            "Regos user has no email or phone number",
            "REGOS_USER_CONTACT_REQUIRED",
        )

    user, created = await _resolve_regos_user(
        session,
        integration_token=integration_token,
        email=email or None,
        phone=phone or None,
        full_name=full_name,
    )
    await _ensure_user_can_session(user)

    await upsert_token(
        session,
        user.company_id,
        integration_token,
        is_replicable=True,
    )
    await session.refresh(user, attribute_names=["company", "extra_permissions"])

    access_token = _issue_token(user)
    return user, user.company, access_token, created


async def login_with_regos_sso(
    session: AsyncSession,
    *,
    access_token: str,
) -> tuple[User, Company, str, bool]:
    """Authenticate via REGOS SSO user access token. Returns requires_password_setup flag source.

    Validates the user token with /oauth/userinfo only (Bearer). Does not require
    REGOS_CLIENT_ID / REGOS_CLIENT_SECRET — those are for server client_credentials
    and optional introspection.
    """
    await seed_permissions(session)

    profile = await regos_oauth_service.fetch_userinfo(access_token)

    email = profile.email
    phone = profile.phone_number
    if not email and not phone:
        raise bad_request(
            "Regos user has no email or phone number",
            "REGOS_USER_CONTACT_REQUIRED",
        )

    name_parts = [part for part in (profile.given_name, profile.family_name) if part]
    full_name = " ".join(name_parts).strip() or profile.company or "Regos User"
    company_name = profile.company or (
        full_name if full_name != "Regos User" else "Regos"
    )

    user, created = await _resolve_regos_sso_user(
        session,
        regos_sub=profile.sub,
        email=email,
        phone=phone,
        full_name=full_name,
        company_name=company_name,
    )
    await _ensure_user_can_session(user)
    await session.refresh(user, attribute_names=["company", "extra_permissions"])

    wholesale_token = _issue_token(user)
    return user, user.company, wholesale_token, created


async def set_initial_password(
    session: AsyncSession,
    user: User,
    *,
    new_password: str,
) -> User:
    if not user.must_set_password:
        raise bad_request(
            "Initial password has already been set",
            "PASSWORD_ALREADY_SET",
        )
    _validate_password_strength(new_password)
    user.password_hash = hash_password(new_password)
    user.must_set_password = False
    await session.flush()
    return user


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
    user.must_set_password = False
    await session.flush()


async def update_profile(
    session: AsyncSession,
    user: User,
    *,
    display_name: str | None = None,
    login: str | None = None,
    current_password: str | None = None,
    new_password: str | None = None,
) -> User:
    changed = False

    if display_name is not None and display_name != user.display_name:
        user.display_name = display_name
        changed = True

    if login is not None and login != user.login:
        await ensure_login_available(session, login, exclude_user_id=user.id)
        user.login = login
        changed = True

    if new_password is not None:
        if not current_password:
            raise bad_request(
                "Current password is required to set a new password",
                "CURRENT_PASSWORD_REQUIRED",
            )
        if not verify_password(current_password, user.password_hash):
            raise unauthorized("Current password is incorrect", "INVALID_CURRENT_PASSWORD")
        user.password_hash = hash_password(new_password)
        user.must_set_password = False
        changed = True

    if not changed:
        raise bad_request("No profile changes provided", "NO_PROFILE_CHANGES")

    await session.flush()
    return user


async def _resolve_regos_user(
    session: AsyncSession,
    *,
    integration_token: str,
    email: str | None,
    phone: str | None,
    full_name: str,
) -> tuple[User, bool]:
    token_row = await session.execute(
        select(RegosToken).where(RegosToken.integration_token == integration_token)
    )
    existing_token = token_row.scalar_one_or_none()
    if existing_token is not None:
        owner = await _load_company_owner(session, existing_token.company_id)
        return owner, False

    if email:
        by_email = await session.execute(
            select(User).where(User.email == email).options(*_USER_LOGIN_LOAD_OPTIONS)
        )
        user = by_email.scalar_one_or_none()
        if user is not None:
            return user, False

    return await _create_regos_owner(
        session,
        email=email,
        phone=phone,
        full_name=full_name,
    ), True


async def _resolve_regos_sso_user(
    session: AsyncSession,
    *,
    regos_sub: str,
    email: str | None,
    phone: str | None,
    full_name: str,
    company_name: str,
) -> tuple[User, bool]:
    by_sub = await session.execute(
        select(User).where(User.regos_sub == regos_sub).options(*_USER_LOGIN_LOAD_OPTIONS)
    )
    user = by_sub.scalar_one_or_none()
    if user is not None:
        return user, False

    if email:
        by_email = await session.execute(
            select(User).where(User.email == email).options(*_USER_LOGIN_LOAD_OPTIONS)
        )
        user = by_email.scalar_one_or_none()
        if user is not None:
            if not user.regos_sub:
                user.regos_sub = regos_sub
                await session.flush()
            return user, False

    created = await _create_regos_owner(
        session,
        email=email,
        phone=phone,
        full_name=full_name,
        company_name=company_name,
        regos_sub=regos_sub,
    )
    return created, True


async def _create_regos_owner(
    session: AsyncSession,
    *,
    email: str | None,
    phone: str | None,
    full_name: str,
    company_name: str | None = None,
    regos_sub: str | None = None,
) -> User:
    resolved_company_name = company_name or (
        full_name if full_name and full_name != "Regos User" else "Regos"
    )
    slug = await unique_company_slug(session, slugify(resolved_company_name))
    company = Company(name=resolved_company_name, slug=slug, timezone="UTC", settings={})
    start_trial(company)
    session.add(company)
    await session.flush()

    login: str | None = None
    if not email:
        login = await _unique_login_from_phone(session, phone or "")

    user = User(
        company_id=company.id,
        email=email,
        login=login,
        regos_sub=regos_sub,
        password_hash=hash_password(_generate_password()),
        display_name=full_name,
        role=UserRole.owner,
        is_active=True,
        must_set_password=True,
    )
    session.add(user)
    await session.flush()
    await session.refresh(
        user,
        attribute_names=["company", "extra_permissions", "login_schedules"],
    )
    return user

async def _unique_login_from_phone(session: AsyncSession, phone: str) -> str:
    digits = re.sub(r"\D+", "", phone)
    base = digits[-64:] if digits else "regos"
    if len(base) < 2:
        base = f"regos{base}"
    candidate = base[:64]
    counter = 1
    while True:
        result = await session.execute(select(User).where(User.login == candidate))
        if result.scalar_one_or_none() is None:
            return candidate
        suffix = str(counter)
        candidate = f"{base[: max(1, 64 - len(suffix))]}{suffix}"
        counter += 1


async def _load_company_owner(session: AsyncSession, company_id: int) -> User:
    result = await session.execute(
        select(User)
        .where(User.company_id == company_id, User.role == UserRole.owner)
        .options(*_USER_LOGIN_LOAD_OPTIONS)
        .order_by(User.id)
        .limit(1)
    )
    owner = result.scalar_one_or_none()
    if owner is None:
        raise bad_request(
            "No owner found for the company linked to this Regos token",
            "REGOS_COMPANY_OWNER_MISSING",
        )
    return owner


async def _load_user_for_login(
    session: AsyncSession,
    *,
    email: str | None = None,
    login: str | None = None,
) -> User:
    query = select(User).options(*_USER_LOGIN_LOAD_OPTIONS)
    if email is not None:
        query = query.where(User.email == email)
    else:
        query = query.where(User.login == login)

    result = await session.execute(query)
    user = result.scalar_one_or_none()
    if not user:
        raise unauthorized("Invalid credentials")
    return user


async def _authenticate(session: AsyncSession, user: User, password: str) -> tuple[User, str]:
    if not verify_password(password, user.password_hash):
        raise unauthorized("Invalid credentials")
    await _ensure_user_can_session(user, check_schedule=True)
    token = _issue_token(user)
    return user, token


async def _ensure_user_can_session(user: User, *, check_schedule: bool = False) -> None:
    if not user.is_active:
        raise forbidden("Account is deactivated", "ACCOUNT_INACTIVE")

    # Expired subscriptions may still log in to renew via /billing (Click checkout).
    mark_expired_if_needed(user.company)

    if check_schedule and not is_within_login_schedule(
        user.login_schedules, user.company.timezone
    ):
        raise forbidden("Login not allowed at this time", "OUTSIDE_LOGIN_SCHEDULE")


def _generate_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        password = "".join(secrets.choice(alphabet) for _ in range(length))
        if re.search(r"[A-Za-z]", password) and re.search(r"\d", password):
            return password


def _validate_password_strength(password: str) -> None:
    if len(password) < 8:
        raise bad_request(
            "Password must be at least 8 characters",
            "PASSWORD_TOO_SHORT",
        )
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise bad_request(
            "Password must contain letters and digits",
            "PASSWORD_WEAK",
        )


def _issue_token(user: User) -> str:
    perms = sorted(effective_permission_codes(user))
    return create_access_token(
        user_id=user.id,
        company_id=user.company_id,
        role=user.role.value,
        permissions=perms,
    )
