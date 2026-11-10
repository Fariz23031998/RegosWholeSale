import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.regos_api import regos_async_api_request_for_company

logger = logging.getLogger("regos.backend")

_CHUNK_SIZE = 50


def select_recent_prices(rows: list[dict[str, Any]]) -> tuple[Any, Any]:
    """Return the newest price and the newest earlier price that differs from it."""
    ordered = sorted(
        (row for row in rows if isinstance(row, dict)),
        key=lambda row: (_sort_number(row.get("last_update")), _sort_number(row.get("id"))),
        reverse=True,
    )
    if not ordered:
        return None, None
    current = ordered[0].get("value")
    old = None
    for row in ordered[1:]:
        value = row.get("value")
        if not _same_price(current, value):
            old = value
            break
    return current, old


async def fetch_item_price_logs(
    session: AsyncSession,
    company_id: int,
    item_ids: list[int],
    price_type_id: int,
) -> dict[int, tuple[Any, Any]]:
    unique_ids = [item_id for item_id in dict.fromkeys(item_ids) if item_id > 0]
    if not unique_ids or not price_type_id:
        return {}

    grouped: dict[int, list[dict[str, Any]]] = {}
    try:
        for offset in range(0, len(unique_ids), _CHUNK_SIZE):
            chunk = unique_ids[offset : offset + _CHUNK_SIZE]
            response = await regos_async_api_request_for_company(
                session,
                company_id,
                "itempricelog/get",
                {
                    "filters": [
                        {
                            "field": "item_id",
                            "operator": "In",
                            "value": ",".join(str(item_id) for item_id in chunk),
                        },
                        {
                            "field": "price_type_id",
                            "operator": "Equal",
                            "value": str(price_type_id),
                        },
                    ]
                },
            )
            for row in response.get("result") or []:
                if not isinstance(row, dict):
                    continue
                item_id = row.get("item_id")
                if not isinstance(item_id, int):
                    continue
                price_type = row.get("price_type")
                type_id = price_type.get("id") if isinstance(price_type, dict) else None
                if type_id is not None and type_id != price_type_id:
                    continue
                grouped.setdefault(item_id, []).append(row)
    except Exception as exc:
        logger.warning("Failed to fetch item price log via itempricelog/get: %s", exc, exc_info=True)
        return {}

    return {item_id: select_recent_prices(rows) for item_id, rows in grouped.items()}


def _sort_number(value: Any) -> float:
    number = _price_number(value)
    return number if number is not None else 0.0


def _same_price(left: Any, right: Any) -> bool:
    left_number = _price_number(left)
    right_number = _price_number(right)
    if left_number is not None and right_number is not None:
        return left_number == right_number
    return left == right


def _price_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None
