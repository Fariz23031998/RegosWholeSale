import logging
from typing import Any

from app.services import regos_out_of_stock as out_of_stock_service

logger = logging.getLogger("regos.backend")


async def _run_with_session(coro) -> None:
    from app.database import async_session_factory

    async with async_session_factory() as session:
        await coro(session)
        await session.commit()


async def process_out_of_stock_for_document(
    company_id: int,
    event_action: str,
    document: dict[str, Any],
    operations: list[dict[str, Any]],
) -> None:
    try:
        async def run(session):
            await out_of_stock_service.check_and_record_out_of_stock(
                session,
                company_id,
                event_action,
                document,
                operations,
            )

        await _run_with_session(run)
    except Exception:
        logger.error(
            "Background out-of-stock check failed for company=%s event=%s",
            company_id,
            event_action,
            exc_info=True,
        )


async def process_out_of_stock_for_cheque(
    company_id: int,
    cheque: dict[str, Any],
    operations: list[dict[str, Any]],
) -> None:
    try:
        async def run(session):
            await out_of_stock_service.check_and_record_out_of_stock_from_cheque(
                session,
                company_id,
                cheque,
                operations,
            )

        await _run_with_session(run)
    except Exception:
        logger.error(
            "Background out-of-stock check failed for company=%s cheque=%s",
            company_id,
            cheque.get("uuid"),
            exc_info=True,
        )
