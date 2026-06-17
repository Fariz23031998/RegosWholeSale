"""Regos OAuth client-credentials token acquisition and refresh."""

from __future__ import annotations

import asyncio
import logging
import time

import aiohttp

from app.config import get_settings
from app.core.exceptions import AppError

logger = logging.getLogger("regos.backend")
settings = get_settings()

CACHE_SAFETY_MARGIN_SECONDS = 30


def regos_oauth_configured() -> bool:
    return bool(settings.regos_client_id and settings.regos_client_secret)


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


regos_oauth_service = RegosOAuthService()
