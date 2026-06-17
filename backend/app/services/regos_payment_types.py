from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request
from app.core.regos_api import regos_async_api_request_for_company

# Regos enabled: true/1 (everywhere), backoffice/3 (backoffice); exclude frontoffice/2 and false/4.
_APP_ALLOWED_ENABLED = {
    True,
    1,
    "true",
    "True",
    "1",
    "backoffice",
    "Backoffice",
    "BACKOFFICE",
    3,
    "3",
}


async def list_payment_types(session: AsyncSession, company_id: int) -> dict[str, list[dict[str, Any]]]:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "paymenttype/get",
        {},
    )
    result = response.get("result") or []
    payment_types: list[dict[str, Any]] = []
    for row in result:
        if not isinstance(row, dict):
            continue
        if not _is_app_enabled(row.get("enabled")):
            continue
        payment_types.append(_map_payment_type(row))
    payment_types.sort(key=lambda item: (not item["is_cash"], item["name"].lower(), item["id"]))
    return {"payment_types": payment_types}


def _map_payment_type(row: dict[str, Any]) -> dict[str, Any]:
    payment_type_id = row.get("id")
    if not isinstance(payment_type_id, int) or payment_type_id <= 0:
        raise bad_request("Regos returned an invalid payment type.", "REGOS_PAYMENT_TYPE_INVALID")

    name = _coerce_text(row.get("name")) or f"#{payment_type_id}"
    image_url = _coerce_text(row.get("image_url")) or ""

    return {
        "id": payment_type_id,
        "name": name,
        "is_cash": _coerce_bool(row.get("is_cash")),
        "image_url": image_url,
    }


def _is_app_enabled(value: Any) -> bool:
    return value in _APP_ALLOWED_ENABLED


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes"}
    return False


def _coerce_text(value: Any) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    return None
