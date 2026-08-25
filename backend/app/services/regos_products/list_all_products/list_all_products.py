from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession

async def list_all_products(
    session: AsyncSession,
    company_id: int,
    *,
    user_id: int,
    page_size: int = 200,
) -> list[dict[str, Any]]:
    from app.services.regos_products.list_products.list_products import list_products

    all_products: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = await list_products(
            session,
            company_id,
            offset=offset,
            limit=page_size,
            user_id=user_id,
            include_zero_quantity=True,
            include_zero_price=True,
        )
        all_products.extend(page["products"])
        next_offset = int(page.get("next_offset") or 0)
        if next_offset <= offset:
            break
        offset = next_offset
    return all_products
