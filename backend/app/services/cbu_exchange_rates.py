from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

import aiohttp

from app.config import get_settings
from app.core.exceptions import AppError

logger = logging.getLogger("regos.backend")

CBU_BASE_URL = "https://cbu.uz/common/json"
CBU_TIMEOUT_SECONDS = 30
TASHKENT_TZ = ZoneInfo("Asia/Tashkent")


def get_cbu_daily_fetch_time() -> tuple[int, int]:
    return get_settings().cbu_exchange_rate_fetch_hour_minute


def format_cbu_daily_fetch_time() -> str:
    hour, minute = get_cbu_daily_fetch_time()
    return f"{hour:02d}:{minute:02d}"


@dataclass(frozen=True)
class CbuRate:
    code: str
    rate: float
    nominal: int
    rate_date: date | None


@dataclass
class _CbuRatesCache:
    payload: list[Any]
    fetched_at: datetime


_cache: _CbuRatesCache | None = None
_cache_lock = asyncio.Lock()
_latest_official_rates: dict[str, float] = {}
_previous_official_rates: dict[str, float] = {}


def get_latest_official_rates() -> dict[str, float]:
    """Return a snapshot of the latest official CBU rates cached project-wide."""
    return dict(_latest_official_rates)


def get_previous_official_rates() -> dict[str, float]:
    """Return official CBU rates captured before the most recent fresh fetch."""
    return dict(_previous_official_rates)


def get_cached_cbu_payload() -> list[Any]:
    if _cache is None:
        raise AppError(
            503,
            f"CBU rates are not available yet. Rates refresh daily at "
            f"{format_cbu_daily_fetch_time()} (Asia/Tashkent).",
            "CBU_CACHE_EMPTY",
        )
    return _cache.payload


def get_cbu_cache_fetched_at() -> datetime | None:
    if _cache is None:
        return None
    return _cache.fetched_at


def cache_is_fresh_for_today(*, now: datetime | None = None) -> bool:
    if _cache is None:
        return False
    current = _normalize_tashkent_now(now)
    fetched = _cache.fetched_at.astimezone(TASHKENT_TZ)
    return fetched.date() == current.date()


def clear_cbu_rates_cache() -> None:
    global _cache
    _cache = None
    _latest_official_rates.clear()
    _previous_official_rates.clear()


def parse_cbu_rates_payload(payload: object) -> dict[str, CbuRate]:
    if not isinstance(payload, list):
        raise AppError(502, "Invalid CBU response format.", "CBU_INVALID_RESPONSE")

    rates: dict[str, CbuRate] = {}
    for item in payload:
        if not isinstance(item, dict):
            continue
        code = item.get("Ccy")
        if not isinstance(code, str) or not code.strip():
            continue
        code = code.strip().upper()

        try:
            nominal = int(item.get("Nominal", 1))
            raw_rate = float(item.get("Rate", 0))
        except (TypeError, ValueError):
            logger.warning("Skipping CBU row with invalid rate for %s", code)
            continue
        if nominal <= 0 or raw_rate <= 0:
            continue

        rate_date: date | None = None
        raw_date = item.get("Date")
        if isinstance(raw_date, str) and raw_date.strip():
            try:
                rate_date = datetime.strptime(raw_date.strip(), "%d.%m.%Y").date()
            except ValueError:
                rate_date = None

        rates[code] = CbuRate(
            code=code,
            rate=raw_rate / nominal,
            nominal=nominal,
            rate_date=rate_date,
        )
    return rates


async def refresh_cbu_rates_cache() -> list[Any]:
    """Fetch latest rates from CBU and store the complete JSON response project-wide."""
    global _cache

    async with _cache_lock:
        payload = await _fetch_cbu_json_from_api()
        rates = parse_cbu_rates_payload(payload)
        _update_latest_official_rates(rates)
        _cache = _CbuRatesCache(payload=payload, fetched_at=datetime.now(UTC))
        return payload


async def fetch_cbu_rates() -> dict[str, CbuRate]:
    """Return parsed rates from the project-level cache without contacting CBU."""
    payload = get_cached_cbu_payload()
    return parse_cbu_rates_payload(payload)


async def maybe_refresh_cbu_rates_if_stale(*, now: datetime | None = None) -> bool:
    """Refresh CBU cache when it is missing or from a previous day and past the configured fetch time."""
    if cache_is_fresh_for_today(now=now):
        return False

    current = _normalize_tashkent_now(now)
    fetch_hour, fetch_minute = get_cbu_daily_fetch_time()
    if current.time() < time(fetch_hour, fetch_minute):
        return False

    await refresh_cbu_rates_cache()
    return True


async def _fetch_cbu_json_from_api(*, requested_date: date | None = None) -> list[Any]:
    url = _build_cbu_url(requested_date)
    timeout = aiohttp.ClientTimeout(total=CBU_TIMEOUT_SECONDS)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as response:
                if response.status != 200:
                    raise AppError(
                        502,
                        f"CBU API returned status code {response.status}",
                        "CBU_API_ERROR",
                    )
                text = await response.text()
    except AppError:
        raise
    except Exception as exc:
        logger.error("CBU API request failed", exc_info=True)
        raise AppError(502, "Failed to fetch exchange rates from CBU.", "CBU_API_ERROR") from exc

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AppError(502, "Invalid CBU response format.", "CBU_INVALID_RESPONSE") from exc

    if not isinstance(payload, list):
        raise AppError(502, "Invalid CBU response format.", "CBU_INVALID_RESPONSE")
    return payload


def _build_cbu_url(requested_date: date | None = None) -> str:
    if requested_date is None:
        return CBU_BASE_URL
    return f"{CBU_BASE_URL}?date={requested_date.strftime('%d.%m.%Y')}"


def _update_latest_official_rates(rates: dict[str, CbuRate]) -> None:
    global _latest_official_rates, _previous_official_rates
    _previous_official_rates = dict(_latest_official_rates)
    _latest_official_rates = {code: rate.rate for code, rate in rates.items()}


def _normalize_tashkent_now(now: datetime | None) -> datetime:
    current = now or datetime.now(TASHKENT_TZ)
    if current.tzinfo is None:
        return current.replace(tzinfo=TASHKENT_TZ)
    return current.astimezone(TASHKENT_TZ)
