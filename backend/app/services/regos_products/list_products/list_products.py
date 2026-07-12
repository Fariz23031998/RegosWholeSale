from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.exceptions import AppError, bad_request
from app.services import regos_defaults as regos_defaults_service

from app.services.regos_products.helpers.catalog_sort_orders.catalog_sort_orders import catalog_sort_orders
from app.services.regos_products.helpers.regos_page_size.regos_page_size import regos_page_size
from app.services.regos_products.helpers.next_regos_offset.next_regos_offset import next_regos_offset
from app.services.regos_products.helpers.regos_scan_cursor.regos_scan_cursor import regos_scan_cursor
from app.services.regos_products.helpers.can_scan_more_regos.can_scan_more_regos import can_scan_more_regos
from app.services.regos_products.helpers.search_page_exhausted.search_page_exhausted import search_page_exhausted
from app.services.regos_products.helpers.client_next_offset.client_next_offset import client_next_offset
from app.services.regos_products.helpers.client_list_total.client_list_total import client_list_total
from app.services.regos_products.helpers.map_product.map_product import map_product
from app.services.regos_products.helpers.matches_product_filters.matches_product_filters import matches_product_filters
from app.services.regos_prices.fetch_item_prices.fetch_item_prices import fetch_item_prices

MAX_REGOS_PAGES_PER_REQUEST = 100

async def list_products(
    session: AsyncSession,
    company_id: int,
    *,
    offset: int,
    limit: int,
    search: str | None = None,
    group_id: int | None = None,
    featured_only: bool = False,
    user_id: int | None = None,
    warehouse_id: int | None = None,
    price_type_id: int | None = None,
    include_zero_quantity: bool | None = None,
    include_zero_price: bool | None = None,
    sort_column: str | None = None,
    sort_direction: str | None = None,
) -> dict[str, Any]:
    from app.services.regos_products import regos_async_api_request_for_company

    search_term = search.strip() if search and search.strip() else None
    global_search = search_term is not None

    if featured_only and not global_search:
        if user_id is None:
            raise bad_request("User is required for featured products.", "FEATURED_USER_REQUIRED")
        from app.services.regos_products.list_featured_products.list_featured_products import list_featured_products
        return await list_featured_products(
            session,
            company_id,
            user_id,
            offset=offset,
            limit=limit,
            search=search,
            warehouse_id=warehouse_id,
            price_type_id=price_type_id,
        )

    if user_id is None:
        defaults = await regos_defaults_service.get_regos_defaults(session, company_id)
    else:
        defaults = await regos_defaults_service.apply_regos_session_overrides(
            session,
            company_id,
            user_id,
            warehouse_id=warehouse_id,
            price_type_id=price_type_id,
        )
    warehouse = defaults.get("warehouse")
    price_type = defaults.get("price_type")
    include_zero_quantity = (
        include_zero_quantity
        if include_zero_quantity is not None
        else bool(defaults.get("zero_quantity", False))
    )
    include_zero_price = (
        include_zero_price
        if include_zero_price is not None
        else bool(defaults.get("zero_price", False))
    )

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
        "sort_orders": catalog_sort_orders(sort_column, sort_direction),
        "zero_quantity": include_zero_quantity,
        "zero_price": include_zero_price,
        "image_size": "Medium",
        "type": "Item",
        "deleted_mark": False,
    }
    if search_term:
        payload["search"] = search_term
    if group_id is not None and not global_search:
        payload["group_ids"] = [group_id]

    collected: list[dict[str, Any]] = []
    current_offset = offset
    total = 0
    r_page_size = regos_page_size(limit)
    last_scan_cursor = offset
    last_page_result_count = 0

    for _ in range(MAX_REGOS_PAGES_PER_REQUEST):
        if len(collected) >= limit:
            break

        response = await regos_async_api_request_for_company(
            session,
            company_id,
            "item/getext",
            {
                **payload,
                "limit": r_page_size,
                "offset": current_offset,
            },
        )
        result = response.get("result") or []
        result_count = len(result)
        regos_total = int(response.get("total") or 0)
        if regos_total > 0:
            total = regos_total
        page_next_offset = max(0, int(response.get("next_offset") or 0))

        rows_consumed = 0
        for row in result:
            rows_consumed += 1
            if not isinstance(row, dict):
                continue
            try:
                product = map_product(row)
            except AppError:
                continue
            if matches_product_filters(
                product,
                include_zero_quantity=include_zero_quantity,
                include_zero_price=include_zero_price,
            ):
                collected.append(product)
                if len(collected) >= limit:
                    break

        scan_cursor = regos_scan_cursor(current_offset, rows_consumed)
        last_scan_cursor = scan_cursor
        last_page_result_count = result_count

        if len(collected) >= limit:
            break

        if result_count == 0:
            break

        if global_search and search_page_exhausted(
            collected_count=len(collected),
            limit=limit,
            last_page_result_count=result_count,
            regos_page_size=r_page_size,
        ):
            break

        next_cursor = next_regos_offset(
            current_offset, page_next_offset, result_count, total
        )
        if next_cursor <= current_offset:
            if can_scan_more_regos(
                global_search=global_search,
                collected_count=len(collected),
                limit=limit,
                result_count=result_count,
                regos_page_size=r_page_size,
                total=total,
                scan_cursor=scan_cursor,
            ):
                current_offset = current_offset + result_count
                continue
            break

        current_offset = next_cursor

    # Fetch fresh prices from itemprice/get for the collected items
    collected_item_ids = [p["regos_item_id"] for p in collected]
    if collected_item_ids:
        fresh_prices = await fetch_item_prices(session, company_id, collected_item_ids, price_type["id"])
        for product in collected:
            p_id = product["regos_item_id"]
            if p_id in fresh_prices:
                product["price"] = fresh_prices[p_id]

    return {
        "products": collected,
        "next_offset": client_next_offset(
            total=total,
            scan_cursor=last_scan_cursor,
            last_page_result_count=last_page_result_count,
            regos_page_size=r_page_size,
            collected_count=len(collected),
            limit=limit,
            global_search=global_search,
        ),
        "total": client_list_total(
            global_search=global_search,
            client_offset=offset,
            collected_count=len(collected),
            regos_total=total,
            last_page_result_count=last_page_result_count,
            regos_page_size=r_page_size,
            limit=limit,
        ),
    }
