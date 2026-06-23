import logging

from fastapi import APIRouter

from app.translations.translator_service import Translator

logger = logging.getLogger("regos.backend")
router = APIRouter(prefix="/lang", tags=["Languages"])

translator = Translator()

SUPPORTED_LANGS = ("en", "ru", "uz", "tj")


def _normalize_lang(lang_code: str) -> str:
    normalized = lang_code.lower()
    if normalized not in SUPPORTED_LANGS:
        return "en"
    return normalized


@router.get("/{lang_code}")
async def get_language(lang_code: str):
    lang = _normalize_lang(lang_code)
    return translator.get_language_translations(lang)


@router.get("/{lang_code}/version")
async def get_version(lang_code: str):
    lang = _normalize_lang(lang_code)
    return translator.get_language_version(lang)
