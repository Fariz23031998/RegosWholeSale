from typing import Any
from app.services.regos_products.helpers.coerce_text.coerce_text import coerce_text

def nested_text(obj: dict[str, Any], *path: str) -> str | None:
    current: Any = obj
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return coerce_text(current)
