import math
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request, not_found
from app.core.regos_api import regos_async_api_request_for_company

OPERATIONS_PAGE_SIZE = 1000


def build_list_payload(
    *,
    start_date: int | None,
    end_date: int | None,
    search: str | None,
    price_type_id: int | None,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    filters: list[dict[str, str]] = [
        {"field": "deleted_mark", "operator": "Equal", "value": "false"},
    ]
    if start_date is not None:
        filters.append({"field": "start_date", "operator": "Equal", "value": str(start_date)})
    if end_date is not None:
        filters.append({"field": "end_date", "operator": "Equal", "value": str(end_date)})
    if price_type_id is not None:
        filters.append({"field": "price_type_id", "operator": "Equal", "value": str(price_type_id)})
    payload: dict[str, Any] = {
        "filters": filters,
        "sort_orders": [{"column": "date", "direction": "DESC"}],
        "limit": limit,
        "offset": offset,
    }
    if search and search.strip():
        payload["search"] = search.strip()
    return payload


async def list_price_documents(
    session: AsyncSession,
    company_id: int,
    *,
    start_date: int | None = None,
    end_date: int | None = None,
    search: str | None = None,
    price_type_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    payload = build_list_payload(
        start_date=start_date,
        end_date=end_date,
        search=search,
        price_type_id=price_type_id,
        limit=limit,
        offset=offset,
    )
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "docsetprice/get",
        payload,
    )
    documents = [
        mapped
        for item in response.get("result") or []
        if isinstance(item, dict)
        for mapped in [_map_document(item)]
        if mapped is not None
    ]
    return {
        "documents": documents,
        "next_offset": int(response.get("next_offset") or 0),
        "total": int(response.get("total") or len(documents)),
    }


async def get_price_document(
    session: AsyncSession,
    company_id: int,
    document_id: int,
) -> dict[str, Any]:
    if document_id <= 0:
        raise bad_request("Invalid document id.", "INVALID_DOCUMENT_ID")
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "docsetprice/get",
        {
            "filters": [
                {"field": "id", "operator": "Equal", "value": str(document_id)},
                {"field": "deleted_mark", "operator": "Equal", "value": "false"},
            ],
            "limit": 1,
            "offset": 0,
        },
    )
    for item in response.get("result") or []:
        if not isinstance(item, dict):
            continue
        mapped = _map_document(item)
        if mapped is not None and mapped["id"] == document_id:
            return mapped
    raise not_found(f"Document {document_id} was not found.", "DOCUMENT_NOT_FOUND")


async def list_price_document_operations(
    session: AsyncSession,
    company_id: int,
    document_id: int,
) -> dict[str, Any]:
    if document_id <= 0:
        raise bad_request("Invalid document id.", "INVALID_DOCUMENT_ID")
    operations: list[dict[str, Any]] = []
    offset = 0
    while True:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            "setpriceoperation/get",
            {
                "document_ids": [document_id],
                "limit": OPERATIONS_PAGE_SIZE,
                "offset": offset,
            },
        )
        page = [item for item in response.get("result") or [] if isinstance(item, dict)]
        operations.extend(_map_operation(item) for item in page)
        if len(page) < OPERATIONS_PAGE_SIZE:
            break
        offset += OPERATIONS_PAGE_SIZE
    return {"operations": operations}


def _map_document(row: dict[str, Any]) -> dict[str, Any] | None:
    if row.get("deleted_mark"):
        return None
    document_id = row.get("id")
    if not isinstance(document_id, int) or isinstance(document_id, bool) or document_id <= 0:
        return None
    price_type = row.get("price_type") if isinstance(row.get("price_type"), dict) else {}
    price_type_id = price_type.get("id")
    description = row.get("description")
    code = row.get("code")
    date = row.get("date")
    return {
        "id": document_id,
        "code": code.strip() if isinstance(code, str) else "",
        "date": date if isinstance(date, int) and not isinstance(date, bool) else 0,
        "price_type_id": price_type_id
        if isinstance(price_type_id, int) and not isinstance(price_type_id, bool)
        else None,
        "price_type_name": price_type.get("name") if isinstance(price_type.get("name"), str) else "",
        "description": description.strip() if isinstance(description, str) else "",
        "performed": bool(row.get("performed")),
    }


def _map_operation(row: dict[str, Any]) -> dict[str, Any]:
    item = row.get("item") if isinstance(row.get("item"), dict) else {}
    item_id = item.get("id")
    if not isinstance(item_id, int) or isinstance(item_id, bool):
        raw_item_id = row.get("item_id")
        item_id = raw_item_id if isinstance(raw_item_id, int) and not isinstance(raw_item_id, bool) else 0
    operation_id = row.get("id")
    name = item.get("name") if isinstance(item.get("name"), str) else ""
    if not name and isinstance(item.get("fullname"), str):
        name = item["fullname"]
    code = item.get("code") if isinstance(item.get("code"), str) else ""
    return {
        "id": operation_id if isinstance(operation_id, int) and not isinstance(operation_id, bool) else 0,
        "item_id": item_id,
        "item_code": code.strip(),
        "item_name": name.strip(),
        "base_value": _number(row.get("base_value")),
        "new_value": _number(row.get("new_value")),
    }


def _number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return 0.0
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(number):
        return 0.0
    return number
