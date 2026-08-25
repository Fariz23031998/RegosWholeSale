import io
from datetime import UTC, datetime

from openpyxl import load_workbook

from app.services.out_of_stock_excel import generate_out_of_stock_excel


def test_generate_out_of_stock_excel_contains_report_rows():
    detected_at = datetime(2026, 3, 15, 12, 30, tzinfo=UTC)
    workbook = load_workbook(
        io.BytesIO(
            generate_out_of_stock_excel(
                [
                    {
                        "product_name": "Widget",
                        "code": "W-001",
                        "barcode": "4601234567890",
                        "stock_name": "Main warehouse",
                        "quantity": 2.0,
                        "min_quantity": 5.0,
                        "last_purchase_cost": 7000.0,
                        "price": 22000.0,
                        "detected_at": detected_at,
                    }
                ],
                lang="en",
            )
        )
    )

    sheet = workbook.active
    assert sheet["A1"].value == "Product"
    assert sheet["A2"].value == "Widget"
    assert sheet["B2"].value == "W-001"
    assert sheet["D2"].value == "Main warehouse"
    assert sheet["E2"].value == 2.0
    assert sheet["F2"].value == 5.0
    assert sheet["G2"].value == 7000.0
    assert sheet["H2"].value == 22000.0
    assert sheet["I2"].value == "15.03.2026 12:30"
    assert sheet.freeze_panes == "A2"
