from typing import Any

def coerce_unit_type(value: Any) -> int | None:
    if value in (1, 2):
        return int(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in ("pcs", "1"):
            return 1
        if text in ("non_pcs", "2"):
            return 2
    return None
