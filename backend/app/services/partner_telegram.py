import logging
import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import bad_request, not_found, unauthorized
from app.models import Company, PartnerTelegramAccount, PartnerTelegramBot, PartnerTelegramLinkState
from app.schemas.partner_telegram import PORTAL_PAGE_KEYS, default_enabled_pages
from app.services import document_telegram_format as fmt
from app.services import regos_fields as regos_fields_service
from app.services import regos_groups
from app.services import regos_partners
from app.services import telegram as telegram_service
from app.services.pos_settings import _normalize_id_list
from app.services.subscriptions import is_subscription_active
from app.services.telegram_i18n import t
from app.services.telegram_languages import default_receipt_language

logger = logging.getLogger("regos.backend")

PARTNER_DOCUMENT_KINDS = frozenset(
    {"purchase", "return_purchase", "wholesale", "wholesale_return"}
)
PARTNER_LANGUAGES = frozenset({"uz", "ru", "en"})
DOCUMENT_KIND_TO_PAGE = {
    "wholesale": "purchases",
    "wholesale-return": "purchase_returns",
    "purchase": "shipments",
    "purchase-return": "shipment_returns",
}
_PHONE_SPLIT = re.compile(r"[,;]")
# Regos often stores the 9-digit national number; Telegram shares +998…
_UZ_COUNTRY_CODE = "998"
_UZ_NATIONAL_LENGTH = 9


def phone_digits(value: str | None) -> str:
    if not value:
        return ""
    return "".join(ch for ch in value if ch.isdigit())


def _phone_text(value: Any) -> str:
    if isinstance(value, bool) or value is None:
        return ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, str):
        return value
    return ""


def phone_keys(value: Any) -> set[str]:
    """Digit forms that refer to the same Uzbek number.

    A full international number and the national number stored on the partner
    are equal. A leading trunk zero is dropped. Short fragments are not
    expanded, so they cannot match a longer number by appearing inside it.
    """
    digits = phone_digits(_phone_text(value))
    if digits.startswith("0") and len(digits) == _UZ_NATIONAL_LENGTH + 1:
        digits = digits[1:]
    if not digits:
        return set()
    keys = {digits}
    international_length = len(_UZ_COUNTRY_CODE) + _UZ_NATIONAL_LENGTH
    if digits.startswith(_UZ_COUNTRY_CODE) and len(digits) == international_length:
        keys.add(digits[len(_UZ_COUNTRY_CODE) :])
    elif len(digits) == _UZ_NATIONAL_LENGTH:
        keys.add(_UZ_COUNTRY_CODE + digits)
    return keys


def partner_phone_tokens(phones: Any) -> set[str]:
    if isinstance(phones, list):
        tokens: set[str] = set()
        for part in phones:
            tokens.update(partner_phone_tokens(part))
        return tokens
    text = _phone_text(phones)
    if not text:
        return set()
    tokens = set()
    for part in _PHONE_SPLIT.split(text):
        tokens.update(phone_keys(part))
    return tokens


def matching_partners(partners: list[dict[str, Any]], phone: str) -> list[dict[str, Any]]:
    needle = phone_keys(phone)
    if not needle:
        return []
    return [
        partner
        for partner in partners
        if needle & partner_phone_tokens(partner.get("phones"))
    ]


def _mask_token(token: str) -> str:
    trimmed = token.strip()
    if len(trimmed) <= 4:
        return "****"
    return f"****{trimmed[-4:]}"


def _webhook_url(webhook_secret: str) -> str:
    settings = get_settings()
    base = settings.telegram_webhook_base_url.strip().rstrip("/")
    return f"{base}/api/v1/partner-telegram/webhook/{webhook_secret}"


def mini_app_url(public_key: str) -> str:
    """Menu-button URL from MINI_APP_LINK.

    `{public_key}` in the env value is replaced. A base URL without that
    placeholder gets `/partner/{public_key}` appended.
    """
    link = get_settings().mini_app_link.strip()
    if not link:
        return ""
    if "{public_key}" in link:
        return link.replace("{public_key}", public_key)
    base = link.rstrip("/")
    suffix = f"/partner/{public_key}"
    if base.endswith(suffix):
        return base
    return f"{base}{suffix}"


def _menu_button(public_key: str, text: str | None = None) -> dict[str, Any]:
    return {
        "menu_button": {
            "type": "web_app",
            "text": text or t("partnerTelegram.menuButton", "en"),
            "web_app": {"url": mini_app_url(public_key)},
        }
    }


async def _set_chat_menu_button(
    bot: PartnerTelegramBot,
    *,
    lang: str = "en",
    chat_id: int | None = None,
    best_effort: bool = False,
) -> None:
    url = mini_app_url(bot.public_key)
    if not url:
        return
    payload = _menu_button(bot.public_key, t("partnerTelegram.menuButton", lang))
    if chat_id is not None:
        payload["chat_id"] = chat_id
    try:
        await telegram_service._telegram_api_call(
            bot.bot_token,
            "setChatMenuButton",
            payload,
        )
    except Exception:
        if not best_effort:
            raise
        logger.warning(
            "Failed to set partner bot menu button company=%s chat_id=%s",
            bot.company_id,
            chat_id,
            exc_info=True,
        )


def _require_public_urls() -> None:
    settings = get_settings()
    if not settings.telegram_webhook_base_url.strip():
        raise bad_request(
            "TELEGRAM_WEBHOOK_BASE_URL is not configured on the server",
            "TELEGRAM_WEBHOOK_NOT_CONFIGURED",
        )
    if not settings.mini_app_link.strip():
        raise bad_request(
            "MINI_APP_LINK is not configured on the server",
            "MINI_APP_LINK_NOT_CONFIGURED",
        )


async def _get_bot_by_company(
    session: AsyncSession, company_id: int
) -> PartnerTelegramBot | None:
    result = await session.execute(
        select(PartnerTelegramBot).where(PartnerTelegramBot.company_id == company_id)
    )
    return result.scalar_one_or_none()


async def _get_bot_by_secret(
    session: AsyncSession, webhook_secret: str
) -> PartnerTelegramBot | None:
    result = await session.execute(
        select(PartnerTelegramBot).where(PartnerTelegramBot.webhook_secret == webhook_secret)
    )
    return result.scalar_one_or_none()


async def _get_bot_by_public_key(
    session: AsyncSession, public_key: str
) -> PartnerTelegramBot | None:
    result = await session.execute(
        select(PartnerTelegramBot).where(PartnerTelegramBot.public_key == public_key)
    )
    return result.scalar_one_or_none()


def _balance_notify_templates(value: Any) -> dict[str, str]:
    source = value if isinstance(value, dict) else {}
    templates: dict[str, str] = {}
    for lang in ("uz", "ru", "en"):
        raw = source.get(lang, "")
        templates[lang] = raw.strip() if isinstance(raw, str) else ""
    return templates


def _balance_notify_days(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    days: list[int] = []
    for item in value:
        if isinstance(item, bool):
            continue
        if isinstance(item, int):
            days.append(item)
        elif isinstance(item, str) and item.lstrip("-").isdigit():
            days.append(int(item))
    return days


def _normalize_enabled_pages(value: Any) -> dict[str, bool]:
    pages = default_enabled_pages()
    if isinstance(value, dict):
        for key, enabled in value.items():
            if key in pages:
                pages[key] = bool(enabled)
    return pages


def _normalize_page_overrides(value: Any) -> dict[str, bool]:
    if not isinstance(value, dict):
        return {}
    known = set(PORTAL_PAGE_KEYS)
    return {key: bool(enabled) for key, enabled in value.items() if key in known}


def resolve_enabled_pages(bot_pages: Any, overrides: Any) -> dict[str, bool]:
    base = _normalize_enabled_pages(bot_pages)
    for key, enabled in _normalize_page_overrides(overrides).items():
        base[key] = enabled
    return base


def bot_to_dict(row: PartnerTelegramBot) -> dict[str, Any]:
    return {
        "configured": True,
        "bot_username": row.bot_username,
        "token_masked": _mask_token(row.bot_token),
        "webhook_url": _webhook_url(row.webhook_secret),
        "mini_app_url": mini_app_url(row.public_key),
        "public_key": row.public_key,
        "default_warehouse_id": row.default_warehouse_id,
        "default_price_type_id": row.default_price_type_id,
        "allow_catalog_warehouse_selection": bool(row.allow_catalog_warehouse_selection),
        "allow_self_registration": bool(row.allow_self_registration),
        "show_product_quantities": bool(row.show_product_quantities),
        "show_zero_quantity": bool(row.show_zero_quantity),
        "show_zero_price": bool(row.show_zero_price),
        "auto_open_qty_keypad": bool(row.auto_open_qty_keypad),
        "default_partner_group_id": row.default_partner_group_id,
        "catalog_product_group_ids": _normalize_id_list(row.catalog_product_group_ids),
        "enabled_pages": _normalize_enabled_pages(row.enabled_pages),
        "balance_notify_enabled": bool(row.balance_notify_enabled),
        "balance_notify_time": row.balance_notify_time or "09:00",
        "balance_notify_option": row.balance_notify_option or "daily",
        "balance_notify_days": _balance_notify_days(row.balance_notify_days),
        "balance_notify_templates": _balance_notify_templates(row.balance_notify_templates),
        "order_document_type": _normalize_order_document_type(row.order_document_type),
        "order_booked": bool(row.order_booked),
    }


def _normalize_order_document_type(value: Any) -> str:
    if value == "doc_wholesale":
        return "doc_wholesale"
    return "doc_order_from_partner"


def _empty_bot() -> dict[str, Any]:
    return {
        "configured": False,
        "bot_username": None,
        "token_masked": "",
        "webhook_url": None,
        "mini_app_url": None,
        "public_key": None,
        "default_warehouse_id": None,
        "default_price_type_id": None,
        "allow_catalog_warehouse_selection": False,
        "allow_self_registration": False,
        "show_product_quantities": True,
        "show_zero_quantity": False,
        "show_zero_price": False,
        "auto_open_qty_keypad": False,
        "default_partner_group_id": None,
        "catalog_product_group_ids": [],
        "enabled_pages": default_enabled_pages(),
        "balance_notify_enabled": False,
        "balance_notify_time": "09:00",
        "balance_notify_option": "daily",
        "balance_notify_days": [],
        "balance_notify_templates": {"uz": "", "ru": "", "en": ""},
        "order_document_type": "doc_order_from_partner",
        "order_booked": True,
    }


async def get_company_bot(session: AsyncSession, company_id: int) -> dict[str, Any]:
    row = await _get_bot_by_company(session, company_id)
    if not row:
        return _empty_bot()
    return bot_to_dict(row)


async def _register_webhook_and_menu(row: PartnerTelegramBot) -> None:
    settings = get_settings()
    if settings.telegram_webhook_base_url.strip():
        await telegram_service._telegram_api_call(
            row.bot_token,
            "setWebhook",
            {
                "url": _webhook_url(row.webhook_secret),
                "allowed_updates": ["message", "callback_query"],
                "secret_token": row.webhook_secret,
            },
        )
    await _set_chat_menu_button(row, lang="en")


async def register_company_bot(
    session: AsyncSession, company_id: int, bot_token: str
) -> dict[str, Any]:
    _require_public_urls()
    token = bot_token.strip()
    if not token:
        raise bad_request("Bot token is required", "TELEGRAM_TOKEN_REQUIRED")

    me_response = await telegram_service._telegram_api_call(token, "getMe")
    bot_info = me_response.get("result", {})
    bot_username = bot_info.get("username")

    existing = await _get_bot_by_company(session, company_id)
    if existing:
        existing.bot_token = token
        existing.bot_username = bot_username
        row = existing
    else:
        row = PartnerTelegramBot(
            company_id=company_id,
            bot_token=token,
            bot_username=bot_username,
            webhook_secret=str(uuid.uuid4()),
            public_key=str(uuid.uuid4()),
        )
        session.add(row)
        await session.flush()

    await _register_webhook_and_menu(row)
    await session.flush()
    return bot_to_dict(row)


async def delete_company_bot(session: AsyncSession, company_id: int) -> bool:
    row = await _get_bot_by_company(session, company_id)
    if not row:
        return False
    try:
        await telegram_service._telegram_api_call(
            row.bot_token, "deleteWebhook", {"drop_pending_updates": False}
        )
        await telegram_service._telegram_api_call(
            row.bot_token,
            "setChatMenuButton",
            {"menu_button": {"type": "default"}},
        )
    except Exception:
        logger.warning(
            "Failed to delete partner Telegram webhook for company %s",
            company_id,
            exc_info=True,
        )
    await session.delete(row)
    await session.flush()
    return True


async def ensure_bot_webhook(bot: PartnerTelegramBot) -> None:
    settings = get_settings()
    if not settings.telegram_webhook_base_url.strip() and not settings.mini_app_link.strip():
        return
    try:
        await _register_webhook_and_menu(bot)
    except Exception:
        logger.warning(
            "Failed to ensure partner Telegram webhook for company %s",
            bot.company_id,
            exc_info=True,
        )


async def sync_all_bot_webhooks(session: AsyncSession) -> None:
    result = await session.execute(select(PartnerTelegramBot))
    bots = list(result.scalars().all())
    if not bots:
        return
    for bot in bots:
        await ensure_bot_webhook(bot)
    logger.info("Synced partner Telegram webhooks for %s bot(s)", len(bots))


def _prompt_language(language_code: str | None) -> str:
    normalized = default_receipt_language(language_code)
    if normalized in PARTNER_LANGUAGES:
        return normalized
    return "ru"


def _contact_keyboard(lang: str) -> dict[str, Any]:
    return {
        "keyboard": [
            [{"text": t("partnerTelegram.shareContact", lang), "request_contact": True}]
        ],
        "resize_keyboard": True,
        "one_time_keyboard": True,
    }


def _language_keyboard() -> dict[str, Any]:
    return {
        "inline_keyboard": [
            [
                {"text": "O'zbek", "callback_data": "ptlang:uz"},
                {"text": "Русский", "callback_data": "ptlang:ru"},
                {"text": "English", "callback_data": "ptlang:en"},
            ]
        ]
    }


def _remove_keyboard() -> dict[str, Any]:
    return {"remove_keyboard": True}


async def _subscription_allows(session: AsyncSession, company_id: int) -> bool:
    company = await session.get(Company, company_id)
    if company is None or not is_subscription_active(company):
        return False
    return True


async def _get_account(
    session: AsyncSession, company_id: int, telegram_user_id: int
) -> PartnerTelegramAccount | None:
    result = await session.execute(
        select(PartnerTelegramAccount).where(
            PartnerTelegramAccount.company_id == company_id,
            PartnerTelegramAccount.telegram_user_id == telegram_user_id,
        )
    )
    return result.scalar_one_or_none()


async def _send(
    bot: PartnerTelegramBot,
    chat_id: int,
    text: str,
    reply_markup: dict[str, Any] | None = None,
) -> bool:
    return await telegram_service.send_message(
        bot.bot_token,
        chat_id,
        text,
        reply_markup=reply_markup,
    )


async def handle_webhook_update(
    session: AsyncSession, webhook_secret: str, update: dict[str, Any]
) -> None:
    bot = await _get_bot_by_secret(session, webhook_secret)
    if bot is None:
        raise not_found("Telegram webhook not found", "TELEGRAM_WEBHOOK_NOT_FOUND")
    if not await _subscription_allows(session, bot.company_id):
        return

    callback = update.get("callback_query")
    if isinstance(callback, dict):
        await _handle_callback(session, bot, callback)
        return

    message = update.get("message")
    if not isinstance(message, dict):
        return
    chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
    if chat.get("type") != "private":
        return

    sender = message.get("from") if isinstance(message.get("from"), dict) else {}
    if not isinstance(sender.get("id"), int):
        return

    contact = message.get("contact")
    if isinstance(contact, dict):
        await _handle_contact(session, bot, message, sender, contact)
        return

    text = message.get("text")
    if isinstance(text, str) and text.strip().split()[0].split("@")[0] == "/start":
        await _handle_start(session, bot, message, sender)
        return

    lang = _prompt_language(sender.get("language_code") if isinstance(sender.get("language_code"), str) else None)
    await _send(
        bot,
        int(chat["id"]),
        t("partnerTelegram.needStart", lang),
        _contact_keyboard(lang),
    )


async def _handle_start(
    session: AsyncSession,
    bot: PartnerTelegramBot,
    message: dict[str, Any],
    sender: dict[str, Any],
) -> None:
    chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
    chat_id = int(chat["id"])
    lang = _prompt_language(sender.get("language_code") if isinstance(sender.get("language_code"), str) else None)
    # Some bots ignore the default menu button (e.g. BotFather override). Always attach a
    # per-chat web_app button once we know the chat, using the stored language when present.
    account = await _get_account(session, bot.company_id, int(sender["id"]))
    if account is not None:
        account.chat_id = chat_id
        menu_lang = (
            account.language_code
            if account.language_code in PARTNER_LANGUAGES
            else lang
        )
        await _set_chat_menu_button(
            bot, lang=menu_lang, chat_id=chat_id, best_effort=True
        )
    else:
        await _set_chat_menu_button(bot, lang=lang, chat_id=chat_id, best_effort=True)
    await _send(
        bot,
        chat_id,
        t("partnerTelegram.askContact", lang),
        _contact_keyboard(lang),
    )


async def _handle_contact(
    session: AsyncSession,
    bot: PartnerTelegramBot,
    message: dict[str, Any],
    sender: dict[str, Any],
    contact: dict[str, Any],
) -> None:
    chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
    chat_id = int(chat["id"])
    lang = _prompt_language(sender.get("language_code") if isinstance(sender.get("language_code"), str) else None)
    contact_user_id = contact.get("user_id")
    if contact_user_id != sender.get("id"):
        await _send(bot, chat_id, t("partnerTelegram.contactMustBeOwn", lang), _contact_keyboard(lang))
        return

    phone = contact.get("phone_number")
    if not isinstance(phone, str) or not phone_digits(phone):
        await _send(bot, chat_id, t("partnerTelegram.askContact", lang), _contact_keyboard(lang))
        return

    account = await _get_account(session, bot.company_id, int(sender["id"]))
    if account is None:
        account = PartnerTelegramAccount(
            company_id=bot.company_id,
            bot_id=bot.id,
            telegram_user_id=int(sender["id"]),
            chat_id=chat_id,
            link_state=PartnerTelegramLinkState.awaiting_language.value,
        )
        session.add(account)

    account.chat_id = chat_id
    account.bot_id = bot.id
    account.phone = phone.strip()
    account.username = sender.get("username") if isinstance(sender.get("username"), str) else None
    account.first_name = sender.get("first_name") if isinstance(sender.get("first_name"), str) else None
    account.last_name = sender.get("last_name") if isinstance(sender.get("last_name"), str) else None
    if account.link_state != PartnerTelegramLinkState.linked.value:
        account.link_state = PartnerTelegramLinkState.awaiting_language.value
        account.regos_partner_id = None
    await session.flush()

    prompt_lang = account.language_code or lang
    # Ensure the mini-app menu exists for this chat before language is confirmed.
    # Needed when the bot's default menu button cannot be changed via the API.
    await _set_chat_menu_button(
        bot, lang=prompt_lang, chat_id=chat_id, best_effort=True
    )
    await _send(bot, chat_id, t("partnerTelegram.askLanguage", prompt_lang), _language_keyboard())


async def _handle_callback(
    session: AsyncSession, bot: PartnerTelegramBot, callback: dict[str, Any]
) -> None:
    callback_id = callback.get("id")
    if isinstance(callback_id, str):
        try:
            await telegram_service._telegram_api_call(
                bot.bot_token,
                "answerCallbackQuery",
                {"callback_query_id": callback_id},
            )
        except Exception:
            logger.warning("Failed to answer partner bot callback", exc_info=True)

    data = callback.get("data")
    sender = callback.get("from") if isinstance(callback.get("from"), dict) else {}
    message = callback.get("message") if isinstance(callback.get("message"), dict) else {}
    chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
    if not isinstance(data, str) or not data.startswith("ptlang:"):
        return
    if not isinstance(sender.get("id"), int) or not isinstance(chat.get("id"), int):
        return
    if chat.get("type") != "private":
        return

    lang = data.split(":", 1)[1]
    if lang not in PARTNER_LANGUAGES:
        return

    account = await _get_account(session, bot.company_id, int(sender["id"]))
    if account is None or not account.phone:
        await _send(
            bot,
            int(chat["id"]),
            t("partnerTelegram.askContact", lang),
            _contact_keyboard(lang),
        )
        return

    account.language_code = lang
    await _set_chat_menu_button(
        bot, lang=lang, chat_id=int(chat["id"]), best_effort=True
    )
    if account.link_state == PartnerTelegramLinkState.linked.value and account.regos_partner_id:
        await session.flush()
        partner_name = await _partner_name(session, bot.company_id, account.regos_partner_id)
        await _send(
            bot,
            int(chat["id"]),
            t("partnerTelegram.alreadyLinked", lang, name=partner_name),
            _remove_keyboard(),
        )
        return

    try:
        status = await link_or_create_partner(session, bot, account)
    except Exception:
        logger.exception("Partner self-registration failed for company %s", bot.company_id)
        account.regos_partner_id = None
        account.link_state = PartnerTelegramLinkState.unlinked.value
        await session.flush()
        status = "unlinked"

    if status in {"linked", "created"} and account.regos_partner_id:
        partner_name = await _partner_name(session, bot.company_id, account.regos_partner_id)
        message_key = "partnerTelegram.registered" if status == "created" else "partnerTelegram.linked"
        await _send(
            bot,
            int(chat["id"]),
            t(message_key, lang, name=partner_name),
            _remove_keyboard(),
        )
        return

    await _send(bot, int(chat["id"]), t("partnerTelegram.unlinked", lang), _remove_keyboard())


async def _partner_name(session: AsyncSession, company_id: int, partner_id: int) -> str:
    try:
        partner = await regos_partners.get_partner_by_id(session, company_id, partner_id)
    except Exception:
        return str(partner_id)
    name = partner.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    return str(partner_id)


async def _partners_matching_phone(
    session: AsyncSession, company_id: int, phone: str
) -> list[dict[str, Any]]:
    """Find partners by phone.

    Regos search is tried first with each equivalent number, then the full
    directory. A page `total` equal to the page size must not stop the scan:
    that value is only how many rows came back.
    """
    found: dict[int, dict[str, Any]] = {}
    for query in sorted(phone_keys(phone), key=len, reverse=True):
        page = await regos_partners.list_partners(
            session, company_id, search=query, offset=0, limit=50
        )
        for partner in page.get("partners") or []:
            partner_id = partner.get("id")
            if isinstance(partner_id, int):
                found[partner_id] = partner
    searched = matching_partners(list(found.values()), phone)
    if searched:
        logger.info(
            "Partner phone search company=%s matches=%s",
            company_id,
            [item.get("id") for item in searched],
        )
        return searched
    everyone = await _list_all_partners(session, company_id)
    matches = matching_partners(everyone, phone)
    logger.info(
        "Partner phone directory scan company=%s scanned=%s matches=%s",
        company_id,
        len(everyone),
        [item.get("id") for item in matches],
    )
    return matches


async def _list_all_partners(session: AsyncSession, company_id: int) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    offset = 0
    page_size = 200
    seen_offsets: set[int] = set()
    while offset not in seen_offsets and len(collected) < 10000:
        seen_offsets.add(offset)
        page = await regos_partners.list_partners(
            session, company_id, offset=offset, limit=page_size
        )
        partners = page.get("partners") or []
        if not partners:
            break
        collected.extend(partners)
        if len(partners) < page_size:
            break
        next_offset = page.get("next_offset")
        if isinstance(next_offset, int) and next_offset > offset:
            offset = next_offset
        else:
            offset += len(partners)
    return collected


def account_to_dict(
    row: PartnerTelegramAccount,
    partner_name: str | None = None,
    *,
    bot: PartnerTelegramBot | None = None,
    bot_pages: Any = None,
) -> dict[str, Any]:
    overrides = _normalize_page_overrides(row.page_overrides)
    pages_source = bot.enabled_pages if bot is not None else bot_pages
    return {
        "id": row.id,
        "telegram_user_id": row.telegram_user_id,
        "chat_id": row.chat_id,
        "username": row.username,
        "first_name": row.first_name,
        "last_name": row.last_name,
        "phone": row.phone,
        "language_code": row.language_code,
        "regos_partner_id": row.regos_partner_id,
        "partner_name": partner_name,
        "link_state": row.link_state,
        "warehouse_id": row.warehouse_id,
        "price_type_id": row.price_type_id,
        "page_overrides": overrides,
        "enabled_pages": resolve_enabled_pages(pages_source, overrides),
        "has_password": bool(row.password_hash),
        "created_at": row.created_at,
    }


async def list_accounts(session: AsyncSession, company_id: int) -> list[dict[str, Any]]:
    bot = await _get_bot_by_company(session, company_id)
    result = await session.execute(
        select(PartnerTelegramAccount)
        .where(PartnerTelegramAccount.company_id == company_id)
        .order_by(PartnerTelegramAccount.created_at.desc())
    )
    rows = list(result.scalars().all())
    names = await _partner_names(
        session,
        company_id,
        [row.regos_partner_id for row in rows if isinstance(row.regos_partner_id, int)],
    )
    return [
        account_to_dict(
            row,
            names.get(row.regos_partner_id) if row.regos_partner_id else None,
            bot=bot,
        )
        for row in rows
    ]


_STANDARD_IMPORT_FIELDS: tuple[tuple[str, str], ...] = (
    ("oked", "OKED"),
    ("inn", "INN"),
    ("description", "Description"),
    ("phones", "Phones"),
    ("email", "Email"),
    ("address", "Address"),
    ("fullname", "Full name"),
    ("boss_name", "Boss name"),
    ("bank_name", "Bank name"),
    ("mfo", "MFO"),
    ("rs", "Bank account"),
    ("vat_index", "VAT index"),
)
_CUSTOM_FIELD_PREFIX = "field:"


def parse_telegram_user_id(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, float):
        if not value.is_integer() or value <= 0:
            return None
        return int(value)
    text = str(value).strip()
    if not text or not text.isdigit():
        return None
    parsed = int(text)
    return parsed if parsed > 0 else None


def _partner_field_raw_value(partner: dict[str, Any], field_id: str) -> Any:
    if field_id.startswith(_CUSTOM_FIELD_PREFIX):
        key = field_id[len(_CUSTOM_FIELD_PREFIX) :].strip()
        if not key:
            return None
        for item in partner.get("fields") or []:
            if isinstance(item, dict) and str(item.get("key") or "").strip() == key:
                return item.get("value")
        return None
    return partner.get(field_id)


async def list_import_fields(session: AsyncSession, company_id: int) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = [
        {"id": field_id, "label": label, "kind": "standard"}
        for field_id, label in _STANDARD_IMPORT_FIELDS
    ]
    custom = await regos_fields_service.list_partner_custom_fields(session, company_id)
    for item in custom:
        key = str(item.get("key") or "").strip()
        if not key:
            continue
        name = str(item.get("name") or "").strip() or key
        fields.append({"id": f"{_CUSTOM_FIELD_PREFIX}{key}", "label": name, "kind": "custom"})
    return fields


async def import_accounts_from_field(
    session: AsyncSession,
    company_id: int,
    field_id: str,
) -> dict[str, int]:
    bot = await _get_bot_by_company(session, company_id)
    if bot is None:
        raise bad_request(
            "Partner Telegram bot is not configured.",
            "PARTNER_TELEGRAM_BOT_NOT_CONFIGURED",
        )

    cleaned_field = field_id.strip()
    known_standard = {item[0] for item in _STANDARD_IMPORT_FIELDS}
    if cleaned_field.startswith(_CUSTOM_FIELD_PREFIX):
        custom_key = cleaned_field[len(_CUSTOM_FIELD_PREFIX) :].strip()
        if not custom_key:
            raise bad_request("Invalid import field.", "PARTNER_TELEGRAM_IMPORT_FIELD_INVALID")
    elif cleaned_field not in known_standard:
        raise bad_request("Invalid import field.", "PARTNER_TELEGRAM_IMPORT_FIELD_INVALID")

    partners = await _list_all_partners(session, company_id)
    existing = await session.execute(
        select(PartnerTelegramAccount).where(PartnerTelegramAccount.company_id == company_id)
    )
    accounts = list(existing.scalars().all())
    by_telegram = {row.telegram_user_id: row for row in accounts}
    linked_partners = {
        row.regos_partner_id: row
        for row in accounts
        if row.link_state == PartnerTelegramLinkState.linked.value
        and isinstance(row.regos_partner_id, int)
    }

    summary = {
        "created": 0,
        "already_imported": 0,
        "skipped_empty": 0,
        "skipped_invalid": 0,
        "skipped_duplicate": 0,
        "skipped_partner_linked": 0,
        "total_partners": len(partners),
    }

    for partner in partners:
        partner_id = partner.get("id")
        if not isinstance(partner_id, int) or partner_id <= 0:
            continue
        raw_value = _partner_field_raw_value(partner, cleaned_field)
        if raw_value is None or (isinstance(raw_value, str) and not raw_value.strip()):
            summary["skipped_empty"] += 1
            continue
        telegram_user_id = parse_telegram_user_id(raw_value)
        if telegram_user_id is None:
            summary["skipped_invalid"] += 1
            continue

        existing_account = by_telegram.get(telegram_user_id)
        if existing_account is not None:
            if (
                existing_account.regos_partner_id == partner_id
                and existing_account.link_state == PartnerTelegramLinkState.linked.value
            ):
                summary["already_imported"] += 1
            else:
                summary["skipped_duplicate"] += 1
            continue

        linked_account = linked_partners.get(partner_id)
        if linked_account is not None and linked_account.telegram_user_id != telegram_user_id:
            summary["skipped_partner_linked"] += 1
            continue

        phone = partner.get("phones")
        phone_text = phone.strip() if isinstance(phone, str) and phone.strip() else None
        account = PartnerTelegramAccount(
            company_id=company_id,
            bot_id=bot.id,
            telegram_user_id=telegram_user_id,
            chat_id=telegram_user_id,
            phone=phone_text,
            regos_partner_id=partner_id,
            link_state=PartnerTelegramLinkState.linked.value,
        )
        session.add(account)
        await session.flush()
        by_telegram[telegram_user_id] = account
        linked_partners[partner_id] = account
        summary["created"] += 1

    await session.flush()
    return summary


async def _partner_names(
    session: AsyncSession, company_id: int, partner_ids: list[int]
) -> dict[int, str]:
    unique = list(dict.fromkeys(partner_id for partner_id in partner_ids if partner_id > 0))
    if not unique:
        return {}
    try:
        from app.core.regos_api import regos_async_api_request_for_company

        response = await regos_async_api_request_for_company(
            session,
            company_id,
            "partner/get",
            {"ids": unique, "limit": len(unique), "offset": 0},
        )
    except Exception:
        logger.warning("Failed to load partner names for Telegram accounts", exc_info=True)
        return {}
    names: dict[int, str] = {}
    for row in response.get("result") or []:
        if not isinstance(row, dict) or not isinstance(row.get("id"), int):
            continue
        name = row.get("name")
        if isinstance(name, str) and name.strip():
            names[row["id"]] = name.strip()
    return names


async def link_or_create_partner(
    session: AsyncSession,
    bot: PartnerTelegramBot,
    account: PartnerTelegramAccount,
) -> str:
    """Link a phone to one Regos partner, or create an individual when self-registration is on."""
    matches = await _partners_matching_phone(session, bot.company_id, account.phone or "")
    if len(matches) == 1:
        partner = matches[0]
        account.regos_partner_id = int(partner["id"])
        account.link_state = PartnerTelegramLinkState.linked.value
        await session.flush()
        return "linked"
    if len(matches) > 1 or not bot.allow_self_registration:
        account.regos_partner_id = None
        account.link_state = PartnerTelegramLinkState.unlinked.value
        await session.flush()
        return "unlinked"

    group_id = bot.default_partner_group_id
    if group_id is None:
        groups = await regos_partners.list_partner_groups(session, bot.company_id)
        listed = groups.get("groups") or []
        if listed and isinstance(listed[0].get("id"), int):
            group_id = int(listed[0]["id"])
    if group_id is None:
        account.regos_partner_id = None
        account.link_state = PartnerTelegramLinkState.unlinked.value
        await session.flush()
        return "unlinked"

    name = " ".join(
        part.strip()
        for part in (account.first_name or "", account.last_name or "")
        if part and part.strip()
    )
    if not name:
        name = (account.username or "").strip() or (account.phone or "").strip() or "Partner"
    created = await regos_partners.add_partner(
        session,
        bot.company_id,
        {
            "group_id": group_id,
            "legal_status": "Natural",
            "name": name,
            "phones": account.phone,
        },
    )
    account.regos_partner_id = created["id"]
    account.link_state = PartnerTelegramLinkState.linked.value
    await session.flush()
    return "created"


async def find_bot_account_by_phone(
    session: AsyncSession, bot: PartnerTelegramBot, phone: str
) -> PartnerTelegramAccount:
    needle = phone_keys(phone)
    if not needle:
        raise unauthorized(
            "Open the bot and share your phone number first.",
            "PARTNER_TELEGRAM_NOT_REGISTERED",
        )
    result = await session.execute(
        select(PartnerTelegramAccount).where(PartnerTelegramAccount.bot_id == bot.id)
    )
    matches = [row for row in result.scalars().all() if phone_keys(row.phone) & needle]
    if not matches:
        raise unauthorized(
            "Open the bot and share your phone number first.",
            "PARTNER_TELEGRAM_NOT_REGISTERED",
        )
    if len(matches) > 1:
        raise bad_request(
            "More than one Telegram account uses this phone number.",
            "PARTNER_PHONE_AMBIGUOUS",
        )
    return matches[0]


async def _require_saved_reference(
    session: AsyncSession, company_id: int, kind: str, option_id: int
) -> None:
    from app.services import regos_defaults as regos_defaults_service

    options = await regos_defaults_service.list_reference_options(session, company_id)
    key = "warehouses" if kind == "warehouse" else "price_types"
    found = any(item.get("id") == option_id for item in options.get(key) or [])
    if not found:
        raise bad_request(
            "That warehouse or price type is not in this company.",
            "PARTNER_REFERENCE_NOT_FOUND",
        )


async def update_bot_settings(
    session: AsyncSession, company_id: int, settings: dict[str, Any]
) -> dict[str, Any]:
    row = await _get_bot_by_company(session, company_id)
    if row is None:
        raise not_found("Partner bot was not found", "PARTNER_TELEGRAM_BOT_NOT_FOUND")
    warehouse_id = settings.get("default_warehouse_id")
    price_type_id = settings.get("default_price_type_id")
    group_id = settings.get("default_partner_group_id")
    if isinstance(warehouse_id, int):
        await _require_saved_reference(session, company_id, "warehouse", warehouse_id)
    if isinstance(price_type_id, int):
        await _require_saved_reference(session, company_id, "price_type", price_type_id)
    if isinstance(group_id, int):
        groups = await regos_partners.list_partner_groups(session, company_id)
        if not any(item.get("id") == group_id for item in groups.get("groups") or []):
            raise bad_request("That partner group was not found.", "REGOS_PARTNER_GROUP_INVALID")
    catalog_group_ids = _normalize_id_list(settings.get("catalog_product_group_ids"))
    if catalog_group_ids:
        product_groups = await regos_groups.list_groups(session, company_id)
        known = {
            item.get("id")
            for item in product_groups.get("groups") or []
            if isinstance(item.get("id"), int)
        }
        catalog_group_ids = [item for item in catalog_group_ids if item in known]
    row.default_warehouse_id = warehouse_id if isinstance(warehouse_id, int) else None
    row.default_price_type_id = price_type_id if isinstance(price_type_id, int) else None
    row.default_partner_group_id = group_id if isinstance(group_id, int) else None
    row.catalog_product_group_ids = catalog_group_ids
    row.allow_catalog_warehouse_selection = bool(settings.get("allow_catalog_warehouse_selection"))
    row.allow_self_registration = bool(settings.get("allow_self_registration"))
    row.show_product_quantities = bool(settings.get("show_product_quantities", True))
    if "show_zero_quantity" in settings:
        row.show_zero_quantity = bool(settings.get("show_zero_quantity"))
    if "show_zero_price" in settings:
        row.show_zero_price = bool(settings.get("show_zero_price"))
    if "auto_open_qty_keypad" in settings:
        row.auto_open_qty_keypad = bool(settings.get("auto_open_qty_keypad"))
    if "enabled_pages" in settings:
        row.enabled_pages = _normalize_enabled_pages(settings.get("enabled_pages"))
    if "balance_notify_enabled" in settings:
        row.balance_notify_enabled = bool(settings.get("balance_notify_enabled"))
    if "balance_notify_time" in settings and isinstance(settings.get("balance_notify_time"), str):
        row.balance_notify_time = settings["balance_notify_time"]
    if "balance_notify_option" in settings and isinstance(settings.get("balance_notify_option"), str):
        row.balance_notify_option = settings["balance_notify_option"]
    if "balance_notify_days" in settings:
        row.balance_notify_days = _balance_notify_days(settings.get("balance_notify_days"))
    if "balance_notify_templates" in settings:
        row.balance_notify_templates = _balance_notify_templates(settings.get("balance_notify_templates"))
    if "order_document_type" in settings:
        row.order_document_type = _normalize_order_document_type(settings.get("order_document_type"))
    if "order_booked" in settings:
        row.order_booked = bool(settings.get("order_booked"))
    await session.flush()
    return bot_to_dict(row)


async def update_account(
    session: AsyncSession,
    company_id: int,
    account_id: int,
    changes: dict[str, Any],
) -> dict[str, Any] | None:
    account = await session.get(PartnerTelegramAccount, account_id)
    if account is None or account.company_id != company_id:
        return None
    partner_name: str | None = None
    if "regos_partner_id" in changes:
        regos_partner_id = changes.get("regos_partner_id")
        if regos_partner_id is None:
            account.regos_partner_id = None
            account.link_state = PartnerTelegramLinkState.unlinked.value
        else:
            partner = await regos_partners.get_partner_by_id(session, company_id, int(regos_partner_id))
            account.regos_partner_id = int(regos_partner_id)
            account.link_state = PartnerTelegramLinkState.linked.value
            name = partner.get("name")
            partner_name = name.strip() if isinstance(name, str) and name.strip() else str(regos_partner_id)
    if "warehouse_id" in changes:
        warehouse_id = changes.get("warehouse_id")
        if isinstance(warehouse_id, int):
            await _require_saved_reference(session, company_id, "warehouse", warehouse_id)
            account.warehouse_id = warehouse_id
        else:
            account.warehouse_id = None
    if "price_type_id" in changes:
        price_type_id = changes.get("price_type_id")
        if isinstance(price_type_id, int):
            await _require_saved_reference(session, company_id, "price_type", price_type_id)
            account.price_type_id = price_type_id
        else:
            account.price_type_id = None
    if "page_overrides" in changes:
        account.page_overrides = _normalize_page_overrides(changes.get("page_overrides"))
    await session.flush()
    if partner_name is None and account.regos_partner_id:
        partner_name = await _partner_name(session, company_id, account.regos_partner_id)
    bot = await _get_bot_by_company(session, company_id)
    return account_to_dict(account, partner_name, bot=bot)


async def assign_partner(
    session: AsyncSession,
    company_id: int,
    account_id: int,
    regos_partner_id: int | None,
) -> dict[str, Any] | None:
    return await update_account(
        session,
        company_id,
        account_id,
        {"regos_partner_id": regos_partner_id},
    )


def document_partner_id(document: dict[str, Any]) -> int | None:
    partner = document.get("partner")
    if isinstance(partner, dict) and isinstance(partner.get("id"), int) and partner["id"] > 0:
        return int(partner["id"])
    raw = document.get("partner_id")
    if isinstance(raw, int) and raw > 0:
        return raw
    return None


async def notify_partner_document(
    session: AsyncSession,
    company_id: int,
    document: dict[str, Any],
    operations: list[dict[str, Any]],
    *,
    warehouse_name: str | None,
    is_cancelled: bool,
    is_return: bool,
    use_cost: bool,
    kind: str,
) -> None:
    if kind not in PARTNER_DOCUMENT_KINDS:
        return
    partner_id = document_partner_id(document)
    if partner_id is None:
        return
    if not await _subscription_allows(session, company_id):
        return
    bot = await _get_bot_by_company(session, company_id)
    if bot is None:
        return
    result = await session.execute(
        select(PartnerTelegramAccount).where(
            PartnerTelegramAccount.company_id == company_id,
            PartnerTelegramAccount.regos_partner_id == partner_id,
            PartnerTelegramAccount.link_state == PartnerTelegramLinkState.linked.value,
        )
    )
    accounts = list(result.scalars().all())
    for account in accounts:
        lang = account.language_code if account.language_code in PARTNER_LANGUAGES else "ru"
        text = fmt.format_partner_receipt(
            document,
            operations,
            warehouse_name,
            is_cancelled=is_cancelled,
            is_return=is_return,
            use_cost=use_cost,
            lang=lang,
            for_partner=True,
        )
        await telegram_service.send_message(bot.bot_token, account.chat_id, text)


async def notify_partner_payment(
    session: AsyncSession,
    company_id: int,
    document: dict[str, Any],
    *,
    is_cancelled: bool,
) -> None:
    partner_id = document_partner_id(document)
    if partner_id is None:
        return
    if not await _subscription_allows(session, company_id):
        return
    bot = await _get_bot_by_company(session, company_id)
    if bot is None:
        return
    result = await session.execute(
        select(PartnerTelegramAccount).where(
            PartnerTelegramAccount.company_id == company_id,
            PartnerTelegramAccount.regos_partner_id == partner_id,
            PartnerTelegramAccount.link_state == PartnerTelegramLinkState.linked.value,
        )
    )
    for account in result.scalars().all():
        lang = account.language_code if account.language_code in PARTNER_LANGUAGES else "ru"
        text = fmt.format_payment_notification(
            document,
            is_cancelled=is_cancelled,
            lang=lang,
            for_partner=True,
        )
        await telegram_service.send_message(bot.bot_token, account.chat_id, text)
