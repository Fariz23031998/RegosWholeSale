from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.exceptions import AppError
from app.core.regos_oauth import RegosUserInfo
from app.models import User
from helpers import register_owner


def _userinfo(
    *,
    sub: str = "regos-user-1",
    email: str | None = "sso-user@test.com",
    phone: str | None = "+998901112233",
    given_name: str | None = "Ali",
    family_name: str | None = "Valiyev",
    company: str | None = "SSO Co",
) -> RegosUserInfo:
    return RegosUserInfo(
        sub=sub,
        email=email,
        phone_number=phone,
        given_name=given_name,
        family_name=family_name,
        company=company,
    )


@pytest.mark.asyncio
async def test_regos_sso_creates_owner_and_requires_password(
    client: AsyncClient,
    session_factory,
) -> None:
    with patch(
        "app.services.auth.regos_oauth_service.fetch_userinfo",
        new_callable=AsyncMock,
        return_value=_userinfo(),
    ) as mock_userinfo:
        response = await client.post(
            "/api/v1/auth/regos-sso",
            json={"access_token": "regos-user-access-token"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["access_token"]
    assert data["requires_password_setup"] is True
    assert data["user"]["email"] == "sso-user@test.com"
    assert data["user"]["role"] == "owner"
    assert data["user"]["display_name"] == "Ali Valiyev"
    assert data["user"]["company"]["name"] == "SSO Co"

    mock_userinfo.assert_awaited_once_with("regos-user-access-token")

    async with session_factory() as session:
        user = (
            await session.execute(select(User).where(User.email == "sso-user@test.com"))
        ).scalar_one()
        assert user.must_set_password is True
        assert user.regos_sub == "regos-user-1"


@pytest.mark.asyncio
async def test_regos_sso_links_existing_email_and_backfills_sub(
    client: AsyncClient,
    session_factory,
) -> None:
    await register_owner(
        client,
        email="existing-sso@test.com",
        company_name="Existing SSO Co",
    )

    with patch(
        "app.services.auth.regos_oauth_service.fetch_userinfo",
        new_callable=AsyncMock,
        return_value=_userinfo(
            sub="regos-existing-1",
            email="existing-sso@test.com",
            given_name="Existing",
            family_name="Owner",
            company="Ignored",
        ),
    ):
        response = await client.post(
            "/api/v1/auth/regos-sso",
            json={"access_token": "regos-user-access-token"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["requires_password_setup"] is False
    assert data["user"]["email"] == "existing-sso@test.com"
    assert data["user"]["company"]["name"] == "Existing SSO Co"

    async with session_factory() as session:
        user = (
            await session.execute(select(User).where(User.email == "existing-sso@test.com"))
        ).scalar_one()
        assert user.regos_sub == "regos-existing-1"


@pytest.mark.asyncio
async def test_regos_sso_logs_in_by_regos_sub(
    client: AsyncClient,
    session_factory,
) -> None:
    with patch(
        "app.services.auth.regos_oauth_service.fetch_userinfo",
        new_callable=AsyncMock,
        return_value=_userinfo(sub="regos-repeat-1", email="repeat-sso@test.com"),
    ):
        first = await client.post(
            "/api/v1/auth/regos-sso",
            json={"access_token": "token-1"},
        )
    assert first.status_code == 200
    assert first.json()["requires_password_setup"] is True

    with patch(
        "app.services.auth.regos_oauth_service.fetch_userinfo",
        new_callable=AsyncMock,
        return_value=_userinfo(
            sub="regos-repeat-1",
            email="other-email@test.com",
            given_name="Changed",
            family_name="Name",
        ),
    ):
        second = await client.post(
            "/api/v1/auth/regos-sso",
            json={"access_token": "token-2"},
        )

    assert second.status_code == 200
    data = second.json()
    assert data["user"]["email"] == "repeat-sso@test.com"
    assert data["requires_password_setup"] is True

    async with session_factory() as session:
        users = (
            await session.execute(select(User).where(User.regos_sub == "regos-repeat-1"))
        ).scalars().all()
        assert len(users) == 1


@pytest.mark.asyncio
async def test_regos_sso_rejects_inactive_token(client: AsyncClient) -> None:
    with patch(
        "app.services.auth.regos_oauth_service.fetch_userinfo",
        new_callable=AsyncMock,
        side_effect=AppError(401, "Regos access token is invalid or expired", "REGOS_TOKEN_INACTIVE"),
    ):
        response = await client.post(
            "/api/v1/auth/regos-sso",
            json={"access_token": "dead-token"},
        )

    assert response.status_code == 401
    assert response.json()["code"] == "REGOS_TOKEN_INACTIVE"


@pytest.mark.asyncio
async def test_regos_sso_requires_email_or_phone(client: AsyncClient) -> None:
    with patch(
        "app.services.auth.regos_oauth_service.fetch_userinfo",
        new_callable=AsyncMock,
        return_value=_userinfo(
            sub="regos-no-contact",
            email=None,
            phone=None,
        ),
    ):
        response = await client.post(
            "/api/v1/auth/regos-sso",
            json={"access_token": "regos-user-access-token"},
        )

    assert response.status_code == 400
    assert response.json()["code"] == "REGOS_USER_CONTACT_REQUIRED"
