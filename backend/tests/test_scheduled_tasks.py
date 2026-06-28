from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest

from app.services import scheduled_tasks

TASHKENT = ZoneInfo("Asia/Tashkent")


def test_seconds_until_next_out_of_stock_cleanup_before_run_time():
    now = datetime(2026, 6, 29, 1, 30, tzinfo=TASHKENT)
    delay = scheduled_tasks.seconds_until_next_out_of_stock_cleanup(now=now)
    assert delay == 90 * 60


def test_seconds_until_next_out_of_stock_cleanup_at_run_time():
    now = datetime(2026, 6, 29, 3, 0, tzinfo=TASHKENT)
    delay = scheduled_tasks.seconds_until_next_out_of_stock_cleanup(now=now)
    assert delay == 24 * 60 * 60


def test_seconds_until_next_out_of_stock_cleanup_after_run_time():
    now = datetime(2026, 6, 29, 10, 0, tzinfo=TASHKENT)
    delay = scheduled_tasks.seconds_until_next_out_of_stock_cleanup(now=now)
    assert delay == 17 * 60 * 60


@pytest.mark.asyncio
async def test_run_out_of_stock_cleanup_deletes_expired_records(session_factory):
    from datetime import UTC, timedelta

    from sqlalchemy import select

    from app.models import OutOfStockProduct

    async with session_factory() as session:
        session.add_all(
            [
                OutOfStockProduct(
                    company_id=1,
                    product_id=101,
                    stock_id=10,
                    created_at=datetime.now(UTC) - timedelta(days=8),
                ),
                OutOfStockProduct(
                    company_id=1,
                    product_id=102,
                    stock_id=10,
                ),
            ]
        )
        await session.commit()

    with patch(
        "app.services.scheduled_tasks.async_session_factory",
        session_factory,
    ):
        deleted = await scheduled_tasks.run_out_of_stock_cleanup()

    assert deleted == 1

    async with session_factory() as session:
        remaining = (await session.execute(select(OutOfStockProduct))).scalars().all()
        assert len(remaining) == 1
        assert remaining[0].product_id == 102
