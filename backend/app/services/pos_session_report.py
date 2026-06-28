from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import regos_pos_fetch as pos_fetch
from app.services.document_telegram_format import (
    _payment_type_name,
    _visible_pos_cheque_operations,
)

@dataclass
class PaymentTypeTotals:
    sales: float = 0.0
    refunds: float = 0.0

    @property
    def net(self) -> float:
        return self.sales - self.refunds


@dataclass
class SessionTotals:
    sales_amount: float = 0.0
    sales_payments: float = 0.0
    refund_amount: float = 0.0
    refund_payments: float = 0.0
    by_payment_type: dict[str, PaymentTypeTotals] = field(default_factory=dict)

    @property
    def net_sales(self) -> float:
        return self.sales_amount - self.refund_amount

    @property
    def net_payments(self) -> float:
        return self.sales_payments - self.refund_payments


@dataclass
class SessionReportData:
    cash_session: dict[str, Any]
    cheques: list[dict[str, Any]]
    operations_by_cheque: dict[str, list[dict[str, Any]]]
    payments_by_cheque: dict[str, list[dict[str, Any]]]
    totals: SessionTotals


def _cheque_uuid(cheque: dict[str, Any]) -> str:
    return str(cheque.get("uuid", "")).strip().lower()


def _is_return_cheque(cheque: dict[str, Any]) -> bool:
    return bool(cheque.get("is_return"))


def _operation_amount(operation: dict[str, Any]) -> float:
    quantity = float(operation.get("quantity", 0))
    price = float(operation.get("price", 0))
    return quantity * price


def compute_session_totals(
    cheques: list[dict[str, Any]],
    operations_by_cheque: dict[str, list[dict[str, Any]]],
    payments_by_cheque: dict[str, list[dict[str, Any]]],
    *,
    lang: str = "ru",
) -> SessionTotals:
    totals = SessionTotals()

    for cheque in cheques:
        cheque_uuid = _cheque_uuid(cheque)
        if not cheque_uuid:
            continue

        is_return = _is_return_cheque(cheque)
        operations = _visible_pos_cheque_operations(operations_by_cheque.get(cheque_uuid, []))
        cheque_amount = 0.0
        for operation in operations:
            if bool(operation.get("has_storno")):
                continue
            line_amount = _operation_amount(operation)
            cheque_amount += line_amount

        if is_return:
            totals.refund_amount += cheque_amount
        else:
            totals.sales_amount += cheque_amount

        for payment in payments_by_cheque.get(cheque_uuid, []):
            if bool(payment.get("has_storno")):
                continue
            value = float(payment.get("value", 0))
            if value < 0:
                continue

            type_name = _payment_type_name(payment, lang)
            type_totals = totals.by_payment_type.setdefault(type_name, PaymentTypeTotals())
            if is_return:
                totals.refund_payments += value
                type_totals.refunds += value
            else:
                totals.sales_payments += value
                type_totals.sales += value

    return totals


async def build_session_report_data(
    session: AsyncSession,
    company_id: int,
    session_uuid: str,
    cash_session: dict[str, Any],
    *,
    lang: str = "ru",
) -> SessionReportData:
    cheques = await pos_fetch.fetch_session_cheques(session, company_id, session_uuid)
    cheque_uuids = [_cheque_uuid(cheque) for cheque in cheques]
    cheque_uuids = [cheque_uuid for cheque_uuid in cheque_uuids if cheque_uuid]

    operations_by_cheque, payments_by_cheque = await pos_fetch.fetch_session_cheque_details(
        session,
        company_id,
        cheque_uuids,
    )
    totals = compute_session_totals(
        cheques,
        operations_by_cheque,
        payments_by_cheque,
        lang=lang,
    )
    return SessionReportData(
        cash_session=cash_session,
        cheques=cheques,
        operations_by_cheque=operations_by_cheque,
        payments_by_cheque=payments_by_cheque,
        totals=totals,
    )
