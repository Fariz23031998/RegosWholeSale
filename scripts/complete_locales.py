"""Generate complete ru/uz/tj translation JSON files from scripts/locales/*.json.

English (en.json) in backend/app/translations/ is the source of truth for keys.
Locale values live in scripts/locales/{lang}.json (ru, uz, tj).

For incremental updates when adding new English keys:
    1. Add the key to en.json
    2. Add translations to scripts/locales/{lang}.json
    3. Run: python scripts/generate_translations.py
       or:  python scripts/complete_locales.py

Or use scripts/sync_missing_translations.py to scan for UI keys missing from en.json.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN_PATH = ROOT / "backend" / "app" / "translations" / "en.json"
OUT_DIR = ROOT / "backend" / "app" / "translations"
LOCALES_OVERRIDE_DIR = Path(__file__).resolve().parent / "locales"
VERSION = "1.1.0"
SUPPORTED_LANGS = ("ru", "uz", "tj")

# Keys that may intentionally match English (brand names, technical labels, templates).
ALLOWED_ENGLISH = frozenset({
    "language.uz",
    "language.ru",
    "language.en",
    "language.tj",
    "auth.title",
    "settings.receiptTemplates.htmlLabel",
    "settings.receiptTemplates.tabCss",
    "settings.receiptTemplates.tabHtml",
    "settings.exchangeRateSync.formula",
    "settings.telegram.webhook",
    "telegram.receipt.posPaymentLine",
    "telegramUsers.table.chatId",
})


def load_en() -> dict[str, str]:
    data = json.loads(EN_PATH.read_text(encoding="utf-8"))
    return data["translations"]


def load_locale(lang: str) -> dict[str, str]:
    path = LOCALES_OVERRIDE_DIR / f"{lang}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Missing locale file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def count_english_fallbacks(en: dict[str, str], locale: dict[str, str]) -> list[str]:
    return [
        k
        for k, v in locale.items()
        if k in en and v == en[k] and k not in ALLOWED_ENGLISH
    ]


def write_locale(lang: str, translations: dict[str, str]) -> Path:
    payload = {
        "version": VERSION,
        "last_updated": date.today().isoformat(),
        "translations": translations,
    }
    path = OUT_DIR / f"{lang}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    LOCALES_OVERRIDE_DIR.mkdir(parents=True, exist_ok=True)
    override_path = LOCALES_OVERRIDE_DIR / f"{lang}.json"
    # Preserve en key order
    ordered = {k: translations[k] for k in load_en() if k in translations}
    override_path.write_text(
        json.dumps(ordered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return path


def main() -> int:
    en = load_en()
    en_keys = set(en.keys())
    exit_code = 0

    for lang in SUPPORTED_LANGS:
        locale = load_locale(lang)
        locale_keys = set(locale.keys())
        if locale_keys != en_keys:
            missing = sorted(en_keys - locale_keys)
            extra = sorted(locale_keys - en_keys)
            print(
                f"ERROR {lang}: key mismatch (missing={len(missing)}, extra={len(extra)})",
                file=sys.stderr,
            )
            if missing:
                print(f"  missing: {missing[:10]}", file=sys.stderr)
            if extra:
                print(f"  extra: {extra[:10]}", file=sys.stderr)
            exit_code = 1
            continue

        # Keep en.json key order in output
        ordered = {k: locale[k] for k in en}

        fallbacks = count_english_fallbacks(en, ordered)
        if fallbacks:
            print(f"ERROR {lang}: {len(fallbacks)} English fallbacks", file=sys.stderr)
            for k in fallbacks[:10]:
                print(f"  {k}", file=sys.stderr)
            exit_code = 1
            continue

        path = write_locale(lang, ordered)
        translated = sum(1 for k, v in ordered.items() if v != en[k])
        print(f"Wrote {path} ({len(ordered)} keys, {translated} non-English translations)")

    if exit_code == 0:
        subprocess.run(
            [sys.executable, str(Path(__file__).parent / "gen_fallback_translations.py")],
            check=True,
        )

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
