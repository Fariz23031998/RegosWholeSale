import pytest

from app.services.telegram_notifications import (
    ALL_LEAF_NOTIFICATION_TYPES,
    PAY_DEBT_NOTIFICATION_TYPE,
    expand_to_leaf_types,
    normalize_notification_types,
    resolve_document_notification_type,
    resolve_pos_cheque_notification_type,
    user_receives_notification,
    user_receives_pos_cheque_pay_debt,
    validate_notification_types,
)


def test_default_notification_types_are_leaves():
    assert len(ALL_LEAF_NOTIFICATION_TYPES) == 20
    assert "purchase_performed" in ALL_LEAF_NOTIFICATION_TYPES
    assert "pos_cheque_return" in ALL_LEAF_NOTIFICATION_TYPES


def test_expand_legacy_parent_types():
    expanded = expand_to_leaf_types(["pos_cheque", "payment"])
    assert "pos_cheque_closed" in expanded
    assert "pos_cheque_cancelled" in expanded
    assert "pos_cheque_return" in expanded
    assert "payment_performed" in expanded
    assert "payment_cancelled" in expanded


def test_normalize_empty_defaults_to_all_leaves():
    assert normalize_notification_types(None) == set(ALL_LEAF_NOTIFICATION_TYPES)
    assert normalize_notification_types([]) == set(ALL_LEAF_NOTIFICATION_TYPES)


def test_validate_rejects_legacy_parent_types():
    with pytest.raises(ValueError, match="Legacy parent"):
        validate_notification_types(["pos_cheque"])


def test_validate_accepts_leaf_types_only():
    validated = validate_notification_types(["wholesale_performed", "payment_cancelled"])
    assert validated == ["wholesale_performed", "payment_cancelled"]


def test_resolve_document_notification_type():
    assert resolve_document_notification_type("wholesale", is_cancelled=False) == "wholesale_performed"
    assert resolve_document_notification_type("wholesale", is_cancelled=True) == "wholesale_cancelled"


def test_resolve_pos_cheque_notification_type():
    assert resolve_pos_cheque_notification_type("closed", {"is_return": False}) == "pos_cheque_closed"
    assert resolve_pos_cheque_notification_type("closed", {"is_return": True}) == "pos_cheque_return"
    assert resolve_pos_cheque_notification_type("canceled", {}) == "pos_cheque_cancelled"
    assert resolve_pos_cheque_notification_type("pay_debt", {}) == PAY_DEBT_NOTIFICATION_TYPE


def test_user_receives_notification_with_legacy_parent():
    assert user_receives_notification(["pos_cheque"], "pos_cheque_return") is True
    assert user_receives_notification(["wholesale"], "wholesale_performed") is True


def test_user_receives_notification_with_granular_leaves():
    assert user_receives_notification(["pos_cheque_closed"], "pos_cheque_closed") is True
    assert user_receives_notification(["pos_cheque_closed"], "pos_cheque_cancelled") is False


def test_user_receives_pos_cheque_pay_debt():
    assert user_receives_pos_cheque_pay_debt(["pos_cheque"]) is True
    assert user_receives_pos_cheque_pay_debt(["pos_cheque_cancelled"]) is True
    assert user_receives_pos_cheque_pay_debt(["wholesale_performed"]) is False
    assert user_receives_notification(["pos_cheque_cancelled"], PAY_DEBT_NOTIFICATION_TYPE) is True
    assert user_receives_notification(["pos_cheque_closed"], PAY_DEBT_NOTIFICATION_TYPE) is True
