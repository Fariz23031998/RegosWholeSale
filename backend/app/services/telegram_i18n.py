from app.services.telegram_languages import normalize_receipt_language
from app.translations.translator_service import Translator

_translator = Translator()


def t(key: str, lang: str, **params: str | float | int) -> str:
    normalized = normalize_receipt_language(lang)
    text = _translator.get(key, normalized)
    for name, value in params.items():
        text = text.replace(f"{{{{{name}}}}}", str(value))
    return text
