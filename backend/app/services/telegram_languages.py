SUPPORTED_RECEIPT_LANGUAGES: tuple[str, ...] = ("en", "ru", "uz", "tj")

_TELEGRAM_LANG_MAP = {
    "en": "en",
    "ru": "ru",
    "uz": "uz",
    "tj": "tj",
    "tg": "tj",
}


def normalize_receipt_language(language: str | None, *, default: str = "ru") -> str:
    if not language:
        return default
    code = language.strip().lower().split("-")[0]
    mapped = _TELEGRAM_LANG_MAP.get(code, code)
    if mapped in SUPPORTED_RECEIPT_LANGUAGES:
        return mapped
    return default


def default_receipt_language(telegram_language_code: str | None) -> str:
    return normalize_receipt_language(telegram_language_code, default="ru")


def resolve_receipt_language(
    stored_language: str | None,
    telegram_language_code: str | None,
) -> str:
    if stored_language:
        return normalize_receipt_language(stored_language)
    return default_receipt_language(telegram_language_code)


def validate_receipt_language(language: str) -> str:
    code = language.strip().lower().split("-")[0]
    mapped = _TELEGRAM_LANG_MAP.get(code, code)
    if mapped not in SUPPORTED_RECEIPT_LANGUAGES:
        raise ValueError(f"Unsupported receipt language: {language}")
    return mapped
