import re

_GATEWAY_OUT_TOKEN = re.compile(r"/gateway/out/([^/?#\s]+)", re.IGNORECASE)


def extract_integration_token(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        return ""
    match = _GATEWAY_OUT_TOKEN.search(trimmed)
    if match:
        return match.group(1).strip()
    return trimmed
