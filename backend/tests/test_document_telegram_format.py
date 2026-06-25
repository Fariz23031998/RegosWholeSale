from app.services.document_telegram_format import (
    format_inout_receipt,
    parse_inout_type,
)

SAMPLE_INOUT_OPS = [
    {
        "id": 1,
        "quantity": 5,
        "item": {"name": "Potato"},
    }
]


def test_parse_inout_type_accepts_numeric_values():
    assert parse_inout_type({"inout_type": 1}) == "income"
    assert parse_inout_type({"inout_type": "1"}) == "income"
    assert parse_inout_type({"inout_type": 2}) == "outcome"
    assert parse_inout_type({"inout_type": "2"}) == "outcome"


def test_parse_inout_type_accepts_string_values():
    assert parse_inout_type({"inout_type": "Income"}) == "income"
    assert parse_inout_type({"inout_type": "Outcome"}) == "outcome"


def test_format_inout_receipt_uses_specific_title_for_income():
    message = format_inout_receipt(
        {"code": "IN-1", "date": 1700000000, "inout_type": 1},
        SAMPLE_INOUT_OPS,
        "Main",
        lang="ru",
    )
    assert "*Внесение*" in message
    assert "Списание/Занесение" not in message
    assert "Списание/внесение" not in message


def test_format_inout_receipt_uses_specific_title_for_outcome():
    message = format_inout_receipt(
        {"code": "OUT-1", "date": 1700000000, "inout_type": 2},
        SAMPLE_INOUT_OPS,
        "Main",
        lang="ru",
    )
    assert "*Списание*" in message


def test_format_inout_receipt_supports_english():
    message = format_inout_receipt(
        {"code": "IN-1", "date": 1700000000, "inout_type": 1},
        SAMPLE_INOUT_OPS,
        "Main",
        lang="en",
    )
    assert "*Stock intake*" in message
