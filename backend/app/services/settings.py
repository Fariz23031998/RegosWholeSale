from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import not_found
from app.models import Company, User, UserSetting


async def get_company_settings(session: AsyncSession, company_id: int) -> dict[str, Any]:
    company = await session.get(Company, company_id)
    if not company:
        raise not_found("Company not found")
    return dict(company.settings or {})


async def patch_company_settings(
    session: AsyncSession, company_id: int, patch: dict[str, Any]
) -> dict[str, Any]:
    company = await session.get(Company, company_id)
    if not company:
        raise not_found("Company not found")
    current = dict(company.settings or {})
    current.update(patch)
    company.settings = current
    await session.flush()
    return current


async def get_user_settings(session: AsyncSession, user_id: int) -> dict[str, Any]:
    result = await session.execute(select(UserSetting).where(UserSetting.user_id == user_id))
    rows = result.scalars().all()
    return {row.key: row.value for row in rows}


async def patch_user_settings(
    session: AsyncSession, user: User, patch: dict[str, Any]
) -> dict[str, Any]:
    result = await session.execute(select(UserSetting).where(UserSetting.user_id == user.id))
    existing = {row.key: row for row in result.scalars().all()}
    for key, value in patch.items():
        if key in existing:
            existing[key].value = value
        else:
            session.add(UserSetting(user_id=user.id, key=key, value=value))
    await session.flush()
    return await get_user_settings(session, user.id)


async def delete_user_setting(session: AsyncSession, user: User, key: str) -> None:
    result = await session.execute(
        select(UserSetting).where(UserSetting.user_id == user.id, UserSetting.key == key)
    )
    row = result.scalar_one_or_none()
    if row is not None:
        await session.delete(row)
        await session.flush()
