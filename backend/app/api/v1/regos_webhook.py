import logging

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services import regos_webhook as regos_webhook_service

logger = logging.getLogger("regos.backend")

router = APIRouter(tags=["regos-webhook"])


@router.post("/regos/webhook")
async def regos_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_db),
) -> dict:
    try:
        webhook_data = await request.json()
    except Exception:
        return {"ok": False, "error": "Invalid JSON body"}

    try:
        return await regos_webhook_service.handle_regos_webhook(
            session,
            webhook_data,
            background_tasks=background_tasks,
        )
    except Exception:
        logger.error("Error processing REGOS webhook", exc_info=True)
        return {"ok": False, "error": "Internal error"}
