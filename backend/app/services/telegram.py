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
TELEGRAM_MESSAGE_MAX_LENGTH = 4096
OUT_OF_STOCK_EXCEL_CALLBACK = "oos_excel"
WEBHOOK_ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"]
GROUP_CHAT_TYPES = frozenset({"group", "supergroup"})
BOT_MEMBER_STATUSES = frozenset({"member", "administrator"})
BOT_REMOVED_STATUSES = frozenset({"left", "kicked"})


def _mask_token(token: str) -> str:
    trimmed = token.strip()
    if len(trimmed) <= 4:
        return "****"
    return f"****{trimmed[-4:]}"


def _webhook_url(webhook_secret: str) -> str:
    settings = get_settings()
    base = settings.telegram_webhook_base_url.strip().rstrip("/")
    return f"{base}/api/v1/telegram/webhook/{webhook_secret}"


async def _register_bot_webhook(bot_token: str, webhook_secret: str) -> None:
    await _telegram_api_call(
        bot_token,
        "setWebhook",
        {
            "url": _webhook_url(webhook_secret),
            "allowed_updates": WEBHOOK_ALLOWED_UPDATES,
            "secret_token": webhook_secret,
        },
    )


async def ensure_bot_webhook(bot: TelegramBot) -> None:
    settings = get_settings()
    if not settings.telegram_webhook_base_url.strip():
        return
    try:
        await _register_bot_webhook(bot.bot_token, bot.webhook_secret)
    except Exception:
        logger.warning(
            "Failed to ensure Telegram webhook for company %s",
            bot.company_id,
            exc_info=True,
        )


async def sync_all_bot_webhooks(session: AsyncSession) -> None:
    result = await session.execute(select(TelegramBot))
    bots = list(result.scalars().all())
    if not bots:
        return
    for bot in bots:
        await ensure_bot_webhook(bot)
    logger.info("Synced Telegram webhooks for %s bot(s)", len(bots))


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

    await _register_bot_webhook(token, webhook_secret)

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
        "chat_type": row.chat_type,
        "title": row.title,
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


def split_telegram_message(text: str, max_length: int = TELEGRAM_MESSAGE_MAX_LENGTH) -> list[str]:
    if max_length <= 0:
        raise ValueError("max_length must be positive")
    if len(text) <= max_length:
        return [text]

    chunks: list[str] = []
    remaining = text
    while remaining:
        if len(remaining) <= max_length:
            chunks.append(remaining)
            break

        window = remaining[:max_length]
        split_at = window.rfind("\n")
        if split_at >= 0:
            chunk = remaining[: split_at + 1]
        else:
            chunk = window

        chunks.append(chunk)
        remaining = remaining[len(chunk) :]

    return chunks


async def send_message(
    bot_token: str,
    chat_id: int,
    text: str,
    parse_mode: str = "Markdown",
    reply_markup: dict | None = None,
) -> bool:
    chunks = split_telegram_message(text)
    try:
        for index, chunk in enumerate(chunks):
            payload: dict[str, Any] = {
                "chat_id": chat_id,
                "text": chunk,
                "parse_mode": parse_mode,
            }
            if reply_markup is not None and index == 0:
                payload["reply_markup"] = reply_markup
            await _telegram_api_call(
                bot_token,
                "sendMessage",
                payload,
            )
        return True
    except Exception:
        logger.warning("Failed to send Telegram message to chat %s", chat_id, exc_info=True)
        return False


async def send_document(
    bot_token: str,
    chat_id: int,
    file_bytes: bytes,
    filename: str,
    *,
    caption: str | None = None,
) -> bool:
    url = f"{TELEGRAM_API_BASE}/bot{bot_token}/sendDocument"
    form = aiohttp.FormData()
    form.add_field("chat_id", str(chat_id))
    if caption:
        form.add_field("caption", caption)
    form.add_field(
        "document",
        file_bytes,
        filename=filename,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    timeout = aiohttp.ClientTimeout(total=120)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as http_session:
            async with http_session.post(url, data=form) as response:
                data = await response.json()
                if not data.get("ok"):
                    description = data.get("description", "Unknown Telegram API error")
                    logger.warning(
                        "Telegram sendDocument failed for chat %s: %s",
                        chat_id,
                        description,
                    )
                    return False
                return True
    except Exception:
        logger.warning("Failed to send Telegram document to chat %s", chat_id, exc_info=True)
        return False


def out_of_stock_excel_reply_markup(lang: str) -> dict[str, Any]:
    return {
        "inline_keyboard": [
            [
                {
                    "text": t("telegram.outOfStock.downloadExcel", lang),
                    "callback_data": OUT_OF_STOCK_EXCEL_CALLBACK,
                }
            ]
        ]
    }


async def send_out_of_stock_excel_prompt(
    session: AsyncSession,
    company_id: int,
) -> int:
    bot = await _get_bot_by_company(session, company_id)
    if not bot:
        return 0

    await ensure_bot_webhook(bot)

    result = await session.execute(
        select(TelegramUser).where(
            TelegramUser.company_id == company_id,
            TelegramUser.is_active.is_(True),
        )
    )
    users = list(result.scalars().all())
    if not users:
        return 0

    sent = 0
    for user in users:
        if not user_receives_notification(user.notification_types, "out_of_stock"):
            continue
        lang = resolve_receipt_language(user.receipt_language, user.language_code)
        if await send_message(
            bot.bot_token,
            user.chat_id,
            t("telegram.outOfStock.excelPrompt", lang),
            reply_markup=out_of_stock_excel_reply_markup(lang),
        ):
            sent += 1
    return sent


async def _get_telegram_subscriber_by_chat_id(
    session: AsyncSession,
    company_id: int,
    chat_id: int,
) -> TelegramUser | None:
    result = await session.execute(
        select(TelegramUser).where(
            TelegramUser.company_id == company_id,
            TelegramUser.chat_id == chat_id,
        )
    )
    return result.scalar_one_or_none()


async def _handle_out_of_stock_excel_callback(
    session: AsyncSession,
    bot: TelegramBot,
    callback_query: dict[str, Any],
) -> None:
    callback_id = callback_query.get("id")
    if not callback_id:
        return

    from_user = callback_query.get("from") or {}
    message = callback_query.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if chat_id is None:
        logger.warning(
            "Out-of-stock Excel callback missing chat for company %s",
            bot.company_id,
        )
        return

    row = await _get_telegram_subscriber_by_chat_id(
        session,
        bot.company_id,
        int(chat_id),
    )
    lang = resolve_receipt_language(
        row.receipt_language if row else None,
        from_user.get("language_code"),
    )

    async def answer_callback(*, text: str | None = None, show_alert: bool = False) -> None:
        payload: dict[str, Any] = {"callback_query_id": callback_id}
        if text:
            payload["text"] = text
            payload["show_alert"] = show_alert
        await _telegram_api_call(bot.bot_token, "answerCallbackQuery", payload)

    try:
        if (
            row is None
            or not row.is_active
            or not user_receives_notification(row.notification_types, "out_of_stock")
        ):
            await answer_callback(
                text=t("telegram.outOfStock.excelUnauthorized", lang),
                show_alert=True,
            )
            return

        from app.services import out_of_stock_excel as oos_excel
        from app.services import regos_out_of_stock as oos_service

        report = await oos_service.get_out_of_stock_report(session, bot.company_id)
        if not report:
            await answer_callback(
                text=t("telegram.outOfStock.excelEmpty", lang),
                show_alert=True,
            )
            return

        await answer_callback()

        sent = await send_document(
            bot.bot_token,
            int(chat_id),
            oos_excel.generate_out_of_stock_excel(report, lang=lang),
            oos_excel.out_of_stock_report_filename(),
            caption=t("telegram.outOfStock.downloadExcel", lang),
        )
        if not sent:
            await send_message(
                bot.bot_token,
                int(chat_id),
                t("telegram.outOfStock.excelSendFailed", lang),
            )
    except Exception:
        logger.exception(
            "Out-of-stock Excel callback failed for company %s chat %s",
            bot.company_id,
            chat_id,
        )
        try:
            await answer_callback(
                text=t("telegram.outOfStock.excelSendFailed", lang),
                show_alert=True,
            )
        except Exception:
            logger.warning(
                "Failed to answer out-of-stock Excel callback after error for company %s",
                bot.company_id,
                exc_info=True,
            )


async def notify_company_subscribers(
    session: AsyncSession,
    company_id: int,
    *,
    notification_type: str,
    build_message: Callable[[str], str],
    parse_mode: str = "Markdown",
    build_document: Callable[[str], tuple[bytes, str, str | None] | None] | None = None,
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
        if await send_message(
            bot.bot_token,
            user.chat_id,
            build_message(lang),
            parse_mode=parse_mode,
        ):
            sent += 1
            if build_document is not None:
                document = build_document(lang)
                if document is not None:
                    file_bytes, filename, caption = document
                    await send_document(
                        bot.bot_token,
                        user.chat_id,
                        file_bytes,
                        filename,
                        caption=caption,
                    )
    return sent


def _welcome_message_key(row: TelegramUser) -> str:
    is_group = row.chat_type in GROUP_CHAT_TYPES
    if row.is_active:
        return "telegram.welcomeGroup" if is_group else "telegram.welcome"
    return "telegram.welcomeGroupPending" if is_group else "telegram.welcomePending"


async def _upsert_telegram_subscriber(
    session: AsyncSession,
    company_id: int,
    from_user: dict[str, Any],
    chat: dict[str, Any],
) -> TelegramUser:
    chat_id = int(chat["id"])
    chat_type = chat.get("type") or "private"
    is_group = chat_type in GROUP_CHAT_TYPES

    result = await session.execute(
        select(TelegramUser).where(
            TelegramUser.company_id == company_id,
            TelegramUser.chat_id == chat_id,
        )
    )
    row = result.scalar_one_or_none()

    if is_group:
        title = chat.get("title")
        sender_id = int(from_user["id"])
        if row:
            row.title = title
            row.chat_type = chat_type
            if row.notification_types is None:
                row.notification_types = default_notification_types()
            if row.receipt_language is None:
                row.receipt_language = default_receipt_language(from_user.get("language_code"))
        else:
            row = TelegramUser(
                company_id=company_id,
                telegram_user_id=sender_id,
                chat_id=chat_id,
                chat_type=chat_type,
                title=title,
                language_code=from_user.get("language_code"),
                is_active=False,
                notification_types=default_notification_types(),
                receipt_language=default_receipt_language(from_user.get("language_code")),
            )
            session.add(row)
    elif row:
        row.telegram_user_id = int(from_user["id"])
        row.chat_type = "private"
        row.username = from_user.get("username")
        row.first_name = from_user.get("first_name")
        row.last_name = from_user.get("last_name")
        row.language_code = from_user.get("language_code")
        if row.notification_types is None:
            row.notification_types = default_notification_types()
        if row.receipt_language is None:
            row.receipt_language = default_receipt_language(from_user.get("language_code"))
    else:
        telegram_user_id = int(from_user["id"])
        row = TelegramUser(
            company_id=company_id,
            telegram_user_id=telegram_user_id,
            chat_id=chat_id,
            chat_type="private",
            username=from_user.get("username"),
            first_name=from_user.get("first_name"),
            last_name=from_user.get("last_name"),
            language_code=from_user.get("language_code"),
            is_active=False,
            notification_types=default_notification_types(),
            receipt_language=default_receipt_language(from_user.get("language_code")),
        )
        session.add(row)

    await session.flush()
    return row


async def _upsert_group_from_chat_member(
    session: AsyncSession,
    company_id: int,
    chat: dict[str, Any],
) -> TelegramUser | None:
    chat_type = chat.get("type") or ""
    if chat_type not in GROUP_CHAT_TYPES:
        return None

    chat_id = int(chat["id"])
    result = await session.execute(
        select(TelegramUser).where(
            TelegramUser.company_id == company_id,
            TelegramUser.chat_id == chat_id,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        row.title = chat.get("title")
        row.chat_type = chat_type
        if row.notification_types is None:
            row.notification_types = default_notification_types()
        if row.receipt_language is None:
            row.receipt_language = default_receipt_language(None)
    else:
        row = TelegramUser(
            company_id=company_id,
            telegram_user_id=chat_id,
            chat_id=chat_id,
            chat_type=chat_type,
            title=chat.get("title"),
            is_active=False,
            notification_types=default_notification_types(),
            receipt_language=default_receipt_language(None),
        )
        session.add(row)

    await session.flush()
    return row


async def _deactivate_subscriber_by_chat_id(
    session: AsyncSession,
    company_id: int,
    chat_id: int,
) -> None:
    row = await _get_telegram_subscriber_by_chat_id(session, company_id, chat_id)
    if row is None:
        return
    row.is_active = False
    await session.flush()


async def _handle_my_chat_member(
    session: AsyncSession,
    bot: TelegramBot,
    my_chat_member: dict[str, Any],
) -> None:
    chat = my_chat_member.get("chat") or {}
    chat_type = chat.get("type") or ""
    if chat_type not in GROUP_CHAT_TYPES:
        return

    new_member = my_chat_member.get("new_chat_member") or {}
    member_user = new_member.get("user") or {}
    if not member_user.get("is_bot"):
        return

    status = new_member.get("status") or ""
    chat_id = chat.get("id")
    if chat_id is None:
        return

    if status in BOT_MEMBER_STATUSES:
        await _upsert_group_from_chat_member(session, bot.company_id, chat)
    elif status in BOT_REMOVED_STATUSES:
        await _deactivate_subscriber_by_chat_id(session, bot.company_id, int(chat_id))


async def delete_telegram_user(
    session: AsyncSession,
    company_id: int,
    user_id: int,
) -> bool:
    result = await session.execute(
        select(TelegramUser).where(
            TelegramUser.company_id == company_id,
            TelegramUser.id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        return False

    await session.delete(row)
    await session.flush()
    return True


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

    callback_query = update.get("callback_query")
    if callback_query:
        data = callback_query.get("data")
        logger.info(
            "Telegram callback_query company=%s data=%s",
            bot.company_id,
            data,
        )
        if data == OUT_OF_STOCK_EXCEL_CALLBACK:
            await _handle_out_of_stock_excel_callback(session, bot, callback_query)
        return

    my_chat_member = update.get("my_chat_member")
    if my_chat_member:
        try:
            await _handle_my_chat_member(session, bot, my_chat_member)
        except Exception:
            logger.warning(
                "Failed to handle my_chat_member for company %s",
                bot.company_id,
                exc_info=True,
            )
        return

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

    chat_type = chat.get("type") or "private"
    if chat_type not in GROUP_CHAT_TYPES and chat_type != "private":
        return

    row = await _upsert_telegram_subscriber(session, bot.company_id, from_user, chat)

    try:
        lang = resolve_receipt_language(row.receipt_language, row.language_code)
        message_key = _welcome_message_key(row)
        await _telegram_api_call(
            bot.bot_token,
            "sendMessage",
            {
                "chat_id": chat["id"],
                "text": t(message_key, lang),
            },
        )
    except Exception:
        logger.warning(
            "Failed to send Telegram welcome message for company %s",
            bot.company_id,
            exc_info=True,
        )
