import asyncio
import logging
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.database import async_session_factory
from app.services.cbu_exchange_rates import (
    format_cbu_daily_fetch_time,
    get_cbu_daily_fetch_time,
    maybe_refresh_cbu_rates_if_stale,
    refresh_cbu_rates_cache,
)
from app.services.exchange_rate_sync import sync_exchange_rates_for_all_companies
from app.services.out_of_stock_products import clean_out_of_stock_products
from app.services.receipt_shares import clean_expired_receipt_shares

logger = logging.getLogger("regos.backend")

TASHKENT_TZ = ZoneInfo("Asia/Tashkent")
OUT_OF_STOCK_CLEANUP_HOUR = 3
OUT_OF_STOCK_CLEANUP_MINUTE = 0
OUT_OF_STOCK_RETENTION_DAYS = 7
RECEIPT_SHARE_CLEANUP_HOUR = 3
RECEIPT_SHARE_CLEANUP_MINUTE = 30


def seconds_until_next_daily_run(
    *,
    hour: int,
    minute: int,
    tz: ZoneInfo = TASHKENT_TZ,
    now: datetime | None = None,
) -> float:
    current = now or datetime.now(tz)
    if current.tzinfo is None:
        current = current.replace(tzinfo=tz)
    else:
        current = current.astimezone(tz)

    next_run = datetime.combine(current.date(), time(hour, minute), tzinfo=tz)
    if current >= next_run:
        next_run += timedelta(days=1)
    return (next_run - current).total_seconds()


def seconds_until_next_out_of_stock_cleanup(
    *,
    now: datetime | None = None,
) -> float:
    return seconds_until_next_daily_run(
        hour=OUT_OF_STOCK_CLEANUP_HOUR,
        minute=OUT_OF_STOCK_CLEANUP_MINUTE,
        now=now,
    )


def seconds_until_next_receipt_share_cleanup(
    *,
    now: datetime | None = None,
) -> float:
    return seconds_until_next_daily_run(
        hour=RECEIPT_SHARE_CLEANUP_HOUR,
        minute=RECEIPT_SHARE_CLEANUP_MINUTE,
        now=now,
    )


def seconds_until_next_exchange_rate_fetch(
    *,
    now: datetime | None = None,
) -> float:
    fetch_hour, fetch_minute = get_cbu_daily_fetch_time()
    return seconds_until_next_daily_run(
        hour=fetch_hour,
        minute=fetch_minute,
        now=now,
    )


async def run_out_of_stock_cleanup() -> int:
    async with async_session_factory() as session:
        deleted = await clean_out_of_stock_products(
            session,
            retention_days=OUT_OF_STOCK_RETENTION_DAYS,
        )
        await session.commit()
    return deleted


async def out_of_stock_cleanup_loop() -> None:
    while True:
        delay = seconds_until_next_out_of_stock_cleanup()
        logger.info(
            "Next out-of-stock cleanup in %.0f seconds (03:00 %s)",
            delay,
            TASHKENT_TZ,
        )
        await asyncio.sleep(delay)
        try:
            deleted = await run_out_of_stock_cleanup()
            logger.info(
                "Deleted %s expired out-of-stock product records (retention=%s days)",
                deleted,
                OUT_OF_STOCK_RETENTION_DAYS,
            )
        except Exception:
            logger.error("Out-of-stock cleanup failed", exc_info=True)


async def run_receipt_share_cleanup() -> int:
    async with async_session_factory() as session:
        deleted = await clean_expired_receipt_shares(session)
        await session.commit()
    return deleted


async def receipt_share_cleanup_loop() -> None:
    while True:
        delay = seconds_until_next_receipt_share_cleanup()
        logger.info(
            "Next receipt-share cleanup in %.0f seconds (03:30 %s)",
            delay,
            TASHKENT_TZ,
        )
        await asyncio.sleep(delay)
        try:
            deleted = await run_receipt_share_cleanup()
            if deleted:
                logger.info("Deleted %s expired receipt share records", deleted)
        except Exception:
            logger.error("Receipt share cleanup failed", exc_info=True)


async def run_daily_exchange_rate_sync() -> list[dict]:
    await refresh_cbu_rates_cache()
    async with async_session_factory() as session:
        results = await sync_exchange_rates_for_all_companies(
            session,
            trigger="scheduled",
        )
    return results


async def exchange_rate_sync_loop() -> None:
    try:
        refreshed = await maybe_refresh_cbu_rates_if_stale()
        if refreshed:
            logger.info("Refreshed CBU exchange rates on startup")
    except Exception:
        logger.error("Failed to refresh CBU exchange rates on startup", exc_info=True)

    while True:
        delay = seconds_until_next_exchange_rate_fetch()
        fetch_time = format_cbu_daily_fetch_time()
        logger.info(
            "Next CBU exchange rate fetch in %.0f seconds (%s %s)",
            delay,
            fetch_time,
            TASHKENT_TZ,
        )
        await asyncio.sleep(delay)
        try:
            results = await run_daily_exchange_rate_sync()
            if results:
                logger.info("Exchange rate sync completed for %s companies", len(results))
        except Exception:
            logger.error("Daily exchange rate sync failed", exc_info=True)
