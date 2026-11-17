from typing import Any
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.regos_api import regos_async_api_request_for_company
from app.services.regos_products.helpers.coerce_number.coerce_number import coerce_number

logger = logging.getLogger("regos.backend")


async def fetch_item_prices_by_types(
    session: AsyncSession,
    company_id: int,
    item_ids: list[int],
    price_type_ids: list[int],
) -> dict[int, dict[int, float]]:
    """Return {item_id: {price_type_id: price}} for the requested types."""
    unique_item_ids = [item_id for item_id in dict.fromkeys(item_ids) if item_id > 0]
    unique_type_ids = [
        price_type_id
        for price_type_id in dict.fromkeys(price_type_ids)
        if price_type_id > 0
    ]
    if not unique_item_ids or not unique_type_ids:
        return {}

    try:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            "itemprice/get",
            {
                "item_ids": unique_item_ids,
                "price_type_ids": unique_type_ids,
            },
        )
        result = response.get("result") or []

        prices: dict[int, dict[int, float]] = {}
        for item_price in result:
            if not isinstance(item_price, dict):
                continue
            i_id = item_price.get("item_id")
            val = item_price.get("value")
            pt = item_price.get("price_type")
            pt_id = pt.get("id") if isinstance(pt, dict) else None

            if not isinstance(i_id, int) or val is None:
                continue
            if pt_id is None and len(unique_type_ids) == 1:
                pt_id = unique_type_ids[0]
            if not isinstance(pt_id, int) or pt_id not in unique_type_ids:
                continue
            prices.setdefault(i_id, {})[pt_id] = coerce_number(val)
        return prices
    except Exception as exc:
        logger.warning("Failed to fetch item prices via itemprice/get: %s", exc, exc_info=True)
        return {}


async def fetch_item_prices(
    session: AsyncSession,
    company_id: int,
    item_ids: list[int],
    price_type_id: int,
) -> dict[int, float]:
    if not item_ids or not price_type_id:
        return {}

    by_types = await fetch_item_prices_by_types(
        session, company_id, item_ids, [price_type_id]
    )
    return {
        item_id: type_prices[price_type_id]
        for item_id, type_prices in by_types.items()
        if price_type_id in type_prices
    }
