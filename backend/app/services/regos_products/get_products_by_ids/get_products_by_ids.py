from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.exceptions import bad_request
from app.core.regos_api import regos_async_api_request_for_company
from app.services import regos_defaults as regos_defaults_service
from app.services.regos_products.helpers.map_product.map_product import map_product
from app.services.regos_prices.fetch_item_prices.fetch_item_prices import fetch_item_prices

async def get_products_by_ids(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    product_ids: list[int],
    *,
    warehouse_id: int | None = None,
    price_type_id: int | None = None,
) -> list[dict[str, Any]]:
    unique_ids = [product_id for product_id in dict.fromkeys(product_ids) if product_id > 0]
    if not unique_ids:
        return []

    defaults = await regos_defaults_service.apply_regos_session_overrides(
        session,
        company_id,
        user_id,
        warehouse_id=warehouse_id,
        price_type_id=price_type_id,
    )
    warehouse = defaults.get("warehouse")
    price_type = defaults.get("price_type")
    if not warehouse:
        raise bad_request(
            "Default warehouse is not configured. Save it in Settings first.",
            "REGOS_DEFAULT_WAREHOUSE_NOT_CONFIGURED",
        )
    if not price_type:
        raise bad_request(
            "Default price type is not configured. Save it in Settings first.",
            "REGOS_DEFAULT_PRICE_TYPE_NOT_CONFIGURED",
        )

    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "item/getext",
        {
            "stock_id": warehouse["id"],
            "price_type_id": price_type["id"],
            "ids": unique_ids,
            "sort_orders": [{"column": "Name", "direction": "ASC"}],
            "zero_quantity": True,
            "zero_price": True,
            "image_size": "Medium",
            "type": "Item",
            "deleted_mark": False,
            "limit": len(unique_ids),
            "offset": 0,
        },
    )
    result = response.get("result") or []

    # Fetch fresh prices from itemprice/get
    fresh_prices = await fetch_item_prices(session, company_id, unique_ids, price_type["id"])

    by_id: dict[int, dict[str, Any]] = {}
    for row in result:
        if not isinstance(row, dict):
            continue
        try:
            product = map_product(row)
        except Exception:
            continue

        # Override price if found in fresh_prices
        p_id = product["regos_item_id"]
        if p_id in fresh_prices:
            product["price"] = fresh_prices[p_id]

        by_id[int(product["regos_item_id"])] = product

    return [by_id[product_id] for product_id in unique_ids if product_id in by_id]
