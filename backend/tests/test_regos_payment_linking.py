import pytest

from app.core.exceptions import AppError
from app.services.regos_payment_linking import (
    append_payment_ids_to_description,
    get_payment_linking_mode,
    parse_payment_ids_from_description,
    validate_payment_linking_mode,
)


@pytest.mark.parametrize(
    ("description", "expected"),
    [
        ("pulse:pay:3001", [3001]),
        ("pulse:pay:3001,3002", [3001, 3002]),
        ("POS John|pulse:pay:3001,3002", [3001, 3002]),
        ("pulse:ws:1001|Damaged goods|pulse:pay:4001", [4001]),
        ("No payment ids here", []),
        (None, []),
    ],
)
def test_parse_payment_ids_from_description(description: str | None, expected: list[int]) -> None:
    assert parse_payment_ids_from_description(description) == expected


@pytest.mark.parametrize(
    ("description", "payment_ids", "expected"),
    [
        ("POS John", [3001], "POS John|pulse:pay:3001"),
        ("pulse:ws:1001|Damaged goods", [4001], "pulse:ws:1001|Damaged goods|pulse:pay:4001"),
        ("pulse:ws:1001|pulse:pay:3001", [4002], "pulse:ws:1001|pulse:pay:4002"),
        (None, [3001, 3002], "pulse:pay:3001,3002"),
        ("", [], ""),
    ],
)
def test_append_payment_ids_to_description(
    description: str | None,
    payment_ids: list[int],
    expected: str,
) -> None:
    assert append_payment_ids_to_description(description, payment_ids) == expected


def test_get_payment_linking_mode_defaults_to_document_description() -> None:
    assert get_payment_linking_mode({}) == "document_description"


def test_get_payment_linking_mode_reads_stored_value() -> None:
    settings = {"regos_integration": {"payment_linking_mode": "sale_id_field"}}
    assert get_payment_linking_mode(settings) == "sale_id_field"


def test_validate_payment_linking_mode_rejects_unknown_mode() -> None:
    with pytest.raises(AppError) as exc_info:
        validate_payment_linking_mode("invalid", sale_id_field_configured=True)
    assert exc_info.value.code == "INVALID_PAYMENT_LINKING_MODE"


def test_validate_payment_linking_mode_requires_sale_id_field() -> None:
    with pytest.raises(AppError) as exc_info:
        validate_payment_linking_mode("sale_id_field", sale_id_field_configured=False)
    assert exc_info.value.code == "PAYMENT_LINKING_SALE_ID_FIELD_REQUIRED"
