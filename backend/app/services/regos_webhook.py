import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from fastapi import BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RegosToken
from app.services import regos_document_fetch as doc_fetch
from app.services import regos_webhook_background as webhook_background

logger = logging.getLogger("regos.backend")

processed_webhook_events: dict[str, datetime] = {}
notified_pos_cheque_receipts: dict[str, datetime] = {}
POS_CHEQUE_RECEIPT_DEDUP_WINDOW = timedelta(minutes=5)


@dataclass(frozen=True)
class EventSpec:
    spec: doc_fetch.OperationDocumentSpec | None
    is_cancelled: bool
    is_payment: bool = False
    notification_type: str = ""


@dataclass(frozen=True)
class PosEventSpec:
    kind: str
    variant: str
    notification_type: str


POS_EVENT_SPECS: dict[str, PosEventSpec] = {
    "DocChequeClosed": PosEventSpec("cheque", "closed", "pos_cheque"),
    "DocChequeCanceled": PosEventSpec("cheque", "canceled", "pos_cheque"),
    "POSChequePayDebt": PosEventSpec("cheque", "pay_debt", "pos_cheque"),
    "DocSessionOpened": PosEventSpec("session", "opened", "pos_session"),
    "DocSessionClosed": PosEventSpec("session", "closed", "pos_session"),
}


EVENT_SPECS: dict[str, EventSpec] = {
    "DocPurchasePerformed": EventSpec(
        doc_fetch.PURCHASE_SPEC, is_cancelled=False, notification_type="purchase"
    ),
    "DocPurchasePerformCanceled": EventSpec(
        doc_fetch.PURCHASE_SPEC, is_cancelled=True, notification_type="purchase"
    ),
    "DocReturnsToPartnerPerformed": EventSpec(
        doc_fetch.RETURN_TO_PARTNER_SPEC, is_cancelled=False, notification_type="return_purchase"
    ),
    "DocReturnsToPartnerPerformCanceled": EventSpec(
        doc_fetch.RETURN_TO_PARTNER_SPEC,
        is_cancelled=True,
        notification_type="return_purchase",
    ),
    "DocWholeSalePerformed": EventSpec(
        doc_fetch.WHOLESALE_SPEC, is_cancelled=False, notification_type="wholesale"
    ),
    "DocWholeSalePerformCanceled": EventSpec(
        doc_fetch.WHOLESALE_SPEC, is_cancelled=True, notification_type="wholesale"
    ),
    "DocWholeSaleReturnPerformed": EventSpec(
        doc_fetch.WHOLESALE_RETURN_SPEC, is_cancelled=False, notification_type="wholesale_return"
    ),
    "DocWholeSaleReturnPerformCanceled": EventSpec(
        doc_fetch.WHOLESALE_RETURN_SPEC,
        is_cancelled=True,
        notification_type="wholesale_return",
    ),
    "DocPaymentPerformed": EventSpec(
        None, is_cancelled=False, is_payment=True, notification_type="payment"
    ),
    "DocPaymentPerformCanceled": EventSpec(
        None, is_cancelled=True, is_payment=True, notification_type="payment"
    ),
    "DocInOutPerformed": EventSpec(
        doc_fetch.INOUT_SPEC, is_cancelled=False, notification_type="inout"
    ),
    "DocInOutPerformCanceled": EventSpec(
        doc_fetch.INOUT_SPEC, is_cancelled=True, notification_type="inout"
    ),
    "DocMovementPerformed": EventSpec(
        doc_fetch.MOVEMENT_SPEC, is_cancelled=False, notification_type="movement"
    ),
    "DocMovementPerformCanceled": EventSpec(
        doc_fetch.MOVEMENT_SPEC, is_cancelled=True, notification_type="movement"
    ),
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


def _cleanup_notified_pos_cheque_receipts() -> None:
    current_time = datetime.utcnow()
    expired = [
        cache_key
        for cache_key, timestamp in notified_pos_cheque_receipts.items()
        if current_time - timestamp > POS_CHEQUE_RECEIPT_DEDUP_WINDOW
    ]
    for cache_key in expired:
        del notified_pos_cheque_receipts[cache_key]


def _recent_pos_cheque_receipt_sent(cache_key: str) -> bool:
    _cleanup_notified_pos_cheque_receipts()
    return cache_key in notified_pos_cheque_receipts


def _mark_pos_cheque_receipt_sent(cache_key: str) -> None:
    notified_pos_cheque_receipts[cache_key] = datetime.utcnow()


def _schedule_operation_document(
    background_tasks: BackgroundTasks | None,
    company_id: int,
    document_id: int,
    event_action: str,
) -> None:
    if background_tasks is None:
        logger.warning(
            "Cannot schedule operation document notification: background_tasks is None"
        )
        return
    background_tasks.add_task(
        webhook_background.process_operation_document,
        company_id,
        document_id,
        event_action,
    )


def _schedule_payment_document(
    background_tasks: BackgroundTasks | None,
    company_id: int,
    document_id: int,
    event_action: str,
) -> None:
    if background_tasks is None:
        logger.warning(
            "Cannot schedule payment document notification: background_tasks is None"
        )
        return
    background_tasks.add_task(
        webhook_background.process_payment_document,
        company_id,
        document_id,
        event_action,
    )


def _schedule_pos_cheque(
    background_tasks: BackgroundTasks | None,
    company_id: int,
    cheque_uuid: str,
    event_action: str,
) -> None:
    if background_tasks is None:
        logger.warning("Cannot schedule POS cheque notification: background_tasks is None")
        return
    background_tasks.add_task(
        webhook_background.process_pos_cheque,
        company_id,
        cheque_uuid,
        event_action,
    )


def _schedule_pos_session(
    background_tasks: BackgroundTasks | None,
    company_id: int,
    session_uuid: str,
    variant: str,
) -> None:
    if background_tasks is None:
        logger.warning("Cannot schedule POS session notification: background_tasks is None")
        return
    background_tasks.add_task(
        webhook_background.process_pos_session,
        company_id,
        session_uuid,
        variant,
    )


async def handle_regos_webhook(
    session: AsyncSession,
    webhook_data: dict[str, Any],
    *,
    background_tasks: BackgroundTasks | None = None,
) -> dict[str, Any]:
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
    resource_uuid = event_data.get("uuid") or (
        str(document_id) if document_id is not None else None
    )

    logger.info(
        "REGOS webhook company=%s event=%s document_id=%s uuid=%s",
        company_id,
        event_action,
        document_id,
        resource_uuid,
    )

    pos_spec = POS_EVENT_SPECS.get(event_action)
    if pos_spec:
        if not resource_uuid:
            logger.warning("%s event missing uuid", event_action)
            return {"ok": True, "message": "Missing uuid", "company_id": company_id}

        if pos_spec.kind == "cheque":
            _schedule_pos_cheque(
                background_tasks,
                company_id,
                str(resource_uuid),
                event_action,
            )
        else:
            _schedule_pos_session(
                background_tasks,
                company_id,
                str(resource_uuid),
                pos_spec.variant,
            )

        return {"ok": True, "message": "Webhook processed", "company_id": company_id}

    event_spec = EVENT_SPECS.get(event_action)
    if not event_spec:
        return {"ok": True, "message": "Event ignored", "company_id": company_id}

    if not document_id:
        logger.warning("%s event missing document ID", event_action)
        return {"ok": True, "message": "Missing document id", "company_id": company_id}

    if event_spec.is_payment:
        _schedule_payment_document(
            background_tasks,
            company_id,
            int(document_id),
            event_action,
        )
    else:
        _schedule_operation_document(
            background_tasks,
            company_id,
            int(document_id),
            event_action,
        )

    return {"ok": True, "message": "Webhook processed", "company_id": company_id}
