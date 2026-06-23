from pathlib import Path
import json
from typing import Dict


class Translator:
    _cache: Dict[str, dict] = {}
    _locales_dir = Path(__file__).parent

    def __init__(self, default_lang: str = "en"):
        self.default_lang = default_lang
        self._load_language(default_lang)

    def _load_language(self, lang: str) -> None:
        if lang not in self._cache:
            file_path = self._locales_dir / f"{lang}.json"
            with open(file_path, "r", encoding="utf-8") as f:
                self._cache[lang] = json.load(f)

    def get_language_translations(self, lang: str) -> dict:
        if lang not in self._cache:
            self._load_language(lang)
        return self._cache[lang]

    def get_language_version(self, lang: str) -> dict:
        if lang not in self._cache:
            self._load_language(lang)
        return {
            "version": self._cache[lang]["version"],
            "last_updated": self._cache[lang]["last_updated"],
        }

    def get(self, key: str, lang: str | None = None) -> str:
        lang = lang or self.default_lang
        self._load_language(lang)
        translations = self._cache[lang].get("translations", {})
        return translations.get(key, key)

    def clear_cache(self) -> None:
        self._cache.clear()
