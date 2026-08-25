from app.services.pos_session_report import PaymentTypeTotals, SessionTotals, compute_session_totals

SALE_CHEQUE_UUID = "f44289c4-6edc-48d0-a40f-63d718f35993"
RETURN_CHEQUE_UUID = "a1111111-1111-1111-1111-111111111111"


def test_compute_session_totals_with_sales_refunds_and_payment_types():
    cheques = [
        {
            "uuid": SALE_CHEQUE_UUID,
            "is_return": False,
            "code": "WEB-0000581",
        },
        {
            "uuid": RETURN_CHEQUE_UUID,
            "is_return": True,
            "code": "WEB-0000582",
        },
    ]
    operations_by_cheque = {
        SALE_CHEQUE_UUID: [
            {"quantity": 2, "price": 100, "item": {"name": "Widget"}, "has_storno": False},
        ],
        RETURN_CHEQUE_UUID: [
            {"quantity": 1, "price": 50, "item": {"name": "Bolt"}, "has_storno": False},
        ],
    }
    payments_by_cheque = {
        SALE_CHEQUE_UUID: [
            {"has_storno": False, "type": {"name": "Cash"}, "value": 150.0},
            {"has_storno": False, "type": {"name": "Card"}, "value": 50.0},
            {"has_storno": True, "type": {"name": "Card"}, "value": 25.0},
        ],
        RETURN_CHEQUE_UUID: [
            {"has_storno": False, "type": {"name": "Cash"}, "value": 50.0},
        ],
    }

    totals = compute_session_totals(
        cheques,
        operations_by_cheque,
        payments_by_cheque,
        lang="en",
    )

    assert totals.sales_amount == 200.0
    assert totals.refund_amount == 50.0
    assert totals.net_sales == 150.0
    assert totals.sales_payments == 200.0
    assert totals.refund_payments == 50.0
    assert totals.net_payments == 150.0
    assert totals.by_payment_type["Cash"] == PaymentTypeTotals(sales=150.0, refunds=50.0)
    assert totals.by_payment_type["Card"] == PaymentTypeTotals(sales=50.0, refunds=0.0)


def test_compute_session_totals_ignores_negative_payment_values():
    cheques = [{"uuid": SALE_CHEQUE_UUID, "is_return": False}]
    operations_by_cheque = {
        SALE_CHEQUE_UUID: [
            {"quantity": 1, "price": 100, "item": {"name": "Widget"}, "has_storno": False},
        ],
    }
    payments_by_cheque = {
        SALE_CHEQUE_UUID: [
            {"has_storno": False, "type": {"name": "Cash"}, "value": -10.0},
            {"has_storno": False, "type": {"name": "Cash"}, "value": 100.0},
        ],
    }

    totals = compute_session_totals(
        cheques,
        operations_by_cheque,
        payments_by_cheque,
        lang="en",
    )

    assert totals.sales_amount == 100.0
    assert totals.sales_payments == 100.0


def test_compute_session_totals_includes_change_payments():
    tender_uuid = "142d7b1d-bc9b-49a2-949c-ad18283f75f9"
    cheques = [{"uuid": SALE_CHEQUE_UUID, "is_return": False}]
    operations_by_cheque = {
        SALE_CHEQUE_UUID: [
            {"quantity": 1, "price": 12000, "item": {"name": "Bottles"}, "has_storno": False},
        ],
    }
    payments_by_cheque = {
        SALE_CHEQUE_UUID: [
            {
                "uuid": tender_uuid,
                "has_storno": False,
                "has_change": True,
                "change_uuid": None,
                "type": {"name": "Cash"},
                "value": 100000.0,
            },
            {
                "uuid": "6ca7ff10-dc6e-4c75-bbf7-49e6d077d893",
                "has_storno": False,
                "has_change": False,
                "change_uuid": tender_uuid,
                "type": {"name": "Cash"},
                "value": -88000.0,
            },
            {
                "has_storno": False,
                "type": {"name": "Cash"},
                "value": -10.0,
            },
        ],
    }

    totals = compute_session_totals(
        cheques,
        operations_by_cheque,
        payments_by_cheque,
        lang="en",
    )

    assert totals.sales_amount == 12000.0
    assert totals.sales_payments == 12000.0
    assert totals.by_payment_type["Cash"] == PaymentTypeTotals(sales=12000.0, refunds=0.0)


def test_session_totals_net_properties():
    totals = SessionTotals(
        sales_amount=300.0,
        sales_payments=280.0,
        refund_amount=100.0,
        refund_payments=90.0,
    )
    assert totals.net_sales == 200.0
    assert totals.net_payments == 190.0

    payment_totals = PaymentTypeTotals(sales=120.0, refunds=20.0)
    assert payment_totals.net == 100.0
