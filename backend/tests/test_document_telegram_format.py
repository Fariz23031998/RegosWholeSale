from app.services.document_telegram_format import (
    format_inout_receipt,
    format_movement_receipt,
    format_partner_receipt,
    format_payment_notification,
    format_pos_cheque_notification,
    format_pos_session_notification,
    parse_inout_type,
)
from app.services.pos_session_report import PaymentTypeTotals, SessionTotals

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


def test_format_partner_receipt_title_for_wholesale():
    message = format_partner_receipt(
        {"code": "WS-001", "date": 1700000000, "partner": {"name": "Acme"}},
        SAMPLE_PARTNER_OPS,
        lang="en",
        use_cost=False,
    )
    assert "*Wholesale receipt*" in message
    assert "*Purchase receipt*" not in message


def test_format_partner_receipt_title_for_purchase():
    message = format_partner_receipt(
        {"code": "P-001", "date": 1700000000, "partner": {"name": "Supplier"}},
        SAMPLE_PARTNER_OPS,
        lang="en",
        use_cost=True,
    )
    assert "*Purchase receipt*" in message
    assert "*Wholesale receipt*" not in message


def test_format_partner_receipt_title_for_wholesale_return():
    message = format_partner_receipt(
        {"code": "WR-001", "date": 1700000000, "partner": {"name": "Acme"}},
        SAMPLE_PARTNER_OPS,
        lang="en",
        is_return=True,
        use_cost=False,
    )
    assert "*Wholesale return receipt*" in message
    assert "*Purchase return receipt*" not in message


def test_format_partner_receipt_title_for_purchase_return():
    message = format_partner_receipt(
        {"code": "RP-001", "date": 1700000000, "partner": {"name": "Supplier"}},
        SAMPLE_PARTNER_OPS,
        lang="en",
        is_return=True,
        use_cost=True,
    )
    assert "*Purchase return receipt*" in message
    assert "*Wholesale return receipt*" not in message


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
        lang="en",
    )
    assert "User: Cashier One" in message
    assert "Warehouse:" not in message
    assert "Currency: UZS" in message
    assert "Amount: 1 000" in message
    assert "1 000 UZS" not in message


def test_format_payment_notification_includes_partner_firm_category():
    message = format_payment_notification(
        {
            "code": "PAY-2",
            "date": 1700000000,
            "amount": 280.01,
            "exchange_rate": 160.53,
            "type": {"name": "Rubl"},
            "currency": {"name": "USD"},
            "partner": {"name": "Acme LLC"},
            "firm": {"name": "My Firm"},
            "category": {"positive": True, "name": "Supplier payment"},
            **ATTACHED_USER_DOC,
        },
        lang="en",
    )
    assert "Partner: Acme LLC" in message
    assert "Firm: My Firm" in message
    assert "Category: Supplier payment" in message
    assert "Currency: USD" in message
    assert "Paid out" in message
    assert "Exchange rate: 160.53" in message


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


SAMPLE_POS_CHEQUE = {
    "uuid": "f44289c4-6edc-48d0-a40f-63d718f35993",
    "date": 1607608770,
    "code": "WEB-0000581",
    "session_code": "WEB-0000077",
    "cashier": {"full_name": "John Kennedy"},
    "seller": {"full_name": "John Kennedy"},
    "card": {"customer": {"full_name": "Megan Williams"}},
    "amount": 8550.1,
    "payments_amount": 500.0,
}

SAMPLE_POS_CHEQUE_OPS = [
    {
        "quantity": 2,
        "price": 100,
        "item": {"name": "Widget"},
    }
]

SAMPLE_POS_CHEQUE_OPS_WITH_STORNO = [
    {
        "quantity": 2,
        "price": 100,
        "item": {"name": "Widget"},
        "has_storno": False,
    },
    {
        "quantity": 1,
        "price": 50,
        "item": {"name": "Bolt"},
        "has_storno": True,
    },
]

SAMPLE_POS_CHEQUE_OPS_STORNO_PAIR = [
    {
        "quantity": 1,
        "price": 12000,
        "item": {"name": "Bottles"},
    },
    {
        "quantity": 1,
        "price": 24000,
        "item": {"name": "Tomat"},
        "has_storno": True,
    },
    {
        "quantity": -1,
        "price": 24000,
        "item": {"name": "Tomat"},
    },
]

SAMPLE_POS_PAYMENTS = [
    {
        "uuid": "bddde1b2-555f-4942-a1ba-270f48b15d11",
        "has_storno": False,
        "type": {"name": "Cash"},
        "value": 200.0,
    },
    {
        "uuid": "cddde1b2-555f-4942-a1ba-270f48b15d12",
        "has_storno": True,
        "type": {"name": "Card"},
        "value": 50.0,
    },
]

SAMPLE_POS_SESSION = {
    "uuid": "6ab5087b-64fa-4cd2-8bc9-d5099e0fd45c",
    "code": "WEB-0000004",
    "operating_cash_id": 1,
    "start_date": 1592573622,
    "start_user": {"full_name": "John Kennedy"},
    "start_amount": 10000.0,
    "close_date": 1592577622,
    "close_user": {"full_name": "John Kennedy"},
    "close_amount": 15000.0,
    "closed": True,
}


def test_format_pos_cheque_notification_closed():
    message = format_pos_cheque_notification(
        SAMPLE_POS_CHEQUE,
        SAMPLE_POS_CHEQUE_OPS,
        SAMPLE_POS_PAYMENTS,
        variant="closed",
        lang="en",
    )
    assert "<b>POS cheque closed</b>" in message
    assert "WEB-0000581" in message
    assert "WEB-0000077" in message
    assert "Megan Williams" in message
    assert "Widget" in message
    assert "Total to pay: 200" in message
    assert "Cash: 200" in message
    assert "Total paid: 200" in message
    assert "<s>2. Card: 50</s>" in message


def test_format_pos_cheque_notification_uses_session_code_not_uuid():
    message = format_pos_cheque_notification(
        {
            **SAMPLE_POS_CHEQUE,
            "session_code": "17-0000004",
            "session": "18c5b099-970c-4ab1-881a-02e1a919b94c",
        },
        SAMPLE_POS_CHEQUE_OPS,
        SAMPLE_POS_PAYMENTS,
        variant="closed",
        lang="ru",
    )
    assert "17-0000004" in message
    assert "18c5b099" not in message


def test_format_pos_cheque_notification_omits_session_uuid_without_code():
    message = format_pos_cheque_notification(
        {
            **SAMPLE_POS_CHEQUE,
            "session_code": "",
            "session": "18c5b099-970c-4ab1-881a-02e1a919b94c",
        },
        SAMPLE_POS_CHEQUE_OPS,
        SAMPLE_POS_PAYMENTS,
        variant="closed",
        lang="ru",
    )
    assert "18c5b099" not in message
    assert "Смена:" not in message


def test_format_pos_cheque_notification_canceled():
    message = format_pos_cheque_notification(
        SAMPLE_POS_CHEQUE,
        SAMPLE_POS_CHEQUE_OPS,
        variant="canceled",
        lang="ru",
    )
    assert "<b>ОТМЕНЕНО</b>" in message
    assert "<b>Отмена чека</b>" in message


def test_format_pos_cheque_notification_storno_operation():
    message = format_pos_cheque_notification(
        SAMPLE_POS_CHEQUE,
        SAMPLE_POS_CHEQUE_OPS_WITH_STORNO,
        variant="closed",
        lang="en",
    )
    assert "<s>2. Bolt</s>" in message
    assert "Total to pay: 200" in message
    assert "Bolt" in message


def test_format_pos_cheque_notification_hides_negative_storno_reversal():
    message = format_pos_cheque_notification(
        SAMPLE_POS_CHEQUE,
        SAMPLE_POS_CHEQUE_OPS_STORNO_PAIR,
        [{"has_storno": False, "type": {"name": "Cash"}, "value": 12000.0}],
        variant="closed",
        lang="ru",
    )
    assert "Bottles" in message
    assert "<s>2." in message and "Tomat" in message
    assert "-1" not in message
    assert "Итого к оплате: 12 000" in message
    assert "Итого оплачено: 12 000" in message


def test_format_pos_cheque_notification_pay_debt():
    message = format_pos_cheque_notification(
        SAMPLE_POS_CHEQUE,
        None,
        SAMPLE_POS_PAYMENTS[:1],
        variant="pay_debt",
        lang="en",
    )
    assert "<b>POS cheque debt payment</b>" in message
    assert "Debt paid: 500" in message
    assert "Cash: 200" in message


def test_format_pos_session_notification_opened():
    message = format_pos_session_notification(
        SAMPLE_POS_SESSION,
        variant="opened",
        lang="en",
    )
    assert "*Cash session opened*" in message
    assert "WEB-0000004" in message
    assert "John Kennedy" in message
    assert "Opening amount: 10 000" in message
    assert "Closing amount" not in message


def test_format_pos_session_notification_closed():
    message = format_pos_session_notification(
        SAMPLE_POS_SESSION,
        variant="closed",
        lang="ru",
    )
    assert "*Закрытие кассовой смены*" in message
    assert "Сумма при закрытии: 15 000" in message


def test_format_pos_session_notification_closed_includes_totals():
    totals = SessionTotals(
        sales_amount=200.0,
        sales_payments=200.0,
        refund_amount=50.0,
        refund_payments=50.0,
        by_payment_type={
            "Cash": PaymentTypeTotals(sales=150.0, refunds=50.0),
            "Card": PaymentTypeTotals(sales=50.0, refunds=0.0),
        },
    )
    message = format_pos_session_notification(
        SAMPLE_POS_SESSION,
        variant="closed",
        lang="en",
        totals=totals,
    )
    assert "Session totals" in message
    assert "Sales: 200" in message
    assert "Payments received (sales): 200" in message
    assert "Refunds: 50" in message
    assert "Payments returned (refunds): 50" in message
    assert "Net sales: 150" in message
    assert "Net payments: 150" in message
    assert "Cash — sales: 150 / refunds: 50 / net: 100" in message
    assert "Card — sales: 50 / refunds: 0 / net: 50" in message
