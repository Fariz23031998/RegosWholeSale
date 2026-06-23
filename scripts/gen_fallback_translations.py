"""Generate frontend/src/lib/fallback-translations.ts from en.json."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
en = json.load(open(ROOT / "backend/app/translations/en.json", encoding="utf-8"))["translations"]
out = ROOT / "frontend/src/lib/fallback-translations.ts"
lines = ["export const FALLBACK_TRANSLATIONS: Record<string, string> = {"]
for key, value in en.items():
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    lines.append(f'  "{key}": "{escaped}",')
lines.append("};")
lines.append("")
out.write_text("\n".join(lines), encoding="utf-8")
print(f"Wrote {len(en)} keys to {out}")
