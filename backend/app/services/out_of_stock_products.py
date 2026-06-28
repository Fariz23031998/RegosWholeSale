from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import OutOfStockProduct


async def record_out_of_stock(
    session: AsyncSession,
    company_id: int,
    product_id: int,
    stock_id: int,
) -> OutOfStockProduct:
    row = OutOfStockProduct(
        company_id=company_id,
        product_id=product_id,
        stock_id=stock_id,
    )
    session.add(row)
    await session.flush()
    return row


async def clean_out_of_stock_products(
    session: AsyncSession,
    *,
    retention_days: int = 7,
) -> int:
    expire_before = datetime.now(UTC) - timedelta(days=retention_days)
    result = await session.execute(
        delete(OutOfStockProduct).where(OutOfStockProduct.created_at < expire_before)
    )
    return int(result.rowcount or 0)


async def list_out_of_stock_entries(
    session: AsyncSession,
    company_id: int,
    *,
    stock_ids: list[int] | None = None,
    all_stocks: bool = True,
) -> list[OutOfStockProduct]:
    query = (
        select(OutOfStockProduct)
        .where(OutOfStockProduct.company_id == company_id)
        .order_by(OutOfStockProduct.created_at.desc())
    )
    if not all_stocks and stock_ids:
        query = query.where(OutOfStockProduct.stock_id.in_(stock_ids))
    result = await session.execute(query)
    return list(result.scalars().all())


async def delete_out_of_stock_entries(
    session: AsyncSession,
    company_id: int,
    product_id: int,
    stock_id: int,
) -> int:
    result = await session.execute(
        delete(OutOfStockProduct).where(
            OutOfStockProduct.company_id == company_id,
            OutOfStockProduct.product_id == product_id,
            OutOfStockProduct.stock_id == stock_id,
        )
    )
    return int(result.rowcount or 0)
