import io

from openpyxl import load_workbook

from app.services.pos_session_report import PaymentTypeTotals, SessionReportData, SessionTotals
from app.services.pos_session_excel import generate_session_excel

SALE_CHEQUE_UUID = "f44289c4-6edc-48d0-a40f-63d718f35993"
RETURN_CHEQUE_UUID = "a1111111-1111-1111-1111-111111111111"


def _sample_report() -> SessionReportData:
    return SessionReportData(
        cash_session={"code": "WEB-0000004"},
        cheques=[
            {
                "uuid": SALE_CHEQUE_UUID,
                "code": "WEB-0000581",
                "date": 1607608770,
                "is_return": False,
            },
            {
                "uuid": RETURN_CHEQUE_UUID,
                "code": "WEB-0000582",
                "date": 1607608771,
                "is_return": True,
            },
        ],
        operations_by_cheque={
            SALE_CHEQUE_UUID: [
                {"quantity": 2, "price": 100, "item": {"name": "Widget"}, "has_storno": False},
            ],
            RETURN_CHEQUE_UUID: [
                {"quantity": 1, "price": 50, "item": {"name": "Bolt"}, "has_storno": False},
            ],
        },
        payments_by_cheque={
            SALE_CHEQUE_UUID: [
                {"has_storno": False, "type": {"name": "Cash"}, "value": 200.0},
            ],
            RETURN_CHEQUE_UUID: [
                {"has_storno": False, "type": {"name": "Cash"}, "value": 50.0},
            ],
        },
        totals=SessionTotals(
            sales_amount=200.0,
            sales_payments=200.0,
            refund_amount=50.0,
            refund_payments=50.0,
            by_payment_type={
                "Cash": PaymentTypeTotals(sales=200.0, refunds=50.0),
            },
        ),
    )


def test_generate_session_excel_applies_header_and_number_styling():
    workbook = load_workbook(io.BytesIO(generate_session_excel(_sample_report(), lang="en")))

    products_sheet = workbook["Products"]
    header_cell = products_sheet["A1"]
    assert header_cell.font.bold is True
    assert header_cell.font.color.rgb == "00FFFFFF"
    assert header_cell.fill.fgColor.rgb == "001F4E79"
    assert products_sheet.freeze_panes == "A2"
    assert products_sheet.auto_filter.ref == "A1:G3"

    amount_cell = products_sheet["F2"]
    assert amount_cell.number_format == "#,##0.00"
    assert amount_cell.alignment.horizontal == "right"

    quantity_cell = products_sheet["D2"]
    assert quantity_cell.number_format == "0.###"
    assert quantity_cell.alignment.horizontal == "right"

    return_row_fill = products_sheet["A3"].fill.fgColor.rgb
    assert return_row_fill == "00FCE4D6"

    payments_sheet = workbook["Payments"]
    payment_amount_cell = payments_sheet["D2"]
    assert payment_amount_cell.number_format == "#,##0.00"
