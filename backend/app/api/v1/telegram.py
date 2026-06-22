import logging

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_any_permission, require_permission
from app.core.exceptions import AppError, not_found
from app.database import get_db
from app.schemas.telegram import (
    TelegramBotMessage,
    TelegramBotResponse,
    TelegramBotSaveRequest,
    TelegramUserResponse,
)
from app.services import telegram as telegram_service

logger = logging.getLogger("regos.backend")

router = APIRouter(prefix="/telegram", tags=["telegram"])


@router.get("/bot", response_model=TelegramBotResponse)
async def get_telegram_bot(
    current: CurrentUser = Depends(require_any_permission("settings.manage", "users.manage")),
    session: AsyncSession = Depends(get_db),
) -> TelegramBotResponse:
    data = await telegram_service.get_company_bot(session, current.company_id)
    return TelegramBotResponse(**data)


@router.put("/bot", response_model=TelegramBotMessage)
async def save_telegram_bot(
    body: TelegramBotSaveRequest,
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> TelegramBotMessage:
    bot = await telegram_service.register_company_bot(session, current.company_id, body.bot_token)
    return TelegramBotMessage(
        message="Telegram bot saved and webhook registered",
        bot=TelegramBotResponse(**bot),
    )


@router.delete("/bot", response_model=TelegramBotMessage)
async def delete_telegram_bot(
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> TelegramBotMessage:
    deleted = await telegram_service.delete_company_bot(session, current.company_id)
    if not deleted:
        return TelegramBotMessage(message="No Telegram bot configured")
    return TelegramBotMessage(message="Telegram bot removed successfully")


@router.get("/users", response_model=list[TelegramUserResponse])
async def list_telegram_users(
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> list[TelegramUserResponse]:
    users = await telegram_service.list_telegram_users(session, current.company_id)
    return [TelegramUserResponse(**user) for user in users]


@router.post("/webhook/{webhook_secret}")
async def telegram_webhook(
    webhook_secret: str,
    request: Request,
    session: AsyncSession = Depends(get_db),
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict[str, bool]:
    if x_telegram_bot_api_secret_token and x_telegram_bot_api_secret_token != webhook_secret:
        raise not_found("Telegram webhook not found", "TELEGRAM_WEBHOOK_NOT_FOUND")

    try:
        update = await request.json()
    except Exception:
        return {"ok": True}

    try:
        await telegram_service.handle_webhook_update(session, webhook_secret, update)
    except AppError as exc:
        if exc.code == "TELEGRAM_WEBHOOK_NOT_FOUND":
            raise
        logger.warning("Telegram webhook processing failed", exc_info=True)
    except Exception:
        logger.warning("Telegram webhook processing failed", exc_info=True)

    return {"ok": True}
