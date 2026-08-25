from app.models.telegram_user import TelegramUser
from app.services.telegram import select_notification_recipients
from app.services.telegram_notification_scope import (
    NotificationScope,
    attached_user_id_from_document,
    cashier_ids_from_cheque,
    cashier_ids_from_session,
    firm_id_from_document,
    normalize_scope_ids,
    scope_from_cheque,
    scope_from_document,
    scope_from_payment_document,
    scope_from_stock,
    stock_ids_from_cheque_operations,
    stock_ids_from_document,
    subscriber_matches_scope,
)


def test_normalize_scope_ids_deduplicates_and_filters():
    assert normalize_scope_ids([3, 1, 3, 0, -1, 2]) == [3, 1, 2]


def test_stock_ids_from_document_includes_movement_stocks():
    document = {
        "stock_sender": {"id": 10},
        "stock_receiver": {"id": 20},
    }
    assert stock_ids_from_document(document) == frozenset({10, 20})


def test_attached_user_id_from_document_prefers_attached_user():
    document = {"attached_user": {"id": 7, "full_name": "Cashier One"}}
    assert attached_user_id_from_document(document) == 7


def test_scope_from_document_builds_stock_and_cashier_sets():
    scope = scope_from_document(
        {
            "stock_id": 11,
            "attached_user": {"id": 5, "full_name": "Alice"},
        }
    )
    assert scope.stock_ids == frozenset({11})
    assert scope.cashier_ids == frozenset({5})


def test_cashier_ids_from_cheque_uses_cashier_and_seller():
    scope = scope_from_cheque(
        {
            "cashier": {"id": 3, "full_name": "John"},
            "seller": {"id": 4, "full_name": "Jane"},
        },
        [{"stock_id": 10}],
    )
    assert scope.cashier_ids == frozenset({3, 4})
    assert scope.stock_ids == frozenset({10})


def test_stock_ids_from_cheque_operations():
    assert stock_ids_from_cheque_operations(
        [{"stock_id": 10}, {"stock_id": 11}, {"stock_id": 10}]
    ) == frozenset({10, 11})


def test_cashier_ids_from_session_opened_uses_start_user():
    assert cashier_ids_from_session(
        {"start_user": {"id": 8, "full_name": "Opener"}},
        variant="opened",
    ) == frozenset({8})


def test_cashier_ids_from_session_closed_uses_start_and_close_users():
    assert cashier_ids_from_session(
        {
            "start_user": {"id": 8, "full_name": "Opener"},
            "close_user": {"id": 9, "full_name": "Closer"},
        },
        variant="closed",
    ) == frozenset({8, 9})


def test_subscriber_matches_scope_when_unconfigured():
    subscriber = TelegramUser(
        company_id=1,
        telegram_user_id=1,
        chat_id=1,
        stock_ids=None,
        cashier_ids=None,
    )
    assert subscriber_matches_scope(subscriber, scope_from_stock(10)) is True


def test_subscriber_matches_scope_stock_filter():
    subscriber = TelegramUser(
        company_id=1,
        telegram_user_id=1,
        chat_id=1,
        stock_ids=[10, 11],
        cashier_ids=None,
    )
    assert subscriber_matches_scope(subscriber, NotificationScope(stock_ids=frozenset({10}))) is True
    assert subscriber_matches_scope(subscriber, NotificationScope(stock_ids=frozenset({99}))) is False


def test_subscriber_matches_scope_cashier_filter():
    subscriber = TelegramUser(
        company_id=1,
        telegram_user_id=1,
        chat_id=1,
        stock_ids=None,
        cashier_ids=[5],
    )
    assert subscriber_matches_scope(subscriber, NotificationScope(cashier_ids=frozenset({5}))) is True
    assert subscriber_matches_scope(subscriber, NotificationScope(cashier_ids=frozenset({6}))) is False


def test_subscriber_matches_scope_skips_missing_event_dimension():
    subscriber = TelegramUser(
        company_id=1,
        telegram_user_id=1,
        chat_id=1,
        stock_ids=[10],
        cashier_ids=[5],
    )
    assert subscriber_matches_scope(subscriber, NotificationScope(stock_ids=frozenset({10}))) is True
    assert subscriber_matches_scope(subscriber, scope_from_stock(10)) is True


def test_subscriber_with_cashier_filter_rejects_event_without_cashier():
    subscriber = TelegramUser(
        company_id=1,
        telegram_user_id=1,
        chat_id=1,
        cashier_ids=[5],
    )
    assert subscriber_matches_scope(subscriber, NotificationScope(cashier_ids=None)) is True
    assert subscriber_matches_scope(subscriber, NotificationScope(cashier_ids=frozenset())) is False


def test_firm_id_from_document_prefers_firm_object():
    assert firm_id_from_document({"firm": {"id": 4, "name": "REGOS"}}) == 4
    assert firm_id_from_document({"firm_id": 5}) == 5


def test_scope_from_payment_document_builds_firm_and_cashier_sets():
    scope = scope_from_payment_document(
        {
            "firm": {"id": 4, "name": "REGOS"},
            "attached_user": {"id": 5, "full_name": "Alice"},
        }
    )
    assert scope.firm_ids == frozenset({4})
    assert scope.cashier_ids == frozenset({5})
    assert scope.stock_ids is None


def test_subscriber_matches_scope_firm_filter():
    subscriber = TelegramUser(
        company_id=1,
        telegram_user_id=1,
        chat_id=1,
        firm_ids=[4, 5],
    )
    assert subscriber_matches_scope(subscriber, NotificationScope(firm_ids=frozenset({4}))) is True
    assert subscriber_matches_scope(subscriber, NotificationScope(firm_ids=frozenset({99}))) is False


def test_subscriber_with_firm_filter_ignores_non_payment_scope():
    subscriber = TelegramUser(
        company_id=1,
        telegram_user_id=1,
        chat_id=1,
        firm_ids=[4],
    )
    assert subscriber_matches_scope(subscriber, scope_from_stock(10)) is True


def test_select_notification_recipients_applies_scope():
    matching = TelegramUser(
        company_id=1,
        telegram_user_id=1,
        chat_id=1,
        chat_type="private",
        is_active=True,
        notification_types=["out_of_stock"],
        stock_ids=[10],
    )
    other = TelegramUser(
        company_id=1,
        telegram_user_id=2,
        chat_id=2,
        chat_type="private",
        is_active=True,
        notification_types=["out_of_stock"],
        stock_ids=[20],
    )

    recipients = select_notification_recipients(
        [matching, other],
        "out_of_stock",
        scope=scope_from_stock(10),
    )

    assert [recipient.chat_id for recipient in recipients] == [1]
