from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request
from app.core.regos_api import regos_async_api_request_for_company


async def list_groups(session: AsyncSession, company_id: int) -> dict[str, list[dict[str, Any]]]:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "itemgroup/get",
        {},
    )
    result = response.get("result") or []
    groups = [_map_group(row) for row in result if isinstance(row, dict)]
    groups.sort(key=lambda item: (item["path"].lower(), item["name"].lower(), item["id"]))
    return {"groups": groups}


def _map_group(row: dict[str, Any]) -> dict[str, Any]:
    group_id = row.get("id")
    if not isinstance(group_id, int) or group_id <= 0:
        raise bad_request("Regos returned an invalid product group.", "REGOS_PRODUCT_GROUP_INVALID")

    name = _coerce_text(row.get("name")) or f"#{group_id}"
    path = _coerce_text(row.get("path")) or name
    parent_id = row.get("parent_id") if isinstance(row.get("parent_id"), int) else None
    if parent_id is not None and parent_id <= 0:
        parent_id = None

    child_count = row.get("child_count")
    if not isinstance(child_count, int) or child_count < 0:
        child_count = 0

    return {
        "id": group_id,
        "parent_id": parent_id,
        "name": name,
        "path": path,
        "child_count": child_count,
    }


def _coerce_text(value: Any) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    return None
