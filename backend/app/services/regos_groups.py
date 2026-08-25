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


async def add_group(
    session: AsyncSession,
    company_id: int,
    *,
    name: str,
    parent_id: int | None = None,
) -> dict[str, int]:
    payload: dict[str, Any] = {"name": name.strip()}
    if not payload["name"]:
        raise bad_request("Group name is required.", "GROUP_NAME_REQUIRED")
    if parent_id is not None and parent_id > 0:
        payload["parent_id"] = int(parent_id)
    else:
        payload["parent_id"] = 0

    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "itemgroup/add",
        payload,
    )
    result = response.get("result") or {}
    new_id = result.get("new_id") if isinstance(result, dict) else None
    if not isinstance(new_id, int) or new_id <= 0:
        raise bad_request("Regos did not return a group id.", "GROUP_CREATE_FAILED")
    return {"id": new_id}


async def edit_group(
    session: AsyncSession,
    company_id: int,
    group_id: int,
    *,
    name: str | None = None,
    parent_id: int | None = None,
    move_parent: bool = False,
) -> dict[str, int]:
    if group_id <= 0:
        raise bad_request("Invalid group id.", "GROUP_ID_INVALID")

    payload: dict[str, Any] = {"id": group_id}
    if name is not None:
        cleaned = name.strip()
        if not cleaned:
            raise bad_request("Group name is required.", "GROUP_NAME_REQUIRED")
        payload["name"] = cleaned
    if move_parent:
        # parent_id=0 moves to root; omit parent_id to leave unchanged (Regos rule).
        payload["parent_id"] = int(parent_id) if parent_id and parent_id > 0 else 0

    if "name" not in payload and "parent_id" not in payload:
        raise bad_request("Nothing to update.", "GROUP_UPDATE_EMPTY")

    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "itemgroup/edit",
        payload,
    )
    result = response.get("result") or {}
    row_affected = result.get("row_affected") if isinstance(result, dict) else 0
    if not isinstance(row_affected, int) or row_affected < 0:
        row_affected = 0
    return {"row_affected": row_affected}


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
