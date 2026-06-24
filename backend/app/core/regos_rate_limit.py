"""Client-side pacing for Regos API request limits.

See https://docs.regos.uz/uz/api/intro/limits — 2 requests/sec refill, burst up to 50.
Limits apply per integration token (connected_integration_id).
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

logger = logging.getLogger("regos.backend")

REGOS_RATE_LIMIT_BURST = 50
REGOS_RATE_LIMIT_REFILL_PER_SECOND = 2.0
REGOS_RATE_LIMIT_ERROR_CODE = 8213
MAX_RATE_LIMIT_RETRIES = 60


def is_regos_rate_limit_error(data: dict) -> bool:
    if data.get("ok"):
        return False
    err_result = data.get("result")
    if not isinstance(err_result, dict):
        return False
    error_code = err_result.get("error")
    return error_code == REGOS_RATE_LIMIT_ERROR_CODE or error_code == str(REGOS_RATE_LIMIT_ERROR_CODE)


@dataclass
class _TokenBucket:
    tokens: float = float(REGOS_RATE_LIMIT_BURST)
    last_update: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def _refill(self, now: float) -> None:
        elapsed = now - self.last_update
        if elapsed <= 0:
            return
        self.tokens = min(
            float(REGOS_RATE_LIMIT_BURST),
            self.tokens + elapsed * REGOS_RATE_LIMIT_REFILL_PER_SECOND,
        )
        self.last_update = now

    async def acquire(self) -> float:
        waited = 0.0
        while True:
            async with self.lock:
                now = time.monotonic()
                self._refill(now)
                if self.tokens >= 1.0:
                    self.tokens -= 1.0
                    return waited
                deficit = 1.0 - self.tokens
                delay = deficit / REGOS_RATE_LIMIT_REFILL_PER_SECOND
            await asyncio.sleep(delay)
            waited += delay

    async def mark_exhausted(self) -> None:
        async with self.lock:
            self.tokens = 0.0
            self.last_update = time.monotonic()


class RegosRateLimiter:
    def __init__(self) -> None:
        self._buckets: dict[str, _TokenBucket] = {}
        self._buckets_lock = asyncio.Lock()

    async def _get_bucket(self, integration_token: str) -> _TokenBucket:
        async with self._buckets_lock:
            bucket = self._buckets.get(integration_token)
            if bucket is None:
                bucket = _TokenBucket()
                self._buckets[integration_token] = bucket
            return bucket

    async def acquire(self, integration_token: str) -> float:
        waited = await (await self._get_bucket(integration_token)).acquire()
        if waited >= 0.1:
            logger.info(
                "Waited %.2fs for Regos API rate limit (integration=%s...)",
                waited,
                integration_token[:8],
            )
        return waited

    async def mark_exhausted(self, integration_token: str) -> None:
        await (await self._get_bucket(integration_token)).mark_exhausted()


regos_rate_limiter = RegosRateLimiter()
