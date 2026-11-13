from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import RegosToken, User
from helpers import register_owner

INTEGRATION_TOKEN = "b" * 32
OTHER_TOKEN = "c" * 32


def _user_get_result(*, email: str = "", phone: str = "", full_name: str = "Regos Admin"):
    return {
        "ok": True,
        "result": [
            {
                "id": 1,
                "email": email,
                "main_phone": phone,
                "full_name": full_name,
            }
        ],
    }


@pytest.mark.asyncio
async def test_regos_webhook_get_redirects_to_callback(client: AsyncClient) -> None:
    response = await client.get(
        f"/api/v1/regos/webhook/{INTEGRATION_TOKEN}",
        follow_redirects=False,
    )
    assert response.status_code == 302
    assert response.headers["location"] == f"/integration/callback/{INTEGRATION_TOKEN}"


@pytest.mark.asyncio
async def test_regos_webhook_get_rejects_invalid_token(client: AsyncClient) -> None:
    response = await client.get(
        "/api/v1/regos/webhook/not-a-valid-token",
        follow_redirects=False,
    )
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_REGOS_TOKEN"


@pytest.mark.asyncio
async def test_regos_integration_creates_owner_and_requires_password(
    client: AsyncClient,
    session_factory,
) -> None:
    with (
        patch(
            "app.services.auth.regos_oauth_service.acquire_access_token",
            new_callable=AsyncMock,
            return_value="oauth-bearer",
        ),
        patch(
            "app.services.auth.regos_async_api_request",
            new_callable=AsyncMock,
            return_value=_user_get_result(
                email="catalog-new@test.com",
                phone="+998901112233",
                full_name="Catalog Owner",
            ),
        ) as mock_api,
    ):
        response = await client.post(
            "/api/v1/auth/regos-integration",
            json={"token": INTEGRATION_TOKEN},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["access_token"]
    assert data["requires_password_setup"] is True
    assert data["user"]["email"] == "catalog-new@test.com"
    assert data["user"]["role"] == "owner"
    assert data["user"]["display_name"] == "Catalog Owner"

    mock_api.assert_awaited_once()
    assert mock_api.await_args.kwargs["token"] == INTEGRATION_TOKEN
    assert mock_api.await_args.kwargs["bearer_token"] == "oauth-bearer"
    assert mock_api.await_args.kwargs["endpoint"] == "User/Get"

    async with session_factory() as session:
        token_row = (
            await session.execute(
                select(RegosToken).where(RegosToken.integration_token == INTEGRATION_TOKEN)
            )
        ).scalar_one()
        assert token_row.is_replicable is True
        user = (
            await session.execute(select(User).where(User.email == "catalog-new@test.com"))
        ).scalar_one()
        assert user.must_set_password is True
        assert user.company_id == token_row.company_id


@pytest.mark.asyncio
async def test_regos_integration_logs_in_existing_token_owner(
    client: AsyncClient,
) -> None:
    reg = await register_owner(
        client,
        email="existing-token@test.com",
        company_name="Existing Token Co",
    )
    owner_token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {owner_token}"}

    upsert = await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": INTEGRATION_TOKEN, "is_replicable": False},
    )
    assert upsert.status_code == 200

    with (
        patch(
            "app.services.auth.regos_oauth_service.acquire_access_token",
            new_callable=AsyncMock,
            return_value="oauth-bearer",
        ),
        patch(
            "app.services.auth.regos_async_api_request",
            new_callable=AsyncMock,
            return_value=_user_get_result(
                email="other@test.com",
                phone="+998909998877",
            ),
        ),
    ):
        response = await client.post(
            "/api/v1/auth/regos-integration",
            json={"token": INTEGRATION_TOKEN},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["requires_password_setup"] is False
    assert data["user"]["email"] == "existing-token@test.com"
    assert data["user"]["role"] == "owner"

    status = await client.get(
        "/api/v1/regos/tokens/status",
        headers={"Authorization": f"Bearer {data['access_token']}"},
    )
    assert status.json()["configured"] is True
    assert status.json()["is_replicable"] is True


@pytest.mark.asyncio
async def test_regos_integration_matches_existing_email(
    client: AsyncClient,
) -> None:
    reg = await register_owner(
        client,
        email="match-email@test.com",
        company_name="Match Email Co",
    )
    assert reg.status_code == 200

    with (
        patch(
            "app.services.auth.regos_oauth_service.acquire_access_token",
            new_callable=AsyncMock,
            return_value="oauth-bearer",
        ),
        patch(
            "app.services.auth.regos_async_api_request",
            new_callable=AsyncMock,
            return_value=_user_get_result(
                email="match-email@test.com",
                phone="+998901234567",
            ),
        ),
    ):
        response = await client.post(
            "/api/v1/auth/regos-integration",
            json={"token": OTHER_TOKEN},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["requires_password_setup"] is False
    assert data["user"]["email"] == "match-email@test.com"

    status = await client.get(
        "/api/v1/regos/tokens/status",
        headers={"Authorization": f"Bearer {data['access_token']}"},
    )
    assert status.json()["configured"] is True
    assert status.json()["is_replicable"] is True


@pytest.mark.asyncio
async def test_regos_integration_requires_email_or_phone(client: AsyncClient) -> None:
    with (
        patch(
            "app.services.auth.regos_oauth_service.acquire_access_token",
            new_callable=AsyncMock,
            return_value="oauth-bearer",
        ),
        patch(
            "app.services.auth.regos_async_api_request",
            new_callable=AsyncMock,
            return_value=_user_get_result(email="", phone=""),
        ),
    ):
        response = await client.post(
            "/api/v1/auth/regos-integration",
            json={"token": INTEGRATION_TOKEN},
        )

    assert response.status_code == 400
    assert response.json()["code"] == "REGOS_USER_CONTACT_REQUIRED"


@pytest.mark.asyncio
async def test_regos_integration_creates_from_phone_only(
    client: AsyncClient,
    session_factory,
) -> None:
    with (
        patch(
            "app.services.auth.regos_oauth_service.acquire_access_token",
            new_callable=AsyncMock,
            return_value="oauth-bearer",
        ),
        patch(
            "app.services.auth.regos_async_api_request",
            new_callable=AsyncMock,
            return_value=_user_get_result(email="", phone="998907654321"),
        ),
    ):
        response = await client.post(
            "/api/v1/auth/regos-integration",
            json={"token": "d" * 32},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["requires_password_setup"] is True
    assert data["user"]["email"] is None
    assert data["user"]["login"] == "998907654321"

    async with session_factory() as session:
        user = (
            await session.execute(select(User).where(User.login == "998907654321"))
        ).scalar_one()
        assert user.must_set_password is True


@pytest.mark.asyncio
async def test_set_initial_password_flow(client: AsyncClient) -> None:
    with (
        patch(
            "app.services.auth.regos_oauth_service.acquire_access_token",
            new_callable=AsyncMock,
            return_value="oauth-bearer",
        ),
        patch(
            "app.services.auth.regos_async_api_request",
            new_callable=AsyncMock,
            return_value=_user_get_result(email="set-pass@test.com", phone="+998901111111"),
        ),
    ):
        created = await client.post(
            "/api/v1/auth/regos-integration",
            json={"token": "e" * 32},
        )

    assert created.status_code == 200
    access_token = created.json()["access_token"]
    headers = {"Authorization": f"Bearer {access_token}"}

    weak = await client.post(
        "/api/v1/auth/set-initial-password",
        headers=headers,
        json={"new_password": "short"},
    )
    assert weak.status_code == 422

    weak_format = await client.post(
        "/api/v1/auth/set-initial-password",
        headers=headers,
        json={"new_password": "onlyletters"},
    )
    assert weak_format.status_code == 400
    assert weak_format.json()["code"] == "PASSWORD_WEAK"

    ok = await client.post(
        "/api/v1/auth/set-initial-password",
        headers=headers,
        json={"new_password": "Password99"},
    )
    assert ok.status_code == 200

    again = await client.post(
        "/api/v1/auth/set-initial-password",
        headers=headers,
        json={"new_password": "Password88"},
    )
    assert again.status_code == 400
    assert again.json()["code"] == "PASSWORD_ALREADY_SET"

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "set-pass@test.com", "password": "Password99"},
    )
    assert login.status_code == 200
