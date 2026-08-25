import logging
from typing import Any
from app.services import catalog_events as catalog_events_service
from app.services import document_telegram_format as fmt
from app.services import regos_document_fetch as doc_fetch
from app.services import regos_out_of_stock as out_of_stock_service
from app.services import telegram as telegram_service
from app.services.telegram_notification_scope import scope_from_document
from app.services.telegram_notifications import resolve_document_notification_type

logger = logging.getLogger("regos.backend")

async def process_operation_document(
    company_id: int,
    document_id: int,
    event_action: str,
) -> None:
    from app.services.regos_webhook import EVENT_SPECS
    from app.services.regos_webhook_background import (
        _run_with_session,
        _resolve_warehouse_name,
        _publish_catalog_stock_updates,
    )

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

            await _publish_catalog_stock_updates(
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
