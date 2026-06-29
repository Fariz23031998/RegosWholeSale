from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.models.telegram_user import TelegramUser
from app.services import regos_document_fetch as doc_fetch


def _positive_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _user_id_from_object(user: Any) -> int | None:
    if not isinstance(user, dict):
        return None
    return _positive_int(user.get("id"))


def attached_user_id_from_document(document: dict[str, Any]) -> int | None:
    attached_user = document.get("attached_user")
    if not isinstance(attached_user, dict):
        attached_user = document.get("user")
    return _user_id_from_object(attached_user)


def stock_ids_from_document(document: dict[str, Any]) -> frozenset[int] | None:
    stock_ids: set[int] = set()
    for resolver in (
        doc_fetch.stock_id_from_document,
        doc_fetch.stock_sender_id_from_document,
        doc_fetch.stock_receiver_id_from_document,
    ):
        stock_id = resolver(document)
        if stock_id is not None:
            stock_ids.add(stock_id)
    if not stock_ids:
        return None
    return frozenset(stock_ids)


def cashier_ids_from_cheque(cheque: dict[str, Any]) -> frozenset[int] | None:
    cashier_ids: set[int] = set()
    for key in ("cashier", "seller"):
        user_id = _user_id_from_object(cheque.get(key))
        if user_id is not None:
            cashier_ids.add(user_id)
    if not cashier_ids:
        return None
    return frozenset(cashier_ids)


def stock_ids_from_cheque_operations(operations: list[dict[str, Any]] | None) -> frozenset[int] | None:
    if not operations:
        return None
    stock_ids: set[int] = set()
    for operation in operations:
        if not isinstance(operation, dict):
            continue
        stock_id = _positive_int(operation.get("stock_id"))
        if stock_id is not None:
            stock_ids.add(stock_id)
    if not stock_ids:
        return None
    return frozenset(stock_ids)


def cashier_ids_from_session(
    cash_session: dict[str, Any],
    *,
    variant: str,
) -> frozenset[int] | None:
    cashier_ids: set[int] = set()
    if variant == "opened":
        user_id = _user_id_from_object(cash_session.get("start_user"))
        if user_id is not None:
            cashier_ids.add(user_id)
    elif variant == "closed":
        for key in ("start_user", "close_user"):
            user_id = _user_id_from_object(cash_session.get(key))
            if user_id is not None:
                cashier_ids.add(user_id)
    if not cashier_ids:
        return None
    return frozenset(cashier_ids)


def scope_from_document(document: dict[str, Any]) -> NotificationScope:
    stock_ids = stock_ids_from_document(document)
    cashier_id = attached_user_id_from_document(document)
    cashier_ids = frozenset({cashier_id}) if cashier_id is not None else None
    return NotificationScope(stock_ids=stock_ids, cashier_ids=cashier_ids)


def scope_from_cheque(
    cheque: dict[str, Any],
    operations: list[dict[str, Any]] | None,
) -> NotificationScope:
    stock_ids = stock_ids_from_cheque_operations(operations)
    cashier_ids = cashier_ids_from_cheque(cheque)
    return NotificationScope(stock_ids=stock_ids, cashier_ids=cashier_ids)


def scope_from_session(cash_session: dict[str, Any], *, variant: str) -> NotificationScope:
    return NotificationScope(cashier_ids=cashier_ids_from_session(cash_session, variant=variant))


def scope_from_stock(stock_id: int) -> NotificationScope:
    return NotificationScope(stock_ids=frozenset({stock_id}))


def normalize_scope_ids(value: list[int] | None) -> list[int]:
    if not value:
        return []
    seen: set[int] = set()
    normalized: list[int] = []
    for item in value:
        parsed = _positive_int(item)
        if parsed is None or parsed in seen:
            continue
        seen.add(parsed)
        normalized.append(parsed)
    return normalized


@dataclass(frozen=True)
class NotificationScope:
    stock_ids: frozenset[int] | None = None
    cashier_ids: frozenset[int] | None = None


def subscriber_configured_stock_ids(subscriber: TelegramUser) -> list[int]:
    return normalize_scope_ids(subscriber.stock_ids)


def subscriber_configured_cashier_ids(subscriber: TelegramUser) -> list[int]:
    return normalize_scope_ids(subscriber.cashier_ids)


def subscriber_matches_scope(subscriber: TelegramUser, scope: NotificationScope | None) -> bool:
    if scope is None:
        return True

    configured_stocks = subscriber_configured_stock_ids(subscriber)
    if configured_stocks and scope.stock_ids is not None:
        if not (set(configured_stocks) & scope.stock_ids):
            return False

    configured_cashiers = subscriber_configured_cashier_ids(subscriber)
    if configured_cashiers and scope.cashier_ids is not None:
        if not (set(configured_cashiers) & scope.cashier_ids):
            return False

    return True
