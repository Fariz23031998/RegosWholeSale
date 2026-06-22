from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request, not_found
from app.core.regos_api import regos_async_api_request_for_company

_LEGAL_STATUSES = frozenset({"Legal", "Natural", "1", "2", 1, 2})


async def list_partners(
    session: AsyncSession,
    company_id: int,
    *,
    search: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "deleted_mark": False,
        "limit": limit,
        "offset": offset,
        "sort_orders": [{"column": "Name", "direction": "asc"}],
    }
    if search and search.strip():
        payload["search"] = search.strip()

    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "partner/get",
        payload,
    )
    result = response.get("result") or []
    partners = [_map_partner(row) for row in result if isinstance(row, dict)]
    next_offset = response.get("next_offset")
    total = response.get("total")
    return {
        "partners": partners,
        "next_offset": next_offset if isinstance(next_offset, int) and next_offset >= 0 else offset,
        "total": total if isinstance(total, int) and total >= 0 else len(partners),
    }


async def get_partner_by_id(
    session: AsyncSession,
    company_id: int,
    partner_id: int,
) -> dict[str, Any]:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "partner/get",
        {"ids": [partner_id], "limit": 1, "offset": 0},
    )
    result = response.get("result") or []
    for row in result:
        if isinstance(row, dict) and row.get("id") == partner_id:
            return _map_partner(row)
    raise not_found("Partner not found.", "REGOS_PARTNER_NOT_FOUND")


async def list_partner_groups(
    session: AsyncSession,
    company_id: int,
) -> dict[str, list[dict[str, Any]]]:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "partnergroup/get",
        {},
    )
    result = response.get("result") or []
    groups: list[dict[str, Any]] = []
    for row in result:
        if not isinstance(row, dict):
            continue
        group_id = row.get("id")
        if not isinstance(group_id, int) or group_id < 0:
            continue
        name = _coerce_text(row.get("name")) or f"#{group_id}"
        groups.append({"id": group_id, "name": name})
    groups.sort(key=lambda item: (item["name"].lower(), item["id"]))
    return {"groups": groups}


async def add_partner(
    session: AsyncSession,
    company_id: int,
    body: dict[str, Any],
) -> dict[str, int]:
    payload = _build_partner_payload(body, require_name=True)
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "partner/add",
        payload,
    )
    result = response.get("result") or {}
    new_id = result.get("new_id") if isinstance(result, dict) else None
    if not isinstance(new_id, int) or new_id <= 0:
        raise bad_request("Regos did not return a partner id.", "REGOS_PARTNER_CREATE_FAILED")
    return {"id": new_id}


async def edit_partner(
    session: AsyncSession,
    company_id: int,
    partner_id: int,
    body: dict[str, Any],
) -> dict[str, int]:
    payload = _build_partner_payload(body, require_name=False)
    if not payload:
        raise bad_request("No partner fields to update.", "REGOS_PARTNER_UPDATE_EMPTY")
    payload["id"] = partner_id
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "partner/edit",
        payload,
    )
    result = response.get("result") or {}
    row_affected = result.get("row_affected") if isinstance(result, dict) else 0
    if not isinstance(row_affected, int) or row_affected < 0:
        row_affected = 0
    return {"row_affected": row_affected}


async def delete_mark_partner(
    session: AsyncSession,
    company_id: int,
    partner_id: int,
) -> dict[str, int]:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "partner/deletemark",
        {"id": partner_id},
    )
    result = response.get("result") or {}
    row_affected = result.get("row_affected") if isinstance(result, dict) else 0
    if not isinstance(row_affected, int) or row_affected < 0:
        row_affected = 0
    return {"row_affected": row_affected}


def _build_partner_payload(body: dict[str, Any], *, require_name: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {}

    if "group_id" in body and body["group_id"] is not None:
        group_id = body["group_id"]
        if not isinstance(group_id, int) or group_id < 0:
            raise bad_request("Invalid partner group.", "REGOS_PARTNER_GROUP_INVALID")
        payload["group_id"] = group_id
    elif require_name:
        raise bad_request("Partner group is required.", "REGOS_PARTNER_GROUP_REQUIRED")

    if "legal_status" in body and body["legal_status"] is not None:
        legal_status = _normalize_legal_status(body["legal_status"])
        if legal_status is None:
            raise bad_request("Invalid legal status.", "REGOS_PARTNER_LEGAL_STATUS_INVALID")
        payload["legal_status"] = legal_status
    elif require_name:
        raise bad_request("Legal status is required.", "REGOS_PARTNER_LEGAL_STATUS_REQUIRED")

    text_fields = (
        "name",
        "fullname",
        "boss_name",
        "address",
        "phones",
        "email",
        "description",
        "inn",
        "bank_name",
        "mfo",
        "rs",
        "oked",
        "vat_index",
    )
    for field in text_fields:
        if field not in body:
            continue
        value = body[field]
        if value is None:
            continue
        text = _coerce_text(value)
        if field == "name":
            if not text:
                if require_name:
                    raise bad_request("Partner name is required.", "REGOS_PARTNER_NAME_REQUIRED")
                continue
            payload["name"] = text
        elif text is not None:
            payload[field] = text
        elif field == "name" and require_name:
            raise bad_request("Partner name is required.", "REGOS_PARTNER_NAME_REQUIRED")

    if require_name and "name" not in payload:
        raise bad_request("Partner name is required.", "REGOS_PARTNER_NAME_REQUIRED")

    return payload


def _map_partner(row: dict[str, Any]) -> dict[str, Any]:
    partner_id = row.get("id")
    if not isinstance(partner_id, int) or partner_id <= 0:
        raise bad_request("Regos returned an invalid partner.", "REGOS_PARTNER_INVALID")

    group = row.get("group") if isinstance(row.get("group"), dict) else {}
    group_id = group.get("id")
    if not isinstance(group_id, int) or group_id < 0:
        group_id = 0

    legal_status = _normalize_legal_status(row.get("legal_status")) or "Natural"
    name = _coerce_text(row.get("name")) or f"#{partner_id}"

    return {
        "id": partner_id,
        "name": name,
        "fullname": _coerce_text(row.get("fullname")),
        "legal_status": legal_status,
        "group_id": group_id,
        "group_name": _coerce_text(group.get("name")),
        "boss_name": _coerce_text(row.get("boss_name")),
        "address": _coerce_text(row.get("address")),
        "phones": _coerce_text(row.get("phones")),
        "email": _coerce_text(row.get("email")),
        "description": _coerce_text(row.get("description")),
        "inn": _coerce_text(row.get("inn")),
        "bank_name": _coerce_text(row.get("bank_name")),
        "mfo": _coerce_text(row.get("mfo")),
        "rs": _coerce_text(row.get("rs")),
        "oked": _coerce_text(row.get("oked")),
        "vat_index": _coerce_text(row.get("vat_index")),
        "deleted_mark": bool(row.get("deleted_mark")),
    }


def _normalize_legal_status(value: Any) -> str | None:
    if value in {"Legal", 1, "1"}:
        return "Legal"
    if value in {"Natural", 2, "2"}:
        return "Natural"
    if isinstance(value, str) and value.strip() in _LEGAL_STATUSES:
        return "Legal" if value.strip() in {"Legal", "1"} else "Natural"
    return None


def _coerce_text(value: Any) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    return None
