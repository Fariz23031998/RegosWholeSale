from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.regos_api import regos_async_api_request_for_company


async def list_firms(session: AsyncSession, company_id: int) -> dict[str, list[dict[str, Any]]]:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "firm/get",
        {
            "deleted_mark": False,
            "limit": 1000,
            "offset": 0,
            "sort_orders": [{"column": "Name", "direction": "asc"}],
        },
    )
    result = response.get("result") or []
    firms: list[dict[str, Any]] = []
    for row in result:
        if not isinstance(row, dict):
            continue
        firm_id = row.get("id")
        if not isinstance(firm_id, int) or firm_id <= 0:
            continue
        name = row.get("name")
        if not isinstance(name, str) or not name.strip():
            name = f"#{firm_id}"
        firms.append({"id": firm_id, "name": name.strip()})
    firms.sort(key=lambda item: (item["name"].lower(), item["id"]))
    return {"firms": firms}
