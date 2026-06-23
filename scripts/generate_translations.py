"""Generate translation JSON files for all supported languages.

English (en.json) in backend/app/translations/ is the source of truth.

For complete ru/uz/tj locale files with all keys translated, run:
    python scripts/complete_locales.py

This script is for regenerating all locale files from en.json plus optional
per-language overrides in scripts/locales/{lang}.json (ru, uz, tj).
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRANSLATIONS_DIR = ROOT / "backend" / "app" / "translations"
LOCALES_OVERRIDE_DIR = Path(__file__).resolve().parent / "locales"
VERSION = "1.1.0"
SUPPORTED_LANGS = ("en", "ru", "uz", "tj")


def load_en() -> dict[str, str]:
    en_path = TRANSLATIONS_DIR / "en.json"
    data = json.loads(en_path.read_text(encoding="utf-8"))
    return data["translations"]


def load_overrides(lang: str) -> dict[str, str]:
    override_path = LOCALES_OVERRIDE_DIR / f"{lang}.json"
    if not override_path.is_file():
        return {}
    return json.loads(override_path.read_text(encoding="utf-8"))


def build_lang(en: dict[str, str], overrides: dict[str, str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for key, en_val in en.items():
        result[key] = overrides.get(key, en_val)
    return result


def main() -> None:
    en = load_en()

    for lang in SUPPORTED_LANGS:
        if lang == "en":
            translations = dict(en)
        else:
            overrides = load_overrides(lang)
            translations = build_lang(en, overrides)

        payload = {
            "version": VERSION,
            "last_updated": date.today().isoformat(),
            "translations": translations,
        }
        path = TRANSLATIONS_DIR / f"{lang}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        non_en = sum(1 for k, v in translations.items() if v != en.get(k))
        print(f"Wrote {path} ({len(translations)} keys, {non_en} non-English)")

    subprocess.run([sys.executable, str(Path(__file__).parent / "gen_fallback_translations.py")], check=True)


if __name__ == "__main__":
    main()
