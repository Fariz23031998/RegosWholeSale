import logging
import math
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request
from app.core.regos_api import regos_async_api_request_for_company
from app.services import regos_defaults as regos_defaults_service

logger = logging.getLogger("regos.backend")

OPERATION_CHUNK_SIZE = 100
PRICE_UPDATE_DESCRIPTION = "Price update from products"


async def set_product_prices(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    permissions: set[str] | list[str],
    *,
    price_type_id: int,
    lines: list[dict[str, Any]],
) -> dict[str, int]:
    if price_type_id <= 0:
        raise bad_request("Select a price type.", "PRICE_TYPE_REQUIRED")
    normalized = _normalize_lines(lines)
    await regos_defaults_service.assert_catalog_scope_allowed(
        session,
        company_id,
        user_id,
        permissions,
        price_type_id=price_type_id,
    )

    created = await regos_async_api_request_for_company(
        session,
        company_id,
        "docsetprice/add",
        {
            "price_type_id": price_type_id,
            "description": PRICE_UPDATE_DESCRIPTION,
        },
    )
    document_id = _new_document_id(created)
    locked = False
    performed = False
    try:
        await regos_async_api_request_for_company(
            session,
            company_id,
            "docsetprice/lock",
            {"ids": [document_id]},
        )
        locked = True
        for offset in range(0, len(normalized), OPERATION_CHUNK_SIZE):
            chunk = normalized[offset : offset + OPERATION_CHUNK_SIZE]
            await regos_async_api_request_for_company(
                session,
                company_id,
                "setpriceoperation/add",
                [
                    {
                        "document_id": document_id,
                        "item_id": line["item_id"],
                        "base_value": line["base_value"],
                        "new_value": line["new_value"],
                    }
                    for line in chunk
                ],
            )
        await regos_async_api_request_for_company(
            session,
            company_id,
            "docsetprice/perform",
            {"id": document_id},
        )
        performed = True
        return {"document_id": document_id}
    except Exception:
        if locked and not performed:
            await _discard_draft(session, company_id, document_id)
        raise
    finally:
        if locked:
            await _best_effort(
                regos_async_api_request_for_company(
                    session,
                    company_id,
                    "docsetprice/unlock",
                    {"ids": [document_id]},
                ),
                "unlock",
                document_id,
            )


def _normalize_lines(lines: list[dict[str, Any]]) -> list[dict[str, float | int]]:
    if not lines:
        raise bad_request("Add at least one price.", "PRICE_LINES_REQUIRED")
    normalized: list[dict[str, float | int]] = []
    seen: set[int] = set()
    for line in lines:
        item_id = line.get("item_id")
        if not isinstance(item_id, int) or isinstance(item_id, bool) or item_id <= 0:
            raise bad_request("Each line needs a product.", "INVALID_ITEM_ID")
        if item_id in seen:
            raise bad_request("Each product can only be changed once.", "DUPLICATE_ITEM")
        seen.add(item_id)
        base_value = _non_negative_price(line.get("base_value"), "base_value")
        new_value = _non_negative_price(line.get("new_value"), "new_value")
        normalized.append(
            {"item_id": item_id, "base_value": base_value, "new_value": new_value}
        )
    return normalized


def _non_negative_price(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise bad_request(f"{field} must be a number.", "INVALID_PRICE")
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise bad_request(f"{field} must be zero or greater.", "INVALID_PRICE")
    return number


def _new_document_id(response: dict[str, Any]) -> int:
    result = response.get("result")
    new_id = result.get("new_id") if isinstance(result, dict) else None
    if isinstance(new_id, int) and not isinstance(new_id, bool) and new_id > 0:
        return new_id
    raise bad_request("Regos did not return a new document id.", "REGOS_DOCUMENT_CREATE_FAILED")


async def _discard_draft(session: AsyncSession, company_id: int, document_id: int) -> None:
    await _best_effort(
        regos_async_api_request_for_company(
            session,
            company_id,
            "docsetprice/deletemark",
            {"id": document_id},
        ),
        "deletemark",
        document_id,
    )
    await _best_effort(
        regos_async_api_request_for_company(
            session,
            company_id,
            "docsetprice/delete",
            {"id": document_id},
        ),
        "delete",
        document_id,
    )


async def _best_effort(awaitable: Any, action: str, document_id: int) -> None:
    try:
        await awaitable
    except Exception:
        logger.warning(
            "Price document %s %s failed",
            document_id,
            action,
            exc_info=True,
        )
