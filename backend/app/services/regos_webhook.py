import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RegosToken
from app.services import document_telegram_format as fmt
from app.services import pos_session_excel as session_excel
from app.services import pos_session_report as session_report
from app.services import regos_document_fetch as doc_fetch
from app.services import regos_out_of_stock as out_of_stock_service
from app.services import regos_pos_fetch as pos_fetch
from app.services import telegram as telegram_service
from app.services.telegram_notifications import (
    resolve_document_notification_type,
    resolve_pos_cheque_notification_type,
    resolve_pos_session_notification_type,
)

logger = logging.getLogger("regos.backend")

processed_webhook_events: dict[str, datetime] = {}


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


async def _process_operation_document(
    session: AsyncSession,
    company_id: int,
    document_id: int,
    event_spec: EventSpec,
    *,
    event_action: str,
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
    sent = await telegram_service.notify_company_subscribers(
        session,
        company_id,
        notification_type=leaf_type,
        build_message=build_message,
    )

    await out_of_stock_service.check_and_record_out_of_stock(
        session,
        company_id,
        event_action,
        document,
        operations,
    )

    return sent > 0


async def _process_payment_document(
    session: AsyncSession,
    company_id: int,
    document_id: int,
    *,
    is_cancelled: bool,
    notification_type: str,
) -> bool:
    document = await doc_fetch.fetch_document(
        session, company_id, doc_fetch.PAYMENT_DOC_ENDPOINT, document_id
    )
    if not document:
        return False

    warehouse_name = await _resolve_warehouse_name(session, company_id, document)
    build_message = lambda lang: fmt.format_payment_notification(
        document,
        warehouse_name,
        is_cancelled=is_cancelled,
        lang=lang,
    )
    leaf_type = resolve_document_notification_type(
        notification_type,
        is_cancelled=is_cancelled,
    )
    sent = await telegram_service.notify_company_subscribers(
        session,
        company_id,
        notification_type=leaf_type,
        build_message=build_message,
    )
    return sent > 0


async def _process_pos_cheque(
    session: AsyncSession,
    company_id: int,
    cheque_uuid: str,
    pos_spec: PosEventSpec,
) -> bool:
    cheque = await pos_fetch.fetch_cheque_by_uuid(session, company_id, cheque_uuid)
    if not cheque:
        return False

    operations: list[dict[str, Any]] | None = None
    if pos_spec.variant in ("closed", "canceled"):
        operations = await pos_fetch.fetch_cheque_operations(session, company_id, cheque_uuid)
        if not operations:
            return False
    elif pos_spec.variant == "pay_debt":
        operations = await pos_fetch.fetch_cheque_operations(session, company_id, cheque_uuid)

    payments = await pos_fetch.fetch_cheque_payments(session, company_id, cheque_uuid)

    session_code = await pos_fetch.resolve_cheque_session_code(session, company_id, cheque)
    if session_code:
        cheque = {**cheque, "session_code": session_code}

    build_message = lambda lang, ch=cheque: fmt.format_pos_cheque_notification(
        ch,
        operations,
        payments,
        variant=pos_spec.variant,
        lang=lang,
    )
    leaf_type = resolve_pos_cheque_notification_type(pos_spec.variant, cheque)
    sent = await telegram_service.notify_company_subscribers(
        session,
        company_id,
        notification_type=leaf_type,
        build_message=build_message,
        parse_mode="HTML",
    )

    if pos_spec.variant == "closed" and operations:
        await out_of_stock_service.check_and_record_out_of_stock_from_cheque(
            session,
            company_id,
            cheque,
            operations,
        )

    return sent > 0


async def _process_pos_session(
    session: AsyncSession,
    company_id: int,
    session_uuid: str,
    pos_spec: PosEventSpec,
) -> bool:
    cash_session = await pos_fetch.fetch_session_by_uuid(session, company_id, session_uuid)
    if not cash_session:
        return False

    report_data = None
    if pos_spec.variant == "closed":
        report_data = await session_report.build_session_report_data(
            session,
            company_id,
            session_uuid,
            cash_session,
        )

    totals = report_data.totals if report_data else None

    build_message = lambda lang: fmt.format_pos_session_notification(
        cash_session,
        variant=pos_spec.variant,
        lang=lang,
        totals=totals,
    )

    build_document = None
    if report_data is not None:
        def build_document(lang: str) -> tuple[bytes, str, str | None]:
            from app.services.telegram_i18n import t

            return (
                session_excel.generate_session_excel(report_data, lang=lang),
                session_excel.session_report_filename(report_data.cash_session),
                t("telegram.receipt.posSessionDownloadExcel", lang),
            )

    leaf_type = resolve_pos_session_notification_type(pos_spec.variant)
    sent = await telegram_service.notify_company_subscribers(
        session,
        company_id,
        notification_type=leaf_type,
        build_message=build_message,
        build_document=build_document,
    )
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
            await _process_pos_cheque(session, company_id, str(resource_uuid), pos_spec)
        else:
            await _process_pos_session(session, company_id, str(resource_uuid), pos_spec)

        return {"ok": True, "message": "Webhook processed", "company_id": company_id}

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
            notification_type=event_spec.notification_type,
        )
    else:
        await _process_operation_document(
            session,
            company_id,
            int(document_id),
            event_spec,
            event_action=event_action,
        )

    return {"ok": True, "message": "Webhook processed", "company_id": company_id}
