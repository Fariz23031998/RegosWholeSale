"""Regos OAuth client-credentials token acquisition and user-token validation."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

import aiohttp

from app.config import get_settings
from app.core.exceptions import AppError, unauthorized

logger = logging.getLogger("regos.backend")
settings = get_settings()

CACHE_SAFETY_MARGIN_SECONDS = 30
EXPECTED_ISSUER_HOST = "auth.regos.uz"


def regos_oauth_configured() -> bool:
    return bool(settings.regos_client_id and settings.regos_client_secret)


@dataclass(frozen=True)
class RegosUserInfo:
    sub: str
    email: str | None = None
    phone_number: str | None = None
    given_name: str | None = None
    family_name: str | None = None
    company: str | None = None


class RegosOAuthService:
    def __init__(self) -> None:
        self._access_token: str | None = None
        self._expires_at: float = 0.0
        self._lock = asyncio.Lock()

    def _is_cache_valid(self) -> bool:
        if not self._access_token:
            return False
        return time.monotonic() < self._expires_at - CACHE_SAFETY_MARGIN_SECONDS

    async def acquire_access_token(self, *, force: bool = False) -> str:
        if not regos_oauth_configured():
            raise AppError(
                503,
                "Regos OAuth is not configured (REGOS_CLIENT_ID / REGOS_CLIENT_SECRET)",
                "REGOS_OAUTH_NOT_CONFIGURED",
            )

        async with self._lock:
            if not force and self._is_cache_valid():
                assert self._access_token is not None
                return self._access_token

            timeout = aiohttp.ClientTimeout(total=30)
            form = {
                "grant_type": "client_credentials",
                "client_id": settings.regos_client_id,
                "client_secret": settings.regos_client_secret,
            }

            try:
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.post(
                        settings.regos_oauth_token_url,
                        data=form,
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                    ) as response:
                        body_text = await response.text()
                        if response.status != 200:
                            logger.error(
                                "Regos OAuth token request failed: status=%s body=%s",
                                response.status,
                                body_text[:500],
                            )
                            raise AppError(
                                502,
                                f"Regos OAuth token request failed with status {response.status}",
                                "REGOS_OAUTH_ERROR",
                            )
                        data = await response.json()
            except AppError:
                raise
            except aiohttp.ClientError as exc:
                logger.error("Regos OAuth client error: %s", exc)
                raise AppError(
                    502, f"Regos OAuth token request failed: {exc}", "REGOS_OAUTH_ERROR"
                ) from exc
            except Exception as exc:
                logger.error("Regos OAuth unexpected error: %s", exc)
                raise AppError(
                    502, f"Regos OAuth token request failed: {exc}", "REGOS_OAUTH_ERROR"
                ) from exc

            access_token = data.get("access_token")
            if not access_token or not isinstance(access_token, str):
                raise AppError(
                    502,
                    "Regos OAuth response missing access_token",
                    "REGOS_OAUTH_ERROR",
                )

            expires_in = int(data.get("expires_in") or 600)
            self._access_token = access_token
            self._expires_at = time.monotonic() + expires_in
            logger.info("Regos OAuth access token acquired (expires_in=%s)", expires_in)
            return access_token

    async def introspect_access_token(self, token: str) -> dict:
        """Validate an opaque REGOS user access token via introspection."""
        if not regos_oauth_configured():
            raise AppError(
                503,
                "Regos OAuth is not configured (REGOS_CLIENT_ID / REGOS_CLIENT_SECRET)",
                "REGOS_OAUTH_NOT_CONFIGURED",
            )

        timeout = aiohttp.ClientTimeout(total=30)
        form = {
            "token": token,
            "token_type_hint": "access_token",
        }
        auth = aiohttp.BasicAuth(settings.regos_client_id, settings.regos_client_secret)

        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(
                    settings.regos_oauth_introspect_url,
                    data=form,
                    auth=auth,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                ) as response:
                    body_text = await response.text()
                    if response.status != 200:
                        logger.error(
                            "Regos OAuth introspect failed: status=%s body=%s",
                            response.status,
                            body_text[:500],
                        )
                        raise AppError(
                            502,
                            f"Regos OAuth introspect failed with status {response.status}",
                            "REGOS_OAUTH_ERROR",
                        )
                    data = await response.json(content_type=None)
        except AppError:
            raise
        except aiohttp.ClientError as exc:
            logger.error("Regos OAuth introspect client error: %s", exc)
            raise AppError(
                502, f"Regos OAuth introspect failed: {exc}", "REGOS_OAUTH_ERROR"
            ) from exc
        except Exception as exc:
            logger.error("Regos OAuth introspect unexpected error: %s", exc)
            raise AppError(
                502, f"Regos OAuth introspect failed: {exc}", "REGOS_OAUTH_ERROR"
            ) from exc

        if not isinstance(data, dict):
            raise AppError(
                502,
                "Regos OAuth introspect returned invalid payload",
                "REGOS_OAUTH_ERROR",
            )

        if not data.get("active"):
            raise unauthorized("Regos access token is inactive", "REGOS_TOKEN_INACTIVE")

        issuer = data.get("iss")
        if isinstance(issuer, str) and issuer and EXPECTED_ISSUER_HOST not in issuer:
            raise unauthorized(
                "Regos access token issuer is not trusted",
                "REGOS_TOKEN_INVALID_ISSUER",
            )

        return data

    async def fetch_userinfo(self, token: str) -> RegosUserInfo:
        """Load public REGOS profile for an active user access token."""
        timeout = aiohttp.ClientTimeout(total=30)

        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(
                    settings.regos_oauth_userinfo_url,
                    headers={"Authorization": f"Bearer {token}"},
                ) as response:
                    body_text = await response.text()
                    if response.status in (401, 403):
                        raise unauthorized(
                            "Regos access token is invalid or expired",
                            "REGOS_TOKEN_INACTIVE",
                        )
                    if response.status != 200:
                        logger.error(
                            "Regos OAuth userinfo failed: status=%s body=%s",
                            response.status,
                            body_text[:500],
                        )
                        raise AppError(
                            502,
                            f"Regos OAuth userinfo failed with status {response.status}",
                            "REGOS_OAUTH_ERROR",
                        )
                    data = await response.json(content_type=None)
        except AppError:
            raise
        except aiohttp.ClientError as exc:
            logger.error("Regos OAuth userinfo client error: %s", exc)
            raise AppError(
                502, f"Regos OAuth userinfo failed: {exc}", "REGOS_OAUTH_ERROR"
            ) from exc
        except Exception as exc:
            logger.error("Regos OAuth userinfo unexpected error: %s", exc)
            raise AppError(
                502, f"Regos OAuth userinfo failed: {exc}", "REGOS_OAUTH_ERROR"
            ) from exc

        if not isinstance(data, dict):
            raise AppError(
                502,
                "Regos OAuth userinfo returned invalid payload",
                "REGOS_OAUTH_ERROR",
            )

        sub = str(data.get("sub") or "").strip()
        if not sub:
            raise AppError(
                502,
                "Regos OAuth userinfo missing sub",
                "REGOS_USERINFO_MISSING_SUB",
            )

        email_raw = data.get("email")
        email = str(email_raw).strip().lower() if email_raw else None
        if email == "":
            email = None

        phone_raw = data.get("phone_number")
        phone = str(phone_raw).strip() if phone_raw else None
        if phone == "":
            phone = None
        elif phone and not phone.startswith("+"):
            phone = f"+{phone}"

        def _optional_str(key: str) -> str | None:
            value = data.get(key)
            if value is None:
                return None
            text = str(value).strip()
            return text or None

        return RegosUserInfo(
            sub=sub,
            email=email,
            phone_number=phone,
            given_name=_optional_str("given_name"),
            family_name=_optional_str("family_name"),
            company=_optional_str("company"),
        )


regos_oauth_service = RegosOAuthService()
