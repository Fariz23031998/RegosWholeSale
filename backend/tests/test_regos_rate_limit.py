from unittest.mock import AsyncMock, patch

import pytest

from app.core.exceptions import AppError
from app.core.regos_api import regos_async_api_request
from app.core.regos_rate_limit import (
    REGOS_RATE_LIMIT_BURST,
    RegosRateLimiter,
    is_regos_rate_limit_error,
    regos_rate_limiter,
)


def test_is_regos_rate_limit_error_accepts_int_and_str() -> None:
    assert is_regos_rate_limit_error({"ok": False, "result": {"error": 8213}})
    assert is_regos_rate_limit_error({"ok": False, "result": {"error": "8213"}})
    assert not is_regos_rate_limit_error({"ok": True, "result": []})
    assert not is_regos_rate_limit_error({"ok": False, "result": {"error": 400}})


@pytest.mark.asyncio
async def test_rate_limiter_waits_when_bucket_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    limiter = RegosRateLimiter()
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr("app.core.regos_rate_limit.asyncio.sleep", fake_sleep)

    bucket = await limiter._get_bucket("token-a")
    bucket.tokens = 0.0
    bucket.last_update = 0.0

    with patch("app.core.regos_rate_limit.time.monotonic", side_effect=[0.0, 0.5]):
        waited = await limiter.acquire("token-a")

    assert waited == pytest.approx(0.5)
    assert sleeps == [pytest.approx(0.5)]
    assert bucket.tokens == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_rate_limiter_uses_burst_without_waiting() -> None:
    limiter = RegosRateLimiter()
    for _ in range(REGOS_RATE_LIMIT_BURST):
        waited = await limiter.acquire("token-burst")
        assert waited == 0.0


@pytest.mark.asyncio
@patch("app.core.regos_api._post_regos_api", new_callable=AsyncMock)
async def test_regos_api_retries_on_rate_limit_error(mock_post: AsyncMock) -> None:
    mock_post.side_effect = [
        {"ok": False, "result": {"error": 8213, "description": "Too many requests"}},
        {"ok": True, "result": [{"id": 1}]},
    ]

    with patch.object(regos_rate_limiter, "acquire", new_callable=AsyncMock) as mock_acquire:
        with patch.object(regos_rate_limiter, "mark_exhausted", new_callable=AsyncMock) as mock_exhausted:
            result = await regos_async_api_request("item/get", {}, "integration-token")

    assert result == {"ok": True, "result": [{"id": 1}]}
    assert mock_acquire.await_count == 2
    mock_exhausted.assert_awaited_once_with("integration-token")


@pytest.mark.asyncio
@patch("app.core.regos_api._post_regos_api", new_callable=AsyncMock)
async def test_regos_api_raises_after_rate_limit_retries_exhausted(mock_post: AsyncMock) -> None:
    mock_post.return_value = {
        "ok": False,
        "result": {"error": 8213, "description": "Too many requests"},
    }

    with patch("app.core.regos_rate_limit.MAX_RATE_LIMIT_RETRIES", 2):
        with patch.object(regos_rate_limiter, "acquire", new_callable=AsyncMock):
            with patch.object(regos_rate_limiter, "mark_exhausted", new_callable=AsyncMock):
                with pytest.raises(AppError) as exc_info:
                    await regos_async_api_request("item/get", {}, "integration-token")

    assert exc_info.value.detail["code"] == "REGOS_API_RATE_LIMIT"
