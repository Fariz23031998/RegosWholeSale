import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import document_telegram_format as fmt
from app.services import pos_session_excel as session_excel
from app.services import pos_session_report as session_report
from app.services import regos_document_fetch as doc_fetch
from app.services import regos_out_of_stock as out_of_stock_service
from app.services import regos_pos_fetch as pos_fetch
from app.services import telegram as telegram_service
from app.services.telegram_i18n import t
from app.services.telegram_notification_scope import (
    scope_from_cheque,
    scope_from_document,
    scope_from_session,
)
from app.services.telegram_notifications import (
    resolve_document_notification_type,
    resolve_pos_cheque_notification_type,
    resolve_pos_session_notification_type,
)

logger = logging.getLogger("regos.backend")


async def _run_with_session(coro) -> None:
    from app.database import async_session_factory

    async with async_session_factory() as session:
        await coro(session)
        await session.commit()


async def _resolve_warehouse_name(
    session: AsyncSession,
    company_id: int,
    document: dict[str, Any],
) -> str | None:
    name = doc_fetch.stock_name_from_document(document)
    if name:
        return name
    stock_id = doc_fetch.stock_id_from_document(document)
    if stock_id is None:
        return None
    fetched = await doc_fetch.fetch_stock_name(session, company_id, stock_id)
    return fetched


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


async def process_operation_document(
    company_id: int,
    document_id: int,
    event_action: str,
) -> None:
    from app.services.regos_webhook import EVENT_SPECS

    try:
        async def run(session):
            event_spec = EVENT_SPECS.get(event_action)
            if event_spec is None or event_spec.spec is None:
                return
            spec = event_spec.spec

            document = await doc_fetch.fetch_document(
                session, company_id, spec.doc_endpoint, document_id
            )
            if not document:
                return

            operations = await doc_fetch.fetch_operations(
                session, company_id, spec.ops_endpoint, document_id
            )
            if not operations:
                return

            if spec.kind == "movement":
                build_message = lambda lang: fmt.format_movement_receipt(
                    document,
                    operations,
                    is_cancelled=event_spec.is_cancelled,
                    lang=lang,
                )
            elif spec.kind == "inout":
                warehouse_name = await _resolve_warehouse_name(session, company_id, document)
                build_message = lambda lang: fmt.format_inout_receipt(
                    document,
                    operations,
                    warehouse_name,
                    is_cancelled=event_spec.is_cancelled,
                    lang=lang,
                )
            else:
                warehouse_name = await _resolve_warehouse_name(session, company_id, document)
                build_message = lambda lang: fmt.format_partner_receipt(
                    document,
                    operations,
                    warehouse_name,
                    is_cancelled=event_spec.is_cancelled,
                    is_return=spec.is_return,
                    use_cost=spec.use_cost,
                    lang=lang,
                )

            leaf_type = resolve_document_notification_type(
                event_spec.notification_type,
                is_cancelled=event_spec.is_cancelled,
            )
            await telegram_service.notify_company_subscribers(
                session,
                company_id,
                notification_type=leaf_type,
                build_message=build_message,
                scope=scope_from_document(document),
            )

            if (
                out_of_stock_service.is_stock_decrease_event(event_action, document)
                and doc_fetch.item_ids_from_operations(operations)
            ):
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
            "Background operation document notification failed for company=%s document=%s event=%s",
            company_id,
            document_id,
            event_action,
            exc_info=True,
        )


async def process_payment_document(
    company_id: int,
    document_id: int,
    event_action: str,
) -> None:
    from app.services.regos_webhook import EVENT_SPECS

    try:
        async def run(session):
            event_spec = EVENT_SPECS.get(event_action)
            if event_spec is None:
                return

            document = await doc_fetch.fetch_document(
                session, company_id, doc_fetch.PAYMENT_DOC_ENDPOINT, document_id
            )
            if not document:
                return

            warehouse_name = await _resolve_warehouse_name(session, company_id, document)
            build_message = lambda lang: fmt.format_payment_notification(
                document,
                warehouse_name,
                is_cancelled=event_spec.is_cancelled,
                lang=lang,
            )
            leaf_type = resolve_document_notification_type(
                event_spec.notification_type,
                is_cancelled=event_spec.is_cancelled,
            )
            await telegram_service.notify_company_subscribers(
                session,
                company_id,
                notification_type=leaf_type,
                build_message=build_message,
                scope=scope_from_document(document),
            )

        await _run_with_session(run)
    except Exception:
        logger.error(
            "Background payment document notification failed for company=%s document=%s event=%s",
            company_id,
            document_id,
            event_action,
            exc_info=True,
        )


async def process_pos_cheque(
    company_id: int,
    cheque_uuid: str,
    event_action: str,
) -> None:
    from app.services.regos_webhook import (
        POS_EVENT_SPECS,
        _mark_pos_cheque_receipt_sent,
        _recent_pos_cheque_receipt_sent,
    )

    try:
        async def run(session):
            pos_spec = POS_EVENT_SPECS.get(event_action)
            if pos_spec is None:
                return

            cheque = await pos_fetch.fetch_cheque_by_uuid(session, company_id, cheque_uuid)
            if not cheque:
                return

            receipt_cache_key = pos_fetch.pos_cheque_cache_key(company_id, cheque_uuid)
            variant = pos_spec.variant

            if variant == "pay_debt":
                if not pos_fetch.is_pos_cheque_closed(cheque):
                    logger.info(
                        "Skipping POSChequePayDebt for open cheque %s; DocChequeClosed will notify",
                        cheque_uuid,
                    )
                    return
                if _recent_pos_cheque_receipt_sent(receipt_cache_key):
                    logger.info(
                        "Skipping duplicate POSChequePayDebt for cheque %s; receipt already sent",
                        cheque_uuid,
                    )
                    return
            elif variant == "closed" and _recent_pos_cheque_receipt_sent(receipt_cache_key):
                logger.info(
                    "Skipping duplicate DocChequeClosed for cheque %s; receipt already sent",
                    cheque_uuid,
                )
                return

            operations: list[dict[str, Any]] | None = None
            if variant in ("closed", "canceled"):
                operations = await pos_fetch.fetch_cheque_operations(
                    session, company_id, cheque_uuid
                )
                if not operations:
                    return
            elif variant == "pay_debt":
                operations = await pos_fetch.fetch_cheque_operations(
                    session, company_id, cheque_uuid
                )

            payments = await pos_fetch.fetch_cheque_payments(session, company_id, cheque_uuid)

            session_code = await pos_fetch.resolve_cheque_session_code(
                session, company_id, cheque
            )
            if session_code:
                cheque = {**cheque, "session_code": session_code}

            build_message = lambda lang, ch=cheque: fmt.format_pos_cheque_notification(
                ch,
                operations,
                payments,
                variant=variant,
                lang=lang,
            )
            leaf_type = resolve_pos_cheque_notification_type(variant, cheque)
            sent = await telegram_service.notify_company_subscribers(
                session,
                company_id,
                notification_type=leaf_type,
                build_message=build_message,
                parse_mode="HTML",
                scope=scope_from_cheque(cheque, operations),
            )

            if sent > 0 and variant == "closed":
                _mark_pos_cheque_receipt_sent(receipt_cache_key)

            if (
                variant == "closed"
                and operations
                and not bool(cheque.get("is_return"))
            ):
                await out_of_stock_service.check_and_record_out_of_stock_from_cheque(
                    session,
                    company_id,
                    cheque,
                    operations,
                )

        await _run_with_session(run)
    except Exception:
        logger.error(
            "Background POS cheque notification failed for company=%s cheque=%s event=%s",
            company_id,
            cheque_uuid,
            event_action,
            exc_info=True,
        )


async def process_pos_session(
    company_id: int,
    session_uuid: str,
    variant: str,
) -> None:
    try:
        async def run(session):
            cash_session = await pos_fetch.fetch_session_by_uuid(
                session,
                company_id,
                session_uuid,
            )
            if not cash_session:
                return

            report_data = None
            if variant == "closed":
                report_data = await session_report.build_session_report_data(
                    session,
                    company_id,
                    session_uuid,
                    cash_session,
                )

            totals = report_data.totals if report_data else None

            build_message = lambda lang: fmt.format_pos_session_notification(
                cash_session,
                variant=variant,
                lang=lang,
                totals=totals,
            )

            build_document = None
            if report_data is not None:
                def build_document(lang: str) -> tuple[bytes, str, str | None]:
                    return (
                        session_excel.generate_session_excel(report_data, lang=lang),
                        session_excel.session_report_filename(report_data.cash_session),
                        t("telegram.receipt.posSessionDownloadExcel", lang),
                    )

            leaf_type = resolve_pos_session_notification_type(variant)
            await telegram_service.notify_company_subscribers(
                session,
                company_id,
                notification_type=leaf_type,
                build_message=build_message,
                build_document=build_document,
                scope=scope_from_session(cash_session, variant=variant),
            )

        await _run_with_session(run)
    except Exception:
        logger.error(
            "Background POS session notification failed for company=%s session=%s variant=%s",
            company_id,
            session_uuid,
            variant,
            exc_info=True,
        )
