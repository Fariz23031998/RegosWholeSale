from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.exceptions import bad_request
from app.services import regos_defaults as regos_defaults_service
from app.services.regos_products.helpers.map_product.map_product import map_product
from app.services.regos_products.helpers.matches_product_filters.matches_product_filters import matches_product_filters
from app.services.regos_prices.fetch_item_prices.fetch_item_prices import fetch_item_prices

async def list_featured_products(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    *,
    offset: int,
    limit: int,
    search: str | None = None,
    warehouse_id: int | None = None,
    price_type_id: int | None = None,
) -> dict[str, Any]:
    from app.services.regos_products import regos_async_api_request_for_company

    from app.services import featured_products as featured_products_service

    product_ids = await featured_products_service.list_product_ids(session, user_id)
    total = len(product_ids)
    if total == 0:
        return {"products": [], "next_offset": 0, "total": 0}

    page_ids = product_ids[offset : offset + limit]
    if not page_ids:
        return {"products": [], "next_offset": 0, "total": total}

    defaults = await regos_defaults_service.apply_regos_session_overrides(
        session,
        company_id,
        user_id,
        warehouse_id=warehouse_id,
        price_type_id=price_type_id,
    )
    warehouse = defaults.get("warehouse")
    price_type = defaults.get("price_type")
    include_zero_quantity = bool(defaults.get("zero_quantity", False))
    include_zero_price = bool(defaults.get("zero_price", False))

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

    payload: dict[str, Any] = {
        "stock_id": warehouse["id"],
        "price_type_id": price_type["id"],
        "ids": page_ids,
        "sort_orders": [{"column": "Name", "direction": "ASC"}],
        "zero_quantity": include_zero_quantity,
        "zero_price": include_zero_price,
        "image_size": "Medium",
        "type": "Item",
        "deleted_mark": False,
        "limit": len(page_ids),
        "offset": 0,
    }
    if search and search.strip():
        payload["search"] = search.strip()

    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "item/getext",
        payload,
    )
    result = response.get("result") or []

    by_id: dict[int, dict[str, Any]] = {}
    for row in result:
        if not isinstance(row, dict):
            continue
        product = map_product(row)
        if matches_product_filters(
            product,
            include_zero_quantity=include_zero_quantity,
            include_zero_price=include_zero_price,
        ):
            by_id[int(product["regos_item_id"])] = product

    from app.services.category_scope import get_allowed_product_group_id_set, product_in_allowed_groups

    allowed_group_ids = await get_allowed_product_group_id_set(session, user_id, company_id)
    if allowed_group_ids is not None:
        by_id = {
            item_id: product
            for item_id, product in by_id.items()
            if product_in_allowed_groups(product, allowed_group_ids)
        }

    # Fetch fresh prices from itemprice/get for the featured page items
    collected_item_ids = list(by_id.keys())
    if collected_item_ids:
        fresh_prices = await fetch_item_prices(session, company_id, collected_item_ids, price_type["id"])
        for p_id in collected_item_ids:
            if p_id in fresh_prices:
                by_id[p_id]["price"] = fresh_prices[p_id]

    products = [by_id[product_id] for product_id in page_ids if product_id in by_id]
    next_offset = offset + limit if offset + limit < total else 0

    return {
        "products": products,
        "next_offset": next_offset,
        "total": total,
    }
