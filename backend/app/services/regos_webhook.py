import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RegosToken
from app.services import document_telegram_format as fmt
from app.services import regos_document_fetch as doc_fetch
from app.services import telegram as telegram_service

logger = logging.getLogger("regos.backend")

processed_webhook_events: dict[str, datetime] = {}


@dataclass(frozen=True)
class EventSpec:
    spec: doc_fetch.OperationDocumentSpec | None
    is_cancelled: bool
    is_payment: bool = False


EVENT_SPECS: dict[str, EventSpec] = {
    "DocPurchasePerformed": EventSpec(doc_fetch.PURCHASE_SPEC, is_cancelled=False),
    "DocPurchasePerformCanceled": EventSpec(doc_fetch.PURCHASE_SPEC, is_cancelled=True),
    "DocReturnsToPartnerPerformed": EventSpec(doc_fetch.RETURN_TO_PARTNER_SPEC, is_cancelled=False),
    "DocReturnsToPartnerPerformCanceled": EventSpec(
        doc_fetch.RETURN_TO_PARTNER_SPEC, is_cancelled=True
    ),
    "DocWholeSalePerformed": EventSpec(doc_fetch.WHOLESALE_SPEC, is_cancelled=False),
    "DocWholeSalePerformCanceled": EventSpec(doc_fetch.WHOLESALE_SPEC, is_cancelled=True),
    "DocWholeSaleReturnPerformed": EventSpec(doc_fetch.WHOLESALE_RETURN_SPEC, is_cancelled=False),
    "DocWholeSaleReturnPerformCanceled": EventSpec(
        doc_fetch.WHOLESALE_RETURN_SPEC, is_cancelled=True
    ),
    "DocPaymentPerformed": EventSpec(None, is_cancelled=False, is_payment=True),
    "DocPaymentPerformCanceled": EventSpec(None, is_cancelled=True, is_payment=True),
    "DocInOutPerformed": EventSpec(doc_fetch.INOUT_SPEC, is_cancelled=False),
    "DocInOutPerformCanceled": EventSpec(doc_fetch.INOUT_SPEC, is_cancelled=True),
    "DocMovementPerformed": EventSpec(doc_fetch.MOVEMENT_SPEC, is_cancelled=False),
    "DocMovementPerformCanceled": EventSpec(doc_fetch.MOVEMENT_SPEC, is_cancelled=True),
}


async def _resolve_company_id(session: AsyncSession, integration_token: str) -> int | None:
    result = await session.execute(
        select(RegosToken.company_id).where(
            RegosToken.integration_token == integration_token
        )
    )
    return result.scalar_one_or_none()


def _cleanup_processed_events() -> None:
    current_time = datetime.utcnow()
    expired = [
        event_id
        for event_id, timestamp in processed_webhook_events.items()
        if current_time - timestamp > timedelta(hours=1)
    ]
    for event_id in expired:
        del processed_webhook_events[event_id]


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
    return fetched or "Склад"


async def _process_operation_document(
    session: AsyncSession,
    company_id: int,
    document_id: int,
    event_spec: EventSpec,
) -> bool:
    assert event_spec.spec is not None
    spec = event_spec.spec

    document = await doc_fetch.fetch_document(
        session, company_id, spec.doc_endpoint, document_id
    )
    if not document:
        return False

    operations = await doc_fetch.fetch_operations(
        session, company_id, spec.ops_endpoint, document_id
    )
    if not operations:
        return False

    if spec.kind == "movement":
        message = fmt.format_movement_receipt(
            document,
            operations,
            is_cancelled=event_spec.is_cancelled,
        )
    elif spec.kind == "inout":
        warehouse_name = await _resolve_warehouse_name(session, company_id, document)
        message = fmt.format_inout_receipt(
            document,
            operations,
            warehouse_name,
            is_cancelled=event_spec.is_cancelled,
        )
    else:
        warehouse_name = await _resolve_warehouse_name(session, company_id, document)
        message = fmt.format_partner_receipt(
            document,
            operations,
            warehouse_name,
            is_cancelled=event_spec.is_cancelled,
            is_return=spec.is_return,
            use_cost=spec.use_cost,
        )

    sent = await telegram_service.notify_company_subscribers(session, company_id, message)
    return sent > 0


async def _process_payment_document(
    session: AsyncSession,
    company_id: int,
    document_id: int,
    *,
    is_cancelled: bool,
) -> bool:
    document = await doc_fetch.fetch_document(
        session, company_id, doc_fetch.PAYMENT_DOC_ENDPOINT, document_id
    )
    if not document:
        return False

    warehouse_name = await _resolve_warehouse_name(session, company_id, document)
    message = fmt.format_payment_notification(
        document,
        warehouse_name,
        is_cancelled=is_cancelled,
    )
    sent = await telegram_service.notify_company_subscribers(session, company_id, message)
    return sent > 0


async def handle_regos_webhook(session: AsyncSession, webhook_data: dict[str, Any]) -> dict[str, Any]:
    event_id = webhook_data.get("event_id")
    if event_id:
        _cleanup_processed_events()
        if event_id in processed_webhook_events:
            logger.warning("Duplicate REGOS webhook event %s, skipping", event_id)
            return {"ok": True, "message": "Event already processed", "duplicate": True}
        processed_webhook_events[event_id] = datetime.utcnow()

    connected_integration_id = webhook_data.get("connected_integration_id")
    if not connected_integration_id:
        logger.warning("REGOS webhook missing connected_integration_id")
        return {"ok": False, "error": "Missing connected_integration_id"}

    company_id = await _resolve_company_id(session, connected_integration_id)
    if company_id is None:
        logger.warning(
            "REGOS webhook: no company for integration_id %s...",
            str(connected_integration_id)[:20],
        )
        return {"ok": False, "error": "No matching company for this integration_id"}

    event_action = webhook_data.get("data", {}).get("action", "unknown")
    event_data = webhook_data.get("data", {}).get("data", {})
    document_id = event_data.get("id")

    logger.info(
        "REGOS webhook company=%s event=%s document_id=%s",
        company_id,
        event_action,
        document_id,
    )

    event_spec = EVENT_SPECS.get(event_action)
    if not event_spec:
        return {"ok": True, "message": "Event ignored", "company_id": company_id}

    if not document_id:
        logger.warning("%s event missing document ID", event_action)
        return {"ok": True, "message": "Missing document id", "company_id": company_id}

    if event_spec.is_payment:
        await _process_payment_document(
            session,
            company_id,
            int(document_id),
            is_cancelled=event_spec.is_cancelled,
        )
    else:
        await _process_operation_document(
            session,
            company_id,
            int(document_id),
            event_spec,
        )

    return {"ok": True, "message": "Webhook processed", "company_id": company_id}
