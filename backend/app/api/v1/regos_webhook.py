import logging
import re

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request
from app.database import get_db
from app.services import regos_webhook as regos_webhook_service

logger = logging.getLogger("regos.backend")

router = APIRouter(tags=["regos-webhook"])

_INTEGRATION_TOKEN_RE = re.compile(r"^[a-f0-9]{32}$", re.IGNORECASE)


@router.get("/regos/webhook/{token}")
async def regos_integration_login_redirect(token: str) -> RedirectResponse:
    """Regos Integration Catalog opens this URL with the connected token."""
    if not _INTEGRATION_TOKEN_RE.fullmatch(token):
        raise bad_request("Invalid Regos integration token", "INVALID_REGOS_TOKEN")
    return RedirectResponse(
        url=f"/integration/callback/{token.lower()}",
        status_code=302,
    )


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
