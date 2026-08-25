"""One-off probe of Central Bank of Uzbekistan public JSON API (cbu.uz)."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import date

BASE_URL = "https://cbu.uz/common/json"
SAMPLE_CODES = ("USD", "EUR", "RUB", "GBP", "CNY", "KZT", "UZS")


def fetch(url: str) -> tuple[int, str | None, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": "RegosWholeSale-CBU-Test/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, resp.headers.get("Content-Type"), resp.read()


def effective_rate(row: dict) -> float:
    return float(row["Rate"]) / int(row["Nominal"])


def print_sample_rows(data: list[dict]) -> None:
    print("\nSample currencies (Rate / Nominal -> effective rate):")
    by_code = {row.get("Ccy"): row for row in data if row.get("Ccy")}
    for code in SAMPLE_CODES:
        row = by_code.get(code)
        if not row:
            print(f"  {code:4}  NOT FOUND")
            continue
        print(
            f"  {code:4}  Nominal={row['Nominal']:>4}  Rate={row['Rate']:>12}  "
            f"Date={row.get('Date')}  -> {effective_rate(row)}"
        )


def probe(label: str, url: str) -> bool:
    print(f"\n{'=' * 60}")
    print(f"{label}")
    print(f"GET {url}")
    print("=" * 60)
    try:
        status, content_type, body = fetch(url)
    except urllib.error.URLError as exc:
        print(f"REQUEST FAILED: {exc}")
        return False

    print(f"HTTP status: {status}")
    print(f"Content-Type: {content_type}")
    print(f"Body length: {len(body)} bytes")

    try:
        text = body.decode("utf-8")
        data = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        preview = body[:300].decode("utf-8", errors="replace")
        print(f"PARSE FAILED: {exc}")
        print(f"Body preview: {preview!r}")
        return False

    if not isinstance(data, list):
        print(f"Unexpected JSON type: {type(data).__name__}")
        print(json.dumps(data, ensure_ascii=False)[:500])
        return False

    print(f"Parsed JSON array with {len(data)} currency rows")
    if not data:
        print("WARNING: empty array — no rates returned")
        return False

    print(f"First row keys: {sorted(data[0].keys())}")
    print(f"First row: {json.dumps(data[0], ensure_ascii=False)}")
    print_sample_rows(data)
    return True


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    today = date.today().strftime("%d.%m.%Y")
    ok_latest = probe("Latest rates", BASE_URL)
    ok_today = probe(f"Historical rates for today ({today})", f"{BASE_URL}?date={today}")

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Latest endpoint OK: {ok_latest}")
    print(f"Today historical endpoint OK: {ok_today}")
    return 0 if ok_latest and ok_today else 1


if __name__ == "__main__":
    sys.exit(main())
