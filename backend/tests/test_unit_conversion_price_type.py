from app.services.regos_sales import _extract_session_overrides
from app.services.unit_conversions import (
    apply_secondary_prices,
    merge_conversions_into_products,
)


def test_merge_conversions_sets_factor_and_company_price_type() -> None:
    products = [
        {
            "regos_item_id": 10,
            "unit_id": 1,
            "secondary_unit_id": 2,
        }
    ]
    conversions = [
        {
            "regos_item_id": 10,
            "secondary_unit_id": 2,
            "conversion_factor": 12,
            "secondary_unit_name": "Box",
            "secondary_unit_type": 1,
        }
    ]

    merge_conversions_into_products(
        products,
        conversions,
        secondary_price_type_id=55,
    )

    assert products[0]["conversion_factor"] == 12
    assert products[0]["secondary_unit_name"] == "Box"
    assert products[0]["secondary_price_type_id"] == 55
    assert products[0]["secondary_price"] is None


def test_merge_conversions_without_company_price_type() -> None:
    products = [
        {
            "regos_item_id": 10,
            "secondary_unit_id": 2,
        }
    ]
    conversions = [
        {
            "regos_item_id": 10,
            "secondary_unit_id": 2,
            "conversion_factor": 12,
            "secondary_unit_name": "Box",
            "secondary_unit_type": 1,
        }
    ]

    merge_conversions_into_products(products, conversions)

    assert products[0]["conversion_factor"] == 12
    assert products[0]["secondary_price_type_id"] is None


def test_merge_conversions_matches_stock_item_id() -> None:
    products = [
        {
            "item_id": 77,
            "unit_id": 1,
            "secondary_unit_id": 2,
        }
    ]
    conversions = [
        {
            "regos_item_id": 77,
            "secondary_unit_id": 2,
            "conversion_factor": 12.0,
            "secondary_unit_name": "box",
            "secondary_unit_type": 1,
        }
    ]

    merge_conversions_into_products(products, conversions)

    assert products[0]["conversion_factor"] == 12.0
    assert products[0]["secondary_unit_name"] == "box"


def test_apply_secondary_prices_uses_matching_price_type() -> None:
    products = [
        {
            "regos_item_id": 10,
            "secondary_price_type_id": 55,
            "secondary_price": None,
        }
    ]
    apply_secondary_prices(products, {10: {55: 900.5, 1: 1000}})
    assert products[0]["secondary_price"] == 900.5


def test_extract_session_overrides_includes_currency_with_permission() -> None:
    payload = {
        "warehouse_id": 1,
        "price_type_id": 2,
        "partner_id": 3,
        "currency_id": 4,
    }
    with_perm = _extract_session_overrides(
        payload,
        {
            "pos.change_warehouse",
            "pos.change_price_type",
            "pos.change_partner",
            "pos.change_currency",
        },
    )
    assert with_perm["currency_id"] == 4

    without_perm = _extract_session_overrides(
        payload,
        {"pos.change_warehouse", "pos.change_price_type", "pos.change_partner"},
    )
    assert "currency_id" not in without_perm
