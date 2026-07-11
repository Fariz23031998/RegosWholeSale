from typing import Any
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.regos_api import regos_async_api_request_for_company
from app.services.regos_products.helpers.coerce_number.coerce_number import coerce_number

logger = logging.getLogger("regos.backend")

async def fetch_item_prices(
    session: AsyncSession,
    company_id: int,
    item_ids: list[int],
    price_type_id: int,
) -> dict[int, float]:
    if not item_ids or not price_type_id:
        return {}

    try:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            "itemprice/get",
            {
                "item_ids": item_ids,
                "price_type_ids": [price_type_id],
            },
        )
        result = response.get("result") or []
        
        prices = {}
        for item_price in result:
            if not isinstance(item_price, dict):
                continue
            i_id = item_price.get("item_id")
            val = item_price.get("value")
            pt = item_price.get("price_type")
            pt_id = pt.get("id") if isinstance(pt, dict) else None
            
            if isinstance(i_id, int) and val is not None:
                if pt_id is None or pt_id == price_type_id:
                    prices[i_id] = coerce_number(val)
        return prices
    except Exception as exc:
        logger.warning("Failed to fetch item prices via itemprice/get: %s", exc, exc_info=True)
        return {}
