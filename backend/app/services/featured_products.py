from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user_featured_product import UserFeaturedProduct


async def list_product_ids(session: AsyncSession, user_id: int) -> list[int]:
    result = await session.execute(
        select(UserFeaturedProduct.product_id)
        .where(UserFeaturedProduct.user_id == user_id)
        .order_by(UserFeaturedProduct.created_at.desc(), UserFeaturedProduct.id.desc())
    )
    return list(result.scalars().all())


async def add_product(session: AsyncSession, user_id: int, product_id: int) -> list[int]:
    existing = await session.execute(
        select(UserFeaturedProduct.id).where(
            UserFeaturedProduct.user_id == user_id,
            UserFeaturedProduct.product_id == product_id,
        )
    )
    if existing.scalar_one_or_none() is None:
        session.add(UserFeaturedProduct(user_id=user_id, product_id=product_id))
        await session.flush()
    return await list_product_ids(session, user_id)


async def remove_product(session: AsyncSession, user_id: int, product_id: int) -> list[int]:
    result = await session.execute(
        select(UserFeaturedProduct).where(
            UserFeaturedProduct.user_id == user_id,
            UserFeaturedProduct.product_id == product_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        await session.delete(row)
        await session.flush()
    return await list_product_ids(session, user_id)
