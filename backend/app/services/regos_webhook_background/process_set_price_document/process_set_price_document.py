import logging
from app.services import events_log as events_log_service
from app.services import regos_document_fetch as doc_fetch
from app.services import catalog_events as catalog_events_service

logger = logging.getLogger("regos.backend")

async def process_set_price_document(
    company_id: int,
    document_id: int,
    event_action: str,
) -> None:
    from app.services.regos_webhook_background import _run_with_session

    try:
        async def run(session):
            operations = await doc_fetch.fetch_operations(
                session,
                company_id,
                doc_fetch.SET_PRICE_SPEC.ops_endpoint,
                document_id,
            )
            if not operations:
                return

            item_ids = doc_fetch.item_ids_from_operations(operations)
            if not item_ids:
                return

            # Price changes are global, so we publish with stock_id=None
            catalog_events_service.publish_products_updated(
                company_id,
                regos_item_ids=item_ids,
                source_action=event_action,
                stock_id=None,
            )

            # Record in change log for incremental sync
            await events_log_service.record_product_changes(
                session, company_id, "product_updated", item_ids, event_action,
            )

        await _run_with_session(run)
    except Exception:
        logger.error(
            "Background set-price catalog update failed for company=%s document=%s event=%s",
            company_id,
            document_id,
            event_action,
            exc_info=True,
        )
