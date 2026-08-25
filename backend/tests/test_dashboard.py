from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from helpers import register_owner
from app.services.regos_dashboard import _convert_base_cost_for_display, clear_dashboard_period_cache
from app.services.regos_sales import _map_payment_document


@pytest.fixture(autouse=True)
def _clear_dashboard_period_cache() -> None:
    clear_dashboard_period_cache()
    yield
    clear_dashboard_period_cache()

FULL_DEFAULTS = {
    "warehouse": {"id": 11, "name": "Main warehouse"},
    "price_type": {"id": 22, "name": "Retail"},
    "partner": {"id": 33, "name": "Walk-in"},
    "currency": {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1},
    "firm": {"id": 55, "name": "Main firm"},
    "payment_category": {"id": 66, "name": "Sales income"},
    "refund_payment_category": {"id": 77, "name": "Sales refund"},
}

UZS = {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1}
USD = {"id": 2, "name": "US Dollar", "code_chr": "USD", "exchange_rate": 12600}


async def _configure_defaults(client: AsyncClient, headers: dict) -> None:
    await client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json={"settings": {"regos_defaults": FULL_DEFAULTS}},
    )


@patch("app.services.regos_dashboard.regos_sales_service.fetch_period_operations_batch", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.fetch_period_document_lists_batch",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_stats(
    mock_fetch_lists: AsyncMock,
    mock_fetch_operations: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_fetch_lists.return_value = (
        {
            "documents": [
                {
                    "id": 1001,
                    "code": "WS-1001",
                    "date": 1_717_000_000,
                    "partner_name": "Walk-in",
                    "amount": 25000,
                    "currency": UZS,
                }
            ],
            "next_offset": 0,
            "total": 10,
        },
        {
            "documents": [
                {
                    "id": 2001,
                    "code": "WRT-2001",
                    "date": 1_717_000_000,
                    "amount": 5000,
                    "currency": UZS,
                }
            ],
            "next_offset": 0,
            "total": 1,
        },
        {
            "documents": [
                {
                    "id": 3001,
                    "code": "PAY-3001",
                    "date": 1_717_000_000,
                    "amount": 25000,
                    "currency": UZS,
                    "category_id": 66,
                    "category_name": "Sales income",
                    "payment_type_name": "Cash",
                    "partner_name": "Walk-in",
                    "attached_user_name": "Cashier One",
                    "exchange_rate": 1,
                },
                {
                    "id": 3002,
                    "code": "PAY-3002",
                    "date": 1_717_000_000,
                    "amount": 5000,
                    "currency": UZS,
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
        },
    )
    mock_fetch_operations.return_value = (
        [
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
        ],
        [
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
        ],
    )

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
    assert data["has_multiple_currencies"] is False
    assert len(data["sales_by_currency"]) == 1
    assert data["sales_by_currency"][0]["amount"] == 25000
    assert data["sales_by_currency"][0]["currency"]["code_chr"] == "UZS"
    assert data["summary_currency"]["code_chr"] == "UZS"
    assert data["income_payments"][0]["currency"]["code_chr"] == "UZS"
    assert data["income_payments"][0]["partner_name"] == "Walk-in"
    assert data["income_payments"][0]["attached_user_name"] == "Cashier One"
    assert data["income_payments"][0]["exchange_rate"] == 1
    assert "products" not in data


@patch("app.services.regos_dashboard.regos_products_service.get_products_by_ids", new_callable=AsyncMock)
@patch("app.services.regos_dashboard.regos_sales_service.fetch_period_operations_batch", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.fetch_period_document_lists_batch",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_products_page(
    mock_fetch_lists: AsyncMock,
    mock_fetch_operations: AsyncMock,
    mock_get_products_by_ids: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_fetch_lists.return_value = (
        {
            "documents": [{"id": 1001, "code": "WS-1001", "date": 1_717_000_000, "amount": 20000}],
            "next_offset": 0,
            "total": 1,
        },
        {"documents": [], "next_offset": 0, "total": 0},
        {"documents": [], "next_offset": 0, "total": 0},
    )
    mock_fetch_operations.return_value = (
        [
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
        ],
        [],
    )
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
        params={"start_date": 1_716_000_000, "end_date": 1_718_000_000},
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
    assert data["totals"]["sold_quantity"] == 2
    assert data["totals"]["sold_total"] == 20000
    assert data["totals"]["net_gross_profit"] == 6000
    mock_get_products_by_ids.assert_awaited_once()
    assert mock_get_products_by_ids.await_args.args[3] == [101]


@patch("app.services.regos_dashboard.regos_sales_service.fetch_period_operations_batch", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.fetch_period_document_lists_batch",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_payments_page(
    mock_fetch_lists: AsyncMock,
    mock_fetch_operations: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_fetch_lists.return_value = (
        {"documents": [], "next_offset": 0, "total": 0},
        {"documents": [], "next_offset": 0, "total": 0},
        {
            "documents": [
                {
                    "id": 3001,
                    "code": "PAY-3001",
                    "date": 1_717_000_100,
                    "amount": 25000,
                    "currency": UZS,
                    "category_id": 66,
                    "category_name": "Sales income",
                    "payment_type_name": "Cash",
                    "partner_name": "Walk-in",
                    "attached_user_name": "Cashier One",
                    "exchange_rate": 1,
                },
                {
                    "id": 3004,
                    "code": "PAY-3004",
                    "date": 1_717_000_090,
                    "amount": 15000,
                    "currency": UZS,
                    "category_id": 66,
                    "category_name": "Sales income",
                    "payment_type_name": "Cash",
                    "partner_name": "Walk-in",
                },
                {
                    "id": 3002,
                    "code": "PAY-3002",
                    "date": 1_717_000_000,
                    "amount": 5000,
                    "currency": UZS,
                    "category_id": 77,
                    "category_name": "Sales refund",
                    "payment_type_name": "Cash",
                    "partner_name": "Walk-in",
                },
                {
                    "id": 3003,
                    "code": "PAY-3003",
                    "date": 1_717_000_050,
                    "amount": 1000,
                    "category_id": 99,
                    "category_name": "Other",
                    "payment_type_name": "Cash",
                },
            ],
            "next_offset": 0,
            "total": 3,
        },
    )
    mock_fetch_operations.return_value = ([], [])

    reg = await register_owner(client, email="dashboard-payments@test.com", company_name="Dashboard Payments")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_defaults(client, headers)

    response = await client.get(
        "/api/v1/dashboard/payments",
        headers=headers,
        params={"start_date": 1_716_000_000, "end_date": 1_718_000_000},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["income_total"] == 2
    assert data["outcome_total"] == 1
    assert data["income_payments_total"] == 40000
    assert data["outcome_payments_total"] == 5000
    assert data["income_payment_category_name"] == "Sales income"
    assert data["outcome_payment_category_name"] == "Sales refund"
    assert len(data["income_payments"]) == 2
    assert len(data["outcome_payments"]) == 1
    assert data["income_payments"][0]["code"] == "PAY-3001"
    assert data["outcome_payments"][0]["code"] == "PAY-3002"
    assert data["next_offset"] == 0


@patch("app.services.regos_dashboard.regos_products_service.get_products_by_ids", new_callable=AsyncMock)
@patch("app.services.regos_dashboard.regos_sales_service.fetch_period_operations_batch", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.fetch_period_document_lists_batch",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_overview_shares_period_data(
    mock_fetch_lists: AsyncMock,
    mock_fetch_operations: AsyncMock,
    mock_get_products_by_ids: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_fetch_lists.return_value = (
        {
            "documents": [
                {
                    "id": 1001,
                    "code": "WS-1001",
                    "date": 1_717_000_000,
                    "partner_name": "Walk-in",
                    "amount": 20000,
                    "currency": UZS,
                }
            ],
            "next_offset": 0,
            "total": 1,
        },
        {"documents": [], "next_offset": 0, "total": 0},
        {
            "documents": [
                {
                    "id": 3001,
                    "code": "PAY-3001",
                    "date": 1_717_000_000,
                    "amount": 20000,
                    "currency": UZS,
                    "category_id": 66,
                    "category_name": "Sales income",
                    "payment_type_name": "Cash",
                }
            ],
            "next_offset": 0,
            "total": 1,
        },
    )
    mock_fetch_operations.return_value = (
        [
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
        ],
        [],
    )
    mock_get_products_by_ids.return_value = [
        {
            "regos_item_id": 101,
            "code": "COLA-101",
            "name": "Cola",
            "category": "Beverages",
            "price": 10000,
        }
    ]

    reg = await register_owner(client, email="dashboard-overview@test.com", company_name="Dashboard Overview")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_defaults(client, headers)

    params = {"start_date": 1_716_000_000, "end_date": 1_718_000_000}
    response = await client.get("/api/v1/dashboard/overview", headers=headers, params=params)
    assert response.status_code == 200
    data = response.json()
    assert data["stats"]["sales_total"] == 20000
    assert data["stats"]["income_payments_total"] == 20000
    assert data["total"] == 1
    assert len(data["products"]) == 1
    assert data["products"][0]["code"] == "COLA-101"
    assert len(data["payments"]["income_payments"]) == 1
    assert data["payments"]["income_payments"][0]["code"] == "PAY-3001"
    mock_fetch_lists.assert_awaited_once()
    mock_fetch_operations.assert_awaited_once()

    products_response = await client.get("/api/v1/dashboard/products", headers=headers, params=params)
    assert products_response.status_code == 200
    assert products_response.json()["total"] == 1
    mock_fetch_lists.assert_awaited_once()
    mock_fetch_operations.assert_awaited_once()


@patch("app.services.regos_dashboard.regos_sales_service.fetch_period_operations_batch", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.fetch_period_document_lists_batch",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_stats_filters_by_stock_ids(
    mock_fetch_lists: AsyncMock,
    mock_fetch_operations: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_fetch_lists.return_value = (
        {"documents": [], "next_offset": 0, "total": 0},
        {"documents": [], "next_offset": 0, "total": 0},
        {"documents": [], "next_offset": 0, "total": 0},
    )
    mock_fetch_operations.return_value = ([], [])

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
    assert mock_fetch_lists.await_args.kwargs["stock_ids"] == [11, 22]
    assert mock_fetch_lists.await_args.kwargs["all_stocks"] is False


@patch("app.services.regos_dashboard.regos_sales_service.fetch_period_operations_batch", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.fetch_period_document_lists_batch",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_stats_filters_by_partner_ids(
    mock_fetch_lists: AsyncMock,
    mock_fetch_operations: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_fetch_lists.return_value = (
        {"documents": [], "next_offset": 0, "total": 0},
        {"documents": [], "next_offset": 0, "total": 0},
        {"documents": [], "next_offset": 0, "total": 0},
    )
    mock_fetch_operations.return_value = ([], [])

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
    assert mock_fetch_lists.await_args.kwargs["partner_ids"] == [33, 44]
    assert mock_fetch_lists.await_args.kwargs["all_partners"] is False


@patch("app.services.regos_dashboard.regos_sales_service.fetch_period_operations_batch", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.fetch_period_document_lists_batch",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_stats_multi_currency(
    mock_fetch_lists: AsyncMock,
    mock_fetch_operations: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_fetch_lists.return_value = (
        {
            "documents": [
                {
                    "id": 1001,
                    "code": "WS-1001",
                    "date": 1_717_000_000,
                    "amount": 25000,
                    "currency": UZS,
                },
                {
                    "id": 1002,
                    "code": "WS-1002",
                    "date": 1_717_000_000,
                    "amount": 100,
                    "currency": USD,
                },
            ],
            "next_offset": 0,
            "total": 2,
        },
        {"documents": [], "next_offset": 0, "total": 0},
        {
            "documents": [
                {
                    "id": 3001,
                    "code": "PAY-3001",
                    "date": 1_717_000_000,
                    "amount": 100,
                    "category_id": 66,
                    "category_name": "Sales income",
                    "payment_type_name": "USD Cash",
                    "currency": USD,
                }
            ],
            "next_offset": 0,
            "total": 1,
        },
    )
    mock_fetch_operations.return_value = ([], [])

    reg = await register_owner(client, email="dashboard-mc@test.com", company_name="Dashboard MC")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_defaults(client, headers)

    response = await client.get(
        "/api/v1/dashboard/stats",
        headers=headers,
        params={"start_date": 1_716_000_000, "end_date": 1_718_000_000},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["has_multiple_currencies"] is False
    assert data["sales_total"] == 1285000
    assert len(data["sales_by_currency"]) == 1
    assert data["sales_by_currency"][0]["amount"] == 1285000
    assert data["income_payments_total"] == 1260000
    assert data["income_payments"][0]["currency"]["code_chr"] == "USD"


@patch("app.services.regos_dashboard.regos_sales_service.fetch_period_operations_batch", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.fetch_period_document_lists_batch",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_stats_currency_filter_native_usd(
    mock_fetch_lists: AsyncMock,
    mock_fetch_operations: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_fetch_lists.return_value = (
        {
            "documents": [
                {
                    "id": 1001,
                    "code": "WS-1001",
                    "date": 1_717_000_000,
                    "amount": 25000,
                    "currency": UZS,
                },
                {
                    "id": 1002,
                    "code": "WS-1002",
                    "date": 1_717_000_000,
                    "amount": 100,
                    "currency": USD,
                },
            ],
            "next_offset": 0,
            "total": 2,
        },
        {"documents": [], "next_offset": 0, "total": 0},
        {
            "documents": [
                {
                    "id": 3001,
                    "code": "PAY-3001",
                    "date": 1_717_000_000,
                    "amount": 100,
                    "category_id": 66,
                    "category_name": "Sales income",
                    "payment_type_name": "USD Cash",
                    "currency": USD,
                }
            ],
            "next_offset": 0,
            "total": 1,
        },
    )
    mock_fetch_operations.return_value = ([], [])

    reg = await register_owner(client, email="dashboard-native-usd@test.com", company_name="Dashboard Native USD")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_defaults(client, headers)

    response = await client.get(
        "/api/v1/dashboard/stats",
        headers=headers,
        params={
            "start_date": 1_716_000_000,
            "end_date": 1_718_000_000,
            "currency_id": USD["id"],
            "currency_mode": "native",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["sales_total"] == 100
    assert data["income_payments_total"] == 100
    assert data["summary_currency"]["code_chr"] == "USD"
    assert len(data["income_payments"]) == 1


@patch("app.services.regos_dashboard.regos_sales_service.fetch_period_operations_batch", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.fetch_period_document_lists_batch",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_stats_currency_filter_all_usd(
    mock_fetch_lists: AsyncMock,
    mock_fetch_operations: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_fetch_lists.return_value = (
        {
            "documents": [
                {
                    "id": 1001,
                    "code": "WS-1001",
                    "date": 1_717_000_000,
                    "amount": 12600,
                    "currency": UZS,
                },
                {
                    "id": 1002,
                    "code": "WS-1002",
                    "date": 1_717_000_000,
                    "amount": 100,
                    "currency": USD,
                },
            ],
            "next_offset": 0,
            "total": 2,
        },
        {"documents": [], "next_offset": 0, "total": 0},
        {"documents": [], "next_offset": 0, "total": 0},
    )
    mock_fetch_operations.return_value = ([], [])

    reg = await register_owner(client, email="dashboard-all-usd@test.com", company_name="Dashboard All USD")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_defaults(client, headers)

    response = await client.get(
        "/api/v1/dashboard/stats",
        headers=headers,
        params={
            "start_date": 1_716_000_000,
            "end_date": 1_718_000_000,
            "currency_id": USD["id"],
            "currency_mode": "all",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["sales_total"] == 101
    assert data["summary_currency"]["code_chr"] == "USD"


def test_convert_base_cost_for_display_usd() -> None:
  assert _convert_base_cost_for_display(120_000, {"id": 2, "code_chr": "USD", "exchange_rate": 12_000}) == 10.0
  assert _convert_base_cost_for_display(120_000, {"id": 44, "code_chr": "UZS", "exchange_rate": 1}) == 120_000.0


@patch("app.services.regos_dashboard.regos_sales_service.fetch_period_operations_batch", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.fetch_period_document_lists_batch",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_stats_converts_cost_to_usd(
    mock_fetch_lists: AsyncMock,
    mock_fetch_operations: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_fetch_lists.return_value = (
        {
            "documents": [
                {
                    "id": 1001,
                    "code": "WS-1001",
                    "date": 1_717_000_000,
                    "amount": 100,
                    "currency": USD,
                }
            ],
            "next_offset": 0,
            "total": 1,
        },
        {"documents": [], "next_offset": 0, "total": 0},
        {"documents": [], "next_offset": 0, "total": 0},
    )
    mock_fetch_operations.return_value = (
        [
            {
                "id": 5001,
                "document_id": 1001,
                "item_id": 101,
                "item_name": "Cola",
                "quantity": 1,
                "price": 100,
                "amount": 100,
                "last_purchase_cost": 120_000,
            }
        ],
        [],
    )

    reg = await register_owner(client, email="dashboard-cost-usd@test.com", company_name="Dashboard Cost USD")
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_defaults(client, headers)

    response = await client.get(
        "/api/v1/dashboard/stats",
        headers=headers,
        params={
            "start_date": 1_716_000_000,
            "end_date": 1_718_000_000,
            "currency_id": USD["id"],
            "currency_mode": "native",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["cost_total"] == 9.52
    assert data["gross_profit"] == round(100 - 9.52, 2)
    assert data["summary_currency"]["code_chr"] == "USD"


def test_map_payment_document_currency_from_type_account() -> None:
    mapped = _map_payment_document(
        {
            "id": 3001,
            "code": "PAY-3001",
            "date": 1_717_000_000,
            "amount": 50,
            "exchange_rate": 12600,
            "category": {"id": 66, "name": "Sales income"},
            "partner": {"id": 33, "name": "Walk-in"},
            "attached_user": {"id": 7, "full_name": "Cashier One"},
            "type": {
                "name": "USD Cash",
                "account": {"currency": USD},
            },
        }
    )
    assert mapped["currency"]["code_chr"] == "USD"
    assert mapped["exchange_rate"] == 12600
    assert mapped["category_name"] == "Sales income"
    assert mapped["partner_name"] == "Walk-in"
    assert mapped["attached_user_name"] == "Cashier One"


async def _employee_headers(
    client: AsyncClient,
    owner_headers: dict,
    *,
    login: str = "dashboard-scoped",
) -> dict:
    await client.post(
        "/api/v1/users",
        headers=owner_headers,
        json={
            "login": login,
            "password": "employee123",
            "display_name": "Dashboard Scoped",
            "role": "employee",
            "permission_rules": [{"code": "dashboard.read", "effect": "allow"}],
        },
    )
    emp_login = await client.post(
        "/api/v1/auth/login",
        json={"login": login, "password": "employee123"},
    )
    return {"Authorization": f"Bearer {emp_login.json()['access_token']}"}


@patch("app.services.regos_dashboard.regos_sales_service.fetch_period_operations_batch", new_callable=AsyncMock)
@patch(
    "app.services.regos_dashboard.regos_sales_service.fetch_period_document_lists_batch",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_dashboard_stats_scoped_to_default_warehouse_without_change_permission(
    mock_fetch_lists: AsyncMock,
    mock_fetch_operations: AsyncMock,
    client: AsyncClient,
) -> None:
    mock_fetch_lists.return_value = (
        {"documents": [], "next_offset": 0, "total": 0},
        {"documents": [], "next_offset": 0, "total": 0},
        {"documents": [], "next_offset": 0, "total": 0},
    )
    mock_fetch_operations.return_value = ([], [])

    reg = await register_owner(
        client, email="dashboard-scoped@test.com", company_name="Dashboard Scoped Co"
    )
    owner_headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    await _configure_defaults(client, owner_headers)
    emp_headers = await _employee_headers(client, owner_headers)

    response = await client.get(
        "/api/v1/dashboard/stats",
        headers=emp_headers,
        params={"all_stocks": "true"},
    )
    assert response.status_code == 200
    assert mock_fetch_lists.await_args.kwargs["stock_ids"] == [11]
    assert mock_fetch_lists.await_args.kwargs["all_stocks"] is False
