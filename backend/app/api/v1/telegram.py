import logging

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_any_permission, require_permission
from app.core.exceptions import AppError, bad_request, not_found
from app.database import get_db
from app.schemas.telegram import (
    TelegramBotMessage,
    TelegramBotResponse,
    TelegramBotSaveRequest,
    TelegramNotificationTypesResponse,
    TelegramReceiptLanguagesResponse,
    TelegramUserResponse,
    TelegramUserUpdateRequest,
    all_notification_types_response,
    all_receipt_languages_response,
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


@router.get("/notification-types", response_model=TelegramNotificationTypesResponse)
async def list_telegram_notification_types(
    current: CurrentUser = Depends(require_permission("users.manage")),
) -> TelegramNotificationTypesResponse:
    return all_notification_types_response()


@router.get("/receipt-languages", response_model=TelegramReceiptLanguagesResponse)
async def list_telegram_receipt_languages(
    current: CurrentUser = Depends(require_permission("users.manage")),
) -> TelegramReceiptLanguagesResponse:
    return all_receipt_languages_response()


@router.delete("/users/{user_id}")
async def delete_telegram_user(
    user_id: int,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    deleted = await telegram_service.delete_telegram_user(
        session,
        current.company_id,
        user_id,
    )
    if not deleted:
        raise not_found("Telegram user not found", "TELEGRAM_USER_NOT_FOUND")
    return {"message": "Telegram user deleted"}


@router.patch("/users/{user_id}", response_model=TelegramUserResponse)
async def update_telegram_user(
    user_id: int,
    body: TelegramUserUpdateRequest,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> TelegramUserResponse:
    if (
        body.notification_types is None
        and body.is_active is None
        and body.receipt_language is None
        and body.stock_ids is None
        and body.cashier_ids is None
        and body.firm_ids is None
    ):
        raise bad_request("At least one field must be provided", "TELEGRAM_USER_UPDATE_EMPTY")

    updated = await telegram_service.update_telegram_user(
        session,
        current.company_id,
        user_id,
        notification_types=body.notification_types,
        is_active=body.is_active,
        receipt_language=body.receipt_language,
        stock_ids=body.stock_ids,
        cashier_ids=body.cashier_ids,
        firm_ids=body.firm_ids,
    )
    if not updated:
        raise not_found("Telegram user not found", "TELEGRAM_USER_NOT_FOUND")
    return TelegramUserResponse(**updated)


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
