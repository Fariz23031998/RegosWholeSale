import logging
import uuid
from collections.abc import Callable
from typing import Any

import aiohttp
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import bad_request, not_found
from app.models import TelegramBot, TelegramUser
from app.services.telegram_i18n import t
from app.services.telegram_languages import default_receipt_language, resolve_receipt_language
from app.services.telegram_notifications import (
    default_notification_types,
    normalize_notification_types,
    user_receives_notification,
)

logger = logging.getLogger("regos.backend")

TELEGRAM_API_BASE = "https://api.telegram.org"


def _mask_token(token: str) -> str:
    trimmed = token.strip()
    if len(trimmed) <= 4:
        return "****"
    return f"****{trimmed[-4:]}"


def _webhook_url(webhook_secret: str) -> str:
    settings = get_settings()
    base = settings.telegram_webhook_base_url.rstrip("/")
    return f"{base}/api/v1/telegram/webhook/{webhook_secret}"


async def _telegram_api_call(bot_token: str, method: str, payload: dict | None = None) -> dict:
    url = f"{TELEGRAM_API_BASE}/bot{bot_token}/{method}"
    timeout = aiohttp.ClientTimeout(total=30)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload or {}) as response:
                data = await response.json()
                if not data.get("ok"):
                    description = data.get("description", "Unknown Telegram API error")
                    raise bad_request(description, "TELEGRAM_API_ERROR")
                return data
    except aiohttp.ClientError as exc:
        logger.error("Telegram API client error: %s", exc)
        raise bad_request(f"Telegram API request failed: {exc}", "TELEGRAM_API_ERROR") from exc


async def _get_bot_by_secret(session: AsyncSession, webhook_secret: str) -> TelegramBot | None:
    result = await session.execute(
        select(TelegramBot).where(TelegramBot.webhook_secret == webhook_secret)
    )
    return result.scalar_one_or_none()


async def _get_bot_by_company(session: AsyncSession, company_id: int) -> TelegramBot | None:
    result = await session.execute(select(TelegramBot).where(TelegramBot.company_id == company_id))
    return result.scalar_one_or_none()


def _is_start_command(text: str | None, bot_username: str | None) -> bool:
    if not text:
        return False
    normalized = text.strip().split()[0]
    if normalized == "/start":
        return True
    if bot_username and normalized == f"/start@{bot_username}":
        return True
    return normalized.startswith("/start@") and bot_username and bot_username in normalized


def bot_to_dict(row: TelegramBot) -> dict:
    return {
        "configured": True,
        "bot_username": row.bot_username,
        "token_masked": _mask_token(row.bot_token),
        "webhook_url": _webhook_url(row.webhook_secret),
    }


async def get_company_bot(session: AsyncSession, company_id: int) -> dict:
    row = await _get_bot_by_company(session, company_id)
    if not row:
        return {
            "configured": False,
            "bot_username": None,
            "token_masked": "",
            "webhook_url": None,
        }
    return bot_to_dict(row)


async def register_company_bot(session: AsyncSession, company_id: int, bot_token: str) -> dict:
    settings = get_settings()
    if not settings.telegram_webhook_base_url.strip():
        raise bad_request(
            "TELEGRAM_WEBHOOK_BASE_URL is not configured on the server",
            "TELEGRAM_WEBHOOK_NOT_CONFIGURED",
        )

    token = bot_token.strip()
    if not token:
        raise bad_request("Bot token is required", "TELEGRAM_TOKEN_REQUIRED")

    me_response = await _telegram_api_call(token, "getMe")
    bot_info = me_response.get("result", {})
    bot_username = bot_info.get("username")

    existing = await _get_bot_by_company(session, company_id)
    webhook_secret = existing.webhook_secret if existing else str(uuid.uuid4())
    webhook_url = _webhook_url(webhook_secret)

    await _telegram_api_call(
        token,
        "setWebhook",
        {
            "url": webhook_url,
            "allowed_updates": ["message"],
            "secret_token": webhook_secret,
        },
    )

    if existing:
        existing.bot_token = token
        existing.bot_username = bot_username
        row = existing
    else:
        row = TelegramBot(
            company_id=company_id,
            bot_token=token,
            bot_username=bot_username,
            webhook_secret=webhook_secret,
        )
        session.add(row)

    await session.flush()
    return bot_to_dict(row)


async def delete_company_bot(session: AsyncSession, company_id: int) -> bool:
    row = await _get_bot_by_company(session, company_id)
    if not row:
        return False

    try:
        await _telegram_api_call(row.bot_token, "deleteWebhook", {"drop_pending_updates": False})
    except Exception:
        logger.warning("Failed to delete Telegram webhook for company %s", company_id, exc_info=True)

    await session.delete(row)
    await session.flush()
    return True


def telegram_user_to_dict(row: TelegramUser) -> dict:
    return {
        "id": row.id,
        "telegram_user_id": row.telegram_user_id,
        "chat_id": row.chat_id,
        "username": row.username,
        "first_name": row.first_name,
        "last_name": row.last_name,
        "language_code": row.language_code,
        "is_active": row.is_active,
        "notification_types": sorted(normalize_notification_types(row.notification_types)),
        "receipt_language": resolve_receipt_language(row.receipt_language, row.language_code),
        "created_at": row.created_at,
    }


async def list_telegram_users(session: AsyncSession, company_id: int) -> list[dict]:
    result = await session.execute(
        select(TelegramUser)
        .where(TelegramUser.company_id == company_id)
        .order_by(TelegramUser.created_at.desc())
    )
    return [telegram_user_to_dict(row) for row in result.scalars().all()]


async def send_message(
    bot_token: str,
    chat_id: int,
    text: str,
    parse_mode: str = "Markdown",
) -> bool:
    try:
        await _telegram_api_call(
            bot_token,
            "sendMessage",
            {
                "chat_id": chat_id,
                "text": text,
                "parse_mode": parse_mode,
            },
        )
        return True
    except Exception:
        logger.warning("Failed to send Telegram message to chat %s", chat_id, exc_info=True)
        return False


async def notify_company_subscribers(
    session: AsyncSession,
    company_id: int,
    *,
    notification_type: str,
    build_message: Callable[[str], str],
) -> int:
    bot = await _get_bot_by_company(session, company_id)
    if not bot:
        logger.info("No Telegram bot configured for company %s", company_id)
        return 0

    result = await session.execute(
        select(TelegramUser).where(
            TelegramUser.company_id == company_id,
            TelegramUser.is_active.is_(True),
        )
    )
    users = list(result.scalars().all())
    if not users:
        logger.info("No active Telegram subscribers for company %s", company_id)
        return 0

    sent = 0
    for user in users:
        if not user_receives_notification(user.notification_types, notification_type):
            continue
        lang = resolve_receipt_language(user.receipt_language, user.language_code)
        if await send_message(bot.bot_token, user.chat_id, build_message(lang)):
            sent += 1
    return sent


async def _upsert_telegram_user(
    session: AsyncSession,
    company_id: int,
    from_user: dict[str, Any],
    chat_id: int,
) -> TelegramUser:
    telegram_user_id = int(from_user["id"])
    result = await session.execute(
        select(TelegramUser).where(
            TelegramUser.company_id == company_id,
            TelegramUser.telegram_user_id == telegram_user_id,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        row.chat_id = chat_id
        row.username = from_user.get("username")
        row.first_name = from_user.get("first_name")
        row.last_name = from_user.get("last_name")
        row.language_code = from_user.get("language_code")
        row.is_active = True
        if row.notification_types is None:
            row.notification_types = default_notification_types()
        if row.receipt_language is None:
            row.receipt_language = default_receipt_language(from_user.get("language_code"))
    else:
        row = TelegramUser(
            company_id=company_id,
            telegram_user_id=telegram_user_id,
            chat_id=chat_id,
            username=from_user.get("username"),
            first_name=from_user.get("first_name"),
            last_name=from_user.get("last_name"),
            language_code=from_user.get("language_code"),
            is_active=True,
            notification_types=default_notification_types(),
            receipt_language=default_receipt_language(from_user.get("language_code")),
        )
        session.add(row)
    await session.flush()
    return row


async def update_telegram_user(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    *,
    notification_types: list[str] | None = None,
    is_active: bool | None = None,
    receipt_language: str | None = None,
) -> dict | None:
    result = await session.execute(
        select(TelegramUser).where(
            TelegramUser.company_id == company_id,
            TelegramUser.id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        return None

    if notification_types is not None:
        row.notification_types = notification_types
    if is_active is not None:
        row.is_active = is_active
    if receipt_language is not None:
        row.receipt_language = receipt_language

    await session.flush()
    return telegram_user_to_dict(row)


async def handle_webhook_update(
    session: AsyncSession,
    webhook_secret: str,
    update: dict[str, Any],
) -> None:
    bot = await _get_bot_by_secret(session, webhook_secret)
    if not bot:
        raise not_found("Telegram webhook not found", "TELEGRAM_WEBHOOK_NOT_FOUND")

    message = update.get("message")
    if not message:
        return

    text = message.get("text")
    if not _is_start_command(text, bot.bot_username):
        return

    from_user = message.get("from")
    chat = message.get("chat")
    if not from_user or not chat:
        return

    row = await _upsert_telegram_user(session, bot.company_id, from_user, int(chat["id"]))

    try:
        lang = resolve_receipt_language(row.receipt_language, row.language_code)
        await _telegram_api_call(
            bot.bot_token,
            "sendMessage",
            {
                "chat_id": chat["id"],
                "text": t("telegram.welcome", lang),
            },
        )
    except Exception:
        logger.warning(
            "Failed to send Telegram welcome message for company %s",
            bot.company_id,
            exc_info=True,
        )
