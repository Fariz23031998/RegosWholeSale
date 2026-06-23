from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from helpers import register_owner

FULL_DEFAULTS = {
    "warehouse": {"id": 11, "name": "Main warehouse"},
    "price_type": {"id": 22, "name": "Retail"},
    "partner": {"id": 33, "name": "Walk-in"},
    "payment_category": {"id": 66, "name": "Sales income"},
    "refund_payment_category": {"id": 77, "name": "Sales refund"},
}


async def _configure_defaults(client: AsyncClient, headers: dict) -> None:
    await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={"settings": {"regos_defaults": FULL_DEFAULTS}},
    )


@patch("app.services.regos_dashboard.regos_sales_service.list_payment_documents", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_return_operations_batch",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_return_documents",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_operations_batch",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_documents",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_stats(
    mock_sales: AsyncMock,
    mock_operations: AsyncMock,
    mock_returns: AsyncMock,
    mock_return_operations: AsyncMock,
    mock_payments: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_sales.return_value = {
        "documents": [
            {
                "id": 1001,
                "code": "WS-1001",
                "date": 1_717_000_000,
                "partner_name": "Walk-in",
                "amount": 25000,
            }
        ],
        "next_offset": 0,
        "total": 10,
    }
    mock_returns.return_value = {
        "documents": [{"id": 2001, "code": "WRT-2001", "date": 1_717_000_000, "amount": 5000}],
        "next_offset": 0,
        "total": 1,
    }
    mock_operations.return_value = {
        "operations": [
            {
                "id": 5001,
                "document_id": 1001,
                "item_id": 101,
                "item_name": "Cola",
                "quantity": 2,
                "price": 10000,
                "amount": 20000,
                "last_purchase_cost": 7000,
            }
        ]
    }
    mock_return_operations.return_value = {
        "operations": [
            {
                "id": 6001,
                "document_id": 2001,
                "item_id": 101,
                "item_name": "Cola",
                "quantity": 1,
                "price": 5000,
                "amount": 5000,
                "last_purchase_cost": 7000,
            }
        ]
    }
    mock_payments.return_value = {
        "documents": [
            {
                "id": 3001,
                "code": "PAY-3001",
                "date": 1_717_000_000,
                "amount": 25000,
                "category_id": 66,
                "category_name": "Sales income",
                "payment_type_name": "Cash",
            },
            {
                "id": 3002,
                "code": "PAY-3002",
                "date": 1_717_000_000,
                "amount": 5000,
                "category_id": 77,
                "category_name": "Sales refund",
                "payment_type_name": "Cash",
            },
            {
                "id": 3003,
                "code": "PAY-3003",
                "date": 1_717_000_000,
                "amount": 1000,
                "category_id": 99,
                "category_name": "Other",
                "payment_type_name": "Cash",
            },
        ],
        "next_offset": 0,
        "total": 3,
    }

    reg = await register_owner(client, email="dashboard@test.com", company_name="Dashboard Co")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_defaults(client, headers)

    response = await client.get(
        "/api/v1/dashboard/stats",
        headers=headers,
        params={"start_date": 1_716_000_000, "end_date": 1_718_000_000},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["sales_total"] == 25000
    assert data["cost_total"] == 14000
    assert data["gross_profit"] == 11000
    assert data["refunds_total"] == 5000
    assert data["refunds_cost_total"] == 7000
    assert data["net_sales_total"] == 20000
    assert data["net_cost_total"] == 7000
    assert data["net_gross_profit"] == 13000
    assert data["refund_count"] == 1
    assert data["income_payments_total"] == 25000
    assert data["outcome_payments_total"] == 5000
    assert data["income_payment_category_name"] == "Sales income"
    assert data["outcome_payment_category_name"] == "Sales refund"
    assert len(data["income_payments"]) == 1
    assert len(data["outcome_payments"]) == 1
    assert data["top_products"][0]["name"] == "Cola"
    assert data["sales_count_total"] == 10
    assert "products" not in data


@patch("app.services.regos_dashboard.regos_products_service.get_products_by_ids", new_callable=AsyncMock)
@patch("app.services.regos_dashboard.regos_sales_service.list_payment_documents", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_return_operations_batch",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_return_documents",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_operations_batch",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_documents",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_products_page(
    mock_sales: AsyncMock,
    mock_operations: AsyncMock,
    mock_returns: AsyncMock,
    mock_return_operations: AsyncMock,
    mock_payments: AsyncMock,
    mock_get_products_by_ids: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_sales.return_value = {
        "documents": [{"id": 1001, "code": "WS-1001", "date": 1_717_000_000, "amount": 20000}],
        "next_offset": 0,
        "total": 1,
    }
    mock_returns.return_value = {"documents": [], "next_offset": 0, "total": 0}
    mock_operations.return_value = {
        "operations": [
            {
                "id": 5001,
                "document_id": 1001,
                "item_id": 101,
                "item_name": "Cola",
                "quantity": 2,
                "price": 10000,
                "amount": 20000,
                "last_purchase_cost": 7000,
            }
        ]
    }
    mock_return_operations.return_value = {"operations": []}
    mock_payments.return_value = {"documents": [], "next_offset": 0, "total": 0}
    mock_get_products_by_ids.return_value = [
        {
            "regos_item_id": 101,
            "code": "COLA-101",
            "name": "Cola",
            "category": "Beverages",
            "price": 10000,
        }
    ]

    reg = await register_owner(client, email="dashboard-products@test.com", company_name="Dashboard Products")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_defaults(client, headers)

    response = await client.get(
        "/api/v1/dashboard/products",
        headers=headers,
        params={"start_date": 1_716_000_000, "end_date": 1_718_000_000, "offset": 0, "limit": 50},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["next_offset"] == 0
    assert len(data["products"]) == 1
    assert data["products"][0]["code"] == "COLA-101"
    assert data["products"][0]["sold_quantity"] == 2
    assert data["products"][0]["average_price"] == 10000
    assert data["products"][0]["net_gross_profit"] == 6000
    mock_get_products_by_ids.assert_awaited_once()
    assert mock_get_products_by_ids.await_args.args[3] == [101]


@patch("app.services.regos_dashboard.regos_sales_service.list_payment_documents", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_return_operations_batch",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_return_documents",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_operations_batch",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_documents",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_stats_filters_by_stock_ids(
    mock_sales: AsyncMock,
    mock_operations: AsyncMock,
    mock_returns: AsyncMock,
    mock_return_operations: AsyncMock,
    mock_payments: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_sales.return_value = {"documents": [], "next_offset": 0, "total": 0}
    mock_returns.return_value = {"documents": [], "next_offset": 0, "total": 0}
    mock_operations.return_value = {"operations": []}
    mock_return_operations.return_value = {"operations": []}
    mock_payments.return_value = {"documents": [], "next_offset": 0, "total": 0}

    reg = await register_owner(client, email="dashboard-stocks@test.com", company_name="Dashboard Stocks")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_defaults(client, headers)

    response = await client.get(
        "/api/v1/dashboard/stats",
        headers=headers,
        params={
            "start_date": 1_716_000_000,
            "end_date": 1_718_000_000,
            "all_stocks": "false",
            "stock_ids": [11, 22],
        },
    )
    assert response.status_code == 200
    assert mock_sales.await_args.kwargs["stock_ids"] == [11, 22]
    assert mock_sales.await_args.kwargs["all_stocks"] is False
    assert mock_returns.await_args.kwargs["stock_ids"] == [11, 22]
    assert mock_payments.await_args.kwargs["stock_ids"] == [11, 22]


@patch(
    "app.services.regos_dashboard.regos_sales_service.list_payment_documents",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_return_operations_batch",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_return_documents",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_operations_batch",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_dashboard.regos_sales_service.list_wholesale_documents",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_stats_filters_by_partner_ids(
    mock_sales: AsyncMock,
    mock_operations: AsyncMock,
    mock_returns: AsyncMock,
    mock_return_operations: AsyncMock,
    mock_payments: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_sales.return_value = {"documents": [], "next_offset": 0, "total": 0}
    mock_returns.return_value = {"documents": [], "next_offset": 0, "total": 0}
    mock_operations.return_value = {"operations": []}
    mock_return_operations.return_value = {"operations": []}
    mock_payments.return_value = {"documents": [], "next_offset": 0, "total": 0}

    reg = await register_owner(client, email="dashboard-partners@test.com", company_name="Dashboard Partners")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_defaults(client, headers)

    response = await client.get(
        "/api/v1/dashboard/stats",
        headers=headers,
        params={
            "start_date": 1_716_000_000,
            "end_date": 1_718_000_000,
            "all_partners": "false",
            "partner_ids": [33, 44],
        },
    )
    assert response.status_code == 200
    assert mock_sales.await_args.kwargs["partner_ids"] == [33, 44]
    assert mock_sales.await_args.kwargs["all_partners"] is False
    assert mock_returns.await_args.kwargs["partner_ids"] == [33, 44]
    assert mock_payments.await_args.kwargs["partner_ids"] == [33, 44]
