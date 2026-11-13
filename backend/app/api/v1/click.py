from fastapi import APIRouter, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services import subscription_checkout as checkout_service
from fastapi import Depends

router = APIRouter(prefix="/click", tags=["click"])


@router.post("/prepare")
async def click_prepare(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> dict:
    payload = dict(await request.form())
    result = await checkout_service.click_prepare(session, payload)
    await session.commit()
    return result


@router.post("/complete")
async def click_complete(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> dict:
    payload = dict(await request.form())
    result = await checkout_service.click_complete(session, payload)
    await session.commit()
    return result
