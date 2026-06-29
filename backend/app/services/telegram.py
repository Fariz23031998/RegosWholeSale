import asyncio
import logging
import uuid
from collections.abc import Callable
from typing import Any

import aiohttp
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import AppError, bad_request, not_found
from app.models import TelegramBot, TelegramUser
from app.services.subscriptions import is_subscription_active
from app.services.telegram_i18n import t
from app.services.telegram_languages import default_receipt_language, resolve_receipt_language
from app.services.telegram_notifications import (
    default_notification_types,
    normalize_notification_types,
    user_receives_notification,
)
from app.services.telegram_notification_scope import (
    NotificationScope,
    normalize_scope_ids,
    subscriber_configured_stock_ids,
    subscriber_matches_scope,
)

logger = logging.getLogger("regos.backend")

TELEGRAM_API_BASE = "https://api.telegram.org"
TELEGRAM_MESSAGE_MAX_LENGTH = 4096
TELEGRAM_MAX_FORMATTING_ENTITIES = 100
TELEGRAM_SAFE_FORMATTING_ENTITIES = 90
TELEGRAM_CHUNK_SEND_DELAY_SECONDS = 0.05
OUT_OF_STOCK_EXCEL_CALLBACK = "oos_excel"
WEBHOOK_ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"]
GROUP_CHAT_TYPES = frozenset({"group", "supergroup"})
BOT_MEMBER_STATUSES = frozenset({"member", "administrator"})
BOT_REMOVED_STATUSES = frozenset({"left", "kicked"})
UNLINKED_GROUP_TELEGRAM_USER_ID = 0


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


async def _company_subscription_allows_notifications(
    session: AsyncSession,
    company_id: int,
) -> bool:
    from app.models import Company

    company = await session.get(Company, company_id)
    if company is None:
        return False
    if not is_subscription_active(company):
        logger.info(
            "Skipping Telegram notifications for company %s (subscription inactive: %s)",
            company_id,
            company.subscription_status.value,
        )
        return False
    return True


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
        "stock_ids": normalize_scope_ids(row.stock_ids),
        "cashier_ids": normalize_scope_ids(row.cashier_ids),
        "created_at": row.created_at,
    }


async def list_telegram_users(session: AsyncSession, company_id: int) -> list[dict]:
    result = await session.execute(
        select(TelegramUser)
        .where(TelegramUser.company_id == company_id)
        .order_by(TelegramUser.created_at.desc())
    )
    return [telegram_user_to_dict(row) for row in result.scalars().all()]


def _is_group_subscriber(subscriber: TelegramUser) -> bool:
    return subscriber.chat_type in GROUP_CHAT_TYPES


def select_notification_recipients(
    subscribers: list[TelegramUser],
    notification_type: str,
    scope: NotificationScope | None = None,
) -> list[TelegramUser]:
    """Pick who receives a broadcast without duplicate delivery.

    - Each chat_id receives at most one message.
    - When the same person is active on both private chat and a group they
      registered (/start in group), only the group receives the notification.
    """
    eligible = [
        subscriber
        for subscriber in subscribers
        if user_receives_notification(subscriber.notification_types, notification_type)
        and subscriber_matches_scope(subscriber, scope)
    ]
    if not eligible:
        return []

    linked_group_by_user_id: dict[int, TelegramUser] = {}
    for subscriber in eligible:
        if (
            _is_group_subscriber(subscriber)
            and subscriber.telegram_user_id > UNLINKED_GROUP_TELEGRAM_USER_ID
        ):
            linked_group_by_user_id[subscriber.telegram_user_id] = subscriber

    selected: list[TelegramUser] = []
    seen_chat_ids: set[int] = set()

    def add_recipient(subscriber: TelegramUser) -> None:
        if subscriber.chat_id in seen_chat_ids:
            return
        selected.append(subscriber)
        seen_chat_ids.add(subscriber.chat_id)

    for subscriber in eligible:
        if _is_group_subscriber(subscriber):
            add_recipient(subscriber)

    for subscriber in eligible:
        if _is_group_subscriber(subscriber):
            continue
        if subscriber.telegram_user_id in linked_group_by_user_id:
            continue
        add_recipient(subscriber)

    return selected


def telegram_text_units(text: str) -> int:
    """Telegram counts message length in UTF-16 code units."""
    return len(text.encode("utf-16-le")) // 2


def _estimate_markdown_entities(text: str) -> int:
    count = 0
    index = 0
    length = len(text)
    while index < length:
        if text[index] != "*":
            index += 1
            continue
        end = text.find("*", index + 1)
        if end == -1:
            break
        count += 1
        index = end + 1
    return count


def _fit_chunk_entity_limit(chunk: str, max_entities: int) -> str:
    candidate = chunk
    while _estimate_markdown_entities(candidate) > max_entities:
        split_at = candidate.rfind("\n", 0, max(0, len(candidate) - 1))
        if split_at < 0:
            return candidate[:1] if candidate else candidate
        next_candidate = candidate[: split_at + 1]
        if next_candidate == candidate:
            return candidate[:1] if candidate else candidate
        candidate = next_candidate
    return candidate


def _largest_prefix_within_units(text: str, max_units: int) -> int:
    if telegram_text_units(text) <= max_units:
        return len(text)

    lo, hi = 1, len(text)
    best = 0
    while lo <= hi:
        mid = (lo + hi) // 2
        if telegram_text_units(text[:mid]) <= max_units:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1

    return best if best > 0 else 1


def split_telegram_message(text: str, max_length: int = TELEGRAM_MESSAGE_MAX_LENGTH) -> list[str]:
    if max_length <= 0:
        raise ValueError("max_length must be positive")

    chunks: list[str] = []
    remaining = text
    while remaining:
        if (
            telegram_text_units(remaining) <= max_length
            and _estimate_markdown_entities(remaining) <= TELEGRAM_SAFE_FORMATTING_ENTITIES
        ):
            chunks.append(remaining)
            break

        if telegram_text_units(remaining) <= max_length:
            chunk = _fit_chunk_entity_limit(remaining, TELEGRAM_SAFE_FORMATTING_ENTITIES)
            if chunk == remaining or not chunk:
                chunk = remaining[:1]
        else:
            split_idx = _largest_prefix_within_units(remaining, max_length)
            window = remaining[:split_idx]
            split_at = window.rfind("\n")
            if split_at >= 0:
                chunk = remaining[: split_at + 1]
            else:
                chunk = window
            if not chunk:
                chunk = remaining[:1]
            chunk = _fit_chunk_entity_limit(chunk, TELEGRAM_SAFE_FORMATTING_ENTITIES)
            if not chunk:
                chunk = remaining[:1]

        chunks.append(chunk)
        remaining = remaining[len(chunk) :]

    return chunks


def _telegram_error_detail(exc: AppError) -> str:
    detail = exc.detail
    if isinstance(detail, dict):
        return str(detail.get("detail", detail))
    return str(detail)


def _telegram_flood_retry_seconds(description: str) -> float | None:
    lowered = description.lower()
    if "retry after" not in lowered and "flood" not in lowered:
        return None
    digits = "".join(ch if ch.isdigit() else " " for ch in description).split()
    if not digits:
        return 1.0
    try:
        return max(float(digits[0]), 1.0)
    except ValueError:
        return 1.0


async def _send_message_chunk(
    bot_token: str,
    payload: dict[str, Any],
    parse_mode: str | None,
) -> None:
    chunk_payload = dict(payload)
    if parse_mode:
        chunk_payload["parse_mode"] = parse_mode
    await _telegram_api_call(bot_token, "sendMessage", chunk_payload)


async def _send_chunk_with_retries(
    bot_token: str,
    payload: dict[str, Any],
    parse_mode: str | None,
    *,
    chat_id: int,
    chunk_index: int,
    chunk_count: int,
) -> None:
    modes: list[str | None] = [parse_mode, None] if parse_mode else [None]
    last_error: AppError | None = None

    for mode in modes:
        for flood_attempt in range(2):
            try:
                await _send_message_chunk(bot_token, payload, mode)
                return
            except AppError as exc:
                last_error = exc
                description = _telegram_error_detail(exc)
                logger.warning(
                    "Telegram sendMessage failed for chat %s chunk %s/%s: %s",
                    chat_id,
                    chunk_index,
                    chunk_count,
                    description,
                )
                flood_delay = _telegram_flood_retry_seconds(description)
                if flood_delay is not None and flood_attempt == 0:
                    await asyncio.sleep(flood_delay)
                    continue
                break

    if last_error is not None:
        raise last_error


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
            if index > 0 and TELEGRAM_CHUNK_SEND_DELAY_SECONDS > 0:
                await asyncio.sleep(TELEGRAM_CHUNK_SEND_DELAY_SECONDS)

            payload: dict[str, Any] = {
                "chat_id": chat_id,
                "text": chunk,
            }
            if reply_markup is not None and index == 0:
                payload["reply_markup"] = reply_markup

            await _send_chunk_with_retries(
                bot_token,
                payload,
                parse_mode,
                chat_id=chat_id,
                chunk_index=index + 1,
                chunk_count=len(chunks),
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
    *,
    scope: NotificationScope | None = None,
) -> int:
    if not await _company_subscription_allows_notifications(session, company_id):
        return 0

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
    recipients = select_notification_recipients(users, "out_of_stock", scope=scope)
    for user in recipients:
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

        report = await oos_service.get_out_of_stock_report(
            session,
            bot.company_id,
            stock_ids=subscriber_configured_stock_ids(row) or None,
            all_stocks=not subscriber_configured_stock_ids(row),
        )
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
    scope: NotificationScope | None = None,
) -> int:
    if not await _company_subscription_allows_notifications(session, company_id):
        return 0

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
    recipients = select_notification_recipients(users, notification_type, scope=scope)
    for user in recipients:
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
            row.telegram_user_id = sender_id
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
            telegram_user_id=UNLINKED_GROUP_TELEGRAM_USER_ID,
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
    stock_ids: list[int] | None = None,
    cashier_ids: list[int] | None = None,
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
    if stock_ids is not None:
        row.stock_ids = normalize_scope_ids(stock_ids)
    if cashier_ids is not None:
        row.cashier_ids = normalize_scope_ids(cashier_ids)

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
