from app.services.document_telegram_format import (
    format_inout_receipt,
    format_movement_receipt,
    format_partner_receipt,
    format_payment_notification,
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


SAMPLE_PARTNER_OPS = [
    {
        "id": 1,
        "quantity": 2,
        "price": 100,
        "cost": 100,
        "item": {"name": "Widget"},
    }
]


def test_format_partner_receipt_includes_partner_currency_and_exchange_rate():
    message = format_partner_receipt(
        {
            "code": "WS-001",
            "date": 1700000000,
            "partner": {"name": "Acme LLC", "phone": "+998901234567"},
            "currency": {"name": "US Dollar", "exchange_rate": 12600},
            "exchange_rate": 12600,
            "attached_user": {"id": 7, "full_name": "Cashier One"},
        },
        SAMPLE_PARTNER_OPS,
        "Main warehouse",
        use_cost=True,
        lang="en",
    )
    assert "Partner: Acme LLC" in message
    assert "Attached user: Cashier One" in message
    assert "Phone: +998901234567" in message
    assert "Currency: US Dollar" in message
    assert "Exchange rate: 12 600" in message
    assert "Total to pay: 200" in message
    assert "200 US Dollar" not in message


def test_format_partner_receipt_omits_phone_and_exchange_rate_when_not_applicable():
    message = format_partner_receipt(
        {
            "code": "P-001",
            "date": 1700000000,
            "partner": {"name": "Supplier"},
            "currency": {"name": "UZS", "exchange_rate": 1},
        },
        SAMPLE_PARTNER_OPS,
        lang="ru",
    )
    assert "Партнёр: Supplier" in message
    assert "Телефон:" not in message
    assert "Курс обмена:" not in message
    assert "Валюта: UZS" in message


ATTACHED_USER_DOC = {"attached_user": {"id": 7, "full_name": "Cashier One"}}


def test_format_payment_notification_includes_attached_user():
    message = format_payment_notification(
        {
            "code": "PAY-1",
            "date": 1700000000,
            "amount": 1000,
            "type": {"name": "Cash"},
            "currency": {"name": "UZS"},
            "category": {"positive": False},
            **ATTACHED_USER_DOC,
        },
        "Main",
        lang="en",
    )
    assert "Attached user: Cashier One" in message


def test_format_inout_receipt_includes_attached_user():
    message = format_inout_receipt(
        {"code": "IN-1", "date": 1700000000, "inout_type": 1, **ATTACHED_USER_DOC},
        SAMPLE_INOUT_OPS,
        "Main",
        lang="en",
    )
    assert "Attached user: Cashier One" in message


def test_format_movement_receipt_includes_attached_user():
    message = format_movement_receipt(
        {
            "code": "MVT-1",
            "date": 1700000000,
            "stock_sender": {"name": "A"},
            "stock_receiver": {"name": "B"},
            **ATTACHED_USER_DOC,
        },
        SAMPLE_INOUT_OPS,
        lang="en",
    )
    assert "Attached user: Cashier One" in message
