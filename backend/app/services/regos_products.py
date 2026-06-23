from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError, bad_request
from app.core.regos_api import regos_async_api_request_for_company
from app.services import regos_defaults as regos_defaults_service

# When company filters (zero stock/price) discard many Regos rows, one client page may
# require scanning multiple Regos pages. Cap per request to bound latency; return the
# Regos cursor in next_offset so the client can continue.
MAX_REGOS_PAGES_PER_REQUEST = 100


def _regos_page_size(client_limit: int) -> int:
    """Fetch more rows per Regos hop so filtered catalogs fill client pages faster."""
    return max(client_limit, 60)


def _next_regos_offset(
    current_offset: int,
    page_next_offset: int,
    result_count: int,
    regos_total: int,
) -> int:
    if page_next_offset > current_offset:
        return page_next_offset
    if result_count <= 0:
        return 0
    manual = current_offset + result_count
    if regos_total <= 0 or regos_total > manual:
        return manual
    return 0


def _regos_scan_cursor(page_offset: int, rows_consumed: int) -> int:
    """Regos row index after the last consumed row on the current page."""
    return page_offset + rows_consumed


def _client_next_offset(
    *,
    total: int,
    scan_cursor: int,
    last_page_result_count: int,
    regos_page_size: int,
    collected_count: int,
    limit: int,
) -> int:
    """Cursor for the client's next request after this response."""
    if last_page_result_count <= 0:
        return 0
    if total > 0:
        return scan_cursor if total > scan_cursor else 0
    # Regos often omits total; keep the scan cursor so the client can continue.
    if collected_count < limit:
        return scan_cursor
    if last_page_result_count >= regos_page_size:
        return scan_cursor
    return 0


async def list_all_products(
    session: AsyncSession,
    company_id: int,
    *,
    user_id: int,
    page_size: int = 200,
) -> list[dict[str, Any]]:
    """Fetch every catalog product (including zero stock/price) for reporting."""
    all_products: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = await list_products(
            session,
            company_id,
            offset=offset,
            limit=page_size,
            user_id=user_id,
            include_zero_quantity=True,
            include_zero_price=True,
        )
        all_products.extend(page["products"])
        next_offset = int(page.get("next_offset") or 0)
        if next_offset <= offset:
            break
        offset = next_offset
    return all_products


async def list_products(
    session: AsyncSession,
    company_id: int,
    *,
    offset: int,
    limit: int,
    search: str | None = None,
    group_id: int | None = None,
    featured_only: bool = False,
    user_id: int | None = None,
    warehouse_id: int | None = None,
    price_type_id: int | None = None,
    include_zero_quantity: bool | None = None,
    include_zero_price: bool | None = None,
) -> dict[str, Any]:
    search_term = search.strip() if search and search.strip() else None
    global_search = search_term is not None

    if featured_only and not global_search:
        if user_id is None:
            raise bad_request("User is required for featured products.", "FEATURED_USER_REQUIRED")
        return await list_featured_products(
            session,
            company_id,
            user_id,
            offset=offset,
            limit=limit,
            search=search,
            warehouse_id=warehouse_id,
            price_type_id=price_type_id,
        )

    if user_id is None:
        defaults = await regos_defaults_service.get_regos_defaults(session, company_id)
    else:
        defaults = await regos_defaults_service.apply_regos_session_overrides(
            session,
            company_id,
            user_id,
            warehouse_id=warehouse_id,
            price_type_id=price_type_id,
        )
    warehouse = defaults.get("warehouse")
    price_type = defaults.get("price_type")
    include_zero_quantity = (
        include_zero_quantity
        if include_zero_quantity is not None
        else bool(defaults.get("zero_quantity", False))
    )
    include_zero_price = (
        include_zero_price
        if include_zero_price is not None
        else bool(defaults.get("zero_price", False))
    )

    if not warehouse:
        raise bad_request(
            "Default warehouse is not configured. Save it in Settings first.",
            "REGOS_DEFAULT_WAREHOUSE_NOT_CONFIGURED",
        )
    if not price_type:
        raise bad_request(
            "Default price type is not configured. Save it in Settings first.",
            "REGOS_DEFAULT_PRICE_TYPE_NOT_CONFIGURED",
        )

    payload: dict[str, Any] = {
        "stock_id": warehouse["id"],
        "price_type_id": price_type["id"],
        "sort_orders": [{"column": "Name", "direction": "ASC"}],
        "zero_quantity": include_zero_quantity,
        "zero_price": include_zero_price,
        "image_size": "Medium",
        "type": "Item",
        "deleted_mark": False,
    }
    if search_term:
        payload["search"] = search_term
    if group_id is not None and not global_search:
        payload["group_ids"] = [group_id]

    collected: list[dict[str, Any]] = []
    current_offset = offset
    total = 0
    regos_page_size = _regos_page_size(limit)
    last_scan_cursor = offset
    last_page_result_count = 0

    for _ in range(MAX_REGOS_PAGES_PER_REQUEST):
        if len(collected) >= limit:
            break

        response = await regos_async_api_request_for_company(
            session,
            company_id,
            "item/getext",
            {
                **payload,
                "limit": regos_page_size,
                "offset": current_offset,
            },
        )
        result = response.get("result") or []
        result_count = len(result)
        regos_total = int(response.get("total") or 0)
        if regos_total > 0:
            total = regos_total
        page_next_offset = max(0, int(response.get("next_offset") or 0))

        rows_consumed = 0
        for row in result:
            rows_consumed += 1
            if not isinstance(row, dict):
                continue
            try:
                product = _map_product(row)
            except AppError:
                continue
            if _matches_product_filters(
                product,
                include_zero_quantity=include_zero_quantity,
                include_zero_price=include_zero_price,
            ):
                collected.append(product)
                if len(collected) >= limit:
                    break

        scan_cursor = _regos_scan_cursor(current_offset, rows_consumed)
        last_scan_cursor = scan_cursor
        last_page_result_count = result_count

        if len(collected) >= limit:
            return {
                "products": collected,
                "next_offset": _client_next_offset(
                    total=total,
                    scan_cursor=scan_cursor,
                    last_page_result_count=result_count,
                    regos_page_size=regos_page_size,
                    collected_count=len(collected),
                    limit=limit,
                ),
                "total": total,
            }

        if result_count == 0:
            return {
                "products": collected,
                "next_offset": 0,
                "total": total or offset + len(collected),
            }

        next_cursor = _next_regos_offset(
            current_offset, page_next_offset, result_count, total
        )
        if next_cursor <= current_offset:
            if (
                len(collected) < limit
                and result_count > 0
                and (
                    total <= 0
                    or total > scan_cursor
                    or result_count >= regos_page_size
                )
            ):
                current_offset = current_offset + result_count
                continue
            return {
                "products": collected,
                "next_offset": _client_next_offset(
                    total=total,
                    scan_cursor=scan_cursor,
                    last_page_result_count=result_count,
                    regos_page_size=regos_page_size,
                    collected_count=len(collected),
                    limit=limit,
                ),
                "total": total or offset + len(collected),
            }

        current_offset = next_cursor

    return {
        "products": collected,
        "next_offset": _client_next_offset(
            total=total,
            scan_cursor=last_scan_cursor,
            last_page_result_count=last_page_result_count,
            regos_page_size=regos_page_size,
            collected_count=len(collected),
            limit=limit,
        ),
        "total": total,
    }


async def get_products_by_ids(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    product_ids: list[int],
    *,
    warehouse_id: int | None = None,
    price_type_id: int | None = None,
) -> list[dict[str, Any]]:
    unique_ids = [product_id for product_id in dict.fromkeys(product_ids) if product_id > 0]
    if not unique_ids:
        return []

    defaults = await regos_defaults_service.apply_regos_session_overrides(
        session,
        company_id,
        user_id,
        warehouse_id=warehouse_id,
        price_type_id=price_type_id,
    )
    warehouse = defaults.get("warehouse")
    price_type = defaults.get("price_type")
    if not warehouse:
        raise bad_request(
            "Default warehouse is not configured. Save it in Settings first.",
            "REGOS_DEFAULT_WAREHOUSE_NOT_CONFIGURED",
        )
    if not price_type:
        raise bad_request(
            "Default price type is not configured. Save it in Settings first.",
            "REGOS_DEFAULT_PRICE_TYPE_NOT_CONFIGURED",
        )

    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "item/getext",
        {
            "stock_id": warehouse["id"],
            "price_type_id": price_type["id"],
            "ids": unique_ids,
            "sort_orders": [{"column": "Name", "direction": "ASC"}],
            "zero_quantity": True,
            "zero_price": True,
            "image_size": "Medium",
            "type": "Item",
            "deleted_mark": False,
            "limit": len(unique_ids),
            "offset": 0,
        },
    )
    result = response.get("result") or []

    by_id: dict[int, dict[str, Any]] = {}
    for row in result:
        if not isinstance(row, dict):
            continue
        try:
            product = _map_product(row)
        except AppError:
            continue
        by_id[int(product["regos_item_id"])] = product

    return [by_id[product_id] for product_id in unique_ids if product_id in by_id]


async def list_featured_products(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    *,
    offset: int,
    limit: int,
    search: str | None = None,
    warehouse_id: int | None = None,
    price_type_id: int | None = None,
) -> dict[str, Any]:
    from app.services import featured_products as featured_products_service

    product_ids = await featured_products_service.list_product_ids(session, user_id)
    total = len(product_ids)
    if total == 0:
        return {"products": [], "next_offset": 0, "total": 0}

    page_ids = product_ids[offset : offset + limit]
    if not page_ids:
        return {"products": [], "next_offset": 0, "total": total}

    defaults = await regos_defaults_service.apply_regos_session_overrides(
        session,
        company_id,
        user_id,
        warehouse_id=warehouse_id,
        price_type_id=price_type_id,
    )
    warehouse = defaults.get("warehouse")
    price_type = defaults.get("price_type")
    include_zero_quantity = bool(defaults.get("zero_quantity", False))
    include_zero_price = bool(defaults.get("zero_price", False))

    if not warehouse:
        raise bad_request(
            "Default warehouse is not configured. Save it in Settings first.",
            "REGOS_DEFAULT_WAREHOUSE_NOT_CONFIGURED",
        )
    if not price_type:
        raise bad_request(
            "Default price type is not configured. Save it in Settings first.",
            "REGOS_DEFAULT_PRICE_TYPE_NOT_CONFIGURED",
        )

    payload: dict[str, Any] = {
        "stock_id": warehouse["id"],
        "price_type_id": price_type["id"],
        "ids": page_ids,
        "sort_orders": [{"column": "Name", "direction": "ASC"}],
        "zero_quantity": include_zero_quantity,
        "zero_price": include_zero_price,
        "image_size": "Medium",
        "type": "Item",
        "deleted_mark": False,
        "limit": len(page_ids),
        "offset": 0,
    }
    if search and search.strip():
        payload["search"] = search.strip()

    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "item/getext",
        payload,
    )
    result = response.get("result") or []

    by_id: dict[int, dict[str, Any]] = {}
    for row in result:
        if not isinstance(row, dict):
            continue
        product = _map_product(row)
        if _matches_product_filters(
            product,
            include_zero_quantity=include_zero_quantity,
            include_zero_price=include_zero_price,
        ):
            by_id[int(product["regos_item_id"])] = product

    products = [by_id[product_id] for product_id in page_ids if product_id in by_id]
    next_offset = offset + limit if offset + limit < total else 0

    return {
        "products": products,
        "next_offset": next_offset,
        "total": total,
    }


def _map_product(row: dict[str, Any]) -> dict[str, Any]:
    item = row.get("item") if isinstance(row.get("item"), dict) else {}
    quantity = row.get("quantity") if isinstance(row.get("quantity"), dict) else {}

    regos_item_id = item.get("id")
    if not isinstance(regos_item_id, int) or regos_item_id <= 0:
        raise bad_request("Regos returned an invalid product item.", "REGOS_PRODUCT_INVALID")

    name = _coerce_text(item.get("name")) or _coerce_text(item.get("fullname")) or f"#{regos_item_id}"
    category = (
        _nested_text(item, "group", "name")
        or _nested_text(item, "department", "name")
        or "Other"
    )
    barcode = _coerce_text(item.get("base_barcode")) or ""
    code = _coerce_text(item.get("code")) or ""
    unit = item.get("unit") if isinstance(item.get("unit"), dict) else {}
    unit_name = _coerce_text(unit.get("name")) or ""
    unit_type = _coerce_unit_type(unit.get("type"))
    sku = (
        _coerce_text(item.get("articul"))
        or barcode
        or code
        or str(regos_item_id)
    )

    return {
        "id": str(regos_item_id),
        "regos_item_id": regos_item_id,
        "group_id": item.get("group", {}).get("id")
        if isinstance(item.get("group"), dict) and isinstance(item["group"].get("id"), int)
        else None,
        "name": name,
        "price": _coerce_number(row.get("price")),
        "category": category,
        "stock": _coerce_number(quantity.get("allowed"), quantity.get("common")),
        "image": _coerce_text(row.get("image_url")) or _coerce_text(item.get("image_url")) or "",
        "sku": sku,
        "barcode": barcode,
        "code": code,
        "unit_name": unit_name,
        "unit_type": unit_type,
    }


def _matches_product_filters(
    product: dict[str, Any], *, include_zero_quantity: bool, include_zero_price: bool
) -> bool:
    if not include_zero_quantity and float(product.get("stock") or 0) <= 0:
        return False
    if not include_zero_price and float(product.get("price") or 0) <= 0:
        return False
    return True


def _nested_text(obj: dict[str, Any], *path: str) -> str | None:
    current: Any = obj
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return _coerce_text(current)


def _coerce_text(value: Any) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, (int, float)):
        return str(value)
    return None


def _coerce_number(*values: Any) -> float:
    for value in values:
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                continue
    return 0.0


def _coerce_unit_type(value: Any) -> int | None:
    if value in (1, 2):
        return int(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in ("pcs", "1"):
            return 1
        if text in ("non_pcs", "2"):
            return 2
    return None
