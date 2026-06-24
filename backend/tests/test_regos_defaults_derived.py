from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.services import regos_defaults as regos_defaults_service
from app.schemas.settings import RegosReferenceOptionsResponse
from app.services.regos_sales import (
    operative_operation_price,
    wholesale_operation_price_fields,
)
from helpers import register_owner


def test_reference_options_response_preserves_price_type_currency() -> None:
    response = RegosReferenceOptionsResponse(
        price_types=[
            {
                "id": 23,
                "name": "Wholesale USD",
                "currency": {
                    "id": 45,
                    "name": "USD",
                    "code_chr": "USD",
                    "exchange_rate": 12500,
                },
            }
        ]
    )

    assert response.price_types[0].currency is not None
    assert response.price_types[0].currency.code_chr == "USD"
    assert response.price_types[0].currency.exchange_rate == 12500


def test_wholesale_operation_price_fields_follow_regos_api_semantics() -> None:
    usd = {"id": 2, "name": "USD", "code_chr": "USD", "exchange_rate": 12600}
    fields = wholesale_operation_price_fields(90.0, 100.0, currency=usd)
    assert fields["price"] == 90.0
    assert fields["price2"] == 100.0

    uzs = {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1}
    fields = wholesale_operation_price_fields(90.0, 100.0, currency=uzs)
    assert fields["price"] == 90.0
    assert fields["price2"] == 100.0


def test_operative_operation_price_uses_document_currency_price() -> None:
    usd = {"id": 2, "name": "USD", "code_chr": "USD", "exchange_rate": 12600}
    assert operative_operation_price(35.0, 35.0, usd) == 35.0


@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_find_price_type_for_currency(mock_regos: AsyncMock) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {
                "id": 22,
                "name": "Retail UZS",
                "currency": {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1},
            },
            {
                "id": 77,
                "name": "Wholesale USD",
                "currency": {"id": 2, "name": "USD", "code_chr": "USD", "exchange_rate": 12600},
            },
        ],
    }

    matched = await regos_defaults_service.find_price_type_for_currency(None, 1, 2)

    assert matched is not None
    assert matched["id"] == 77
    assert matched["currency"]["code_chr"] == "USD"


@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_enrich_checkout_defaults_from_price_type_and_warehouse(
    mock_regos: AsyncMock,
) -> None:
    mock_regos.side_effect = [
        {
            "ok": True,
            "result": [
                {
                    "id": 11,
                    "name": "Main warehouse",
                    "firm": {"id": 55, "name": "Main firm"},
                }
            ],
        },
        {
            "ok": True,
            "result": [
                {
                    "id": 22,
                    "name": "Retail",
                    "currency": {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1},
                }
            ],
        },
    ]

    defaults = {
        "warehouse": {"id": 11, "name": "Main warehouse"},
        "price_type": {"id": 22, "name": "Retail"},
        "partner": {"id": 33, "name": "Walk-in"},
        "payment_category": None,
        "attached_user": None,
        "zero_quantity": False,
        "zero_price": False,
    }

    enriched = await regos_defaults_service.enrich_checkout_defaults(None, 1, defaults)

    assert enriched["currency"] == {
        "id": 44,
        "name": "UZS",
        "code_chr": "UZS",
        "exchange_rate": 1,
    }
    assert enriched["firm"] == {"id": 55, "name": "Main firm"}
    regos_defaults_service.validate_checkout_defaults(
        {
            **enriched,
            "payment_category": {"id": 66, "name": "Sales"},
        }
    )


@pytest.mark.asyncio
async def test_checkout_missing_currency_when_price_type_has_none(client: AsyncClient) -> None:
    reg = await register_owner(client, email="no-currency@test.com", company_name="No Currency Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    with patch(
        "app.services.regos_sales.regos_defaults_service.enrich_checkout_defaults",
        new_callable=AsyncMock,
    ) as mock_enriched:
        mock_enriched.return_value = {
            "warehouse": {"id": 11, "name": "Main warehouse"},
            "price_type": {"id": 22, "name": "Retail"},
            "partner": {"id": 33, "name": "Walk-in"},
            "firm": {"id": 55, "name": "Main firm"},
            "currency": None,
            "payment_category": {"id": 66, "name": "Sales"},
        }

        response = await client.post(
            "/api/v1/sales/checkout",
            headers=headers,
            json={
                "items": [{"regos_item_id": 101, "qty": 1, "price": 100}],
                "discount": 0,
                "payment_type_id": 5,
                "total": 100,
            },
        )

    assert response.status_code == 400
    assert response.json()["code"] == "REGOS_CHECKOUT_DEFAULTS_NOT_CONFIGURED"
    assert "currency" in response.json()["detail"].lower()
