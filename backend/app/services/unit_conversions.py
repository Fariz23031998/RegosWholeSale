from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request, not_found
from app.models.unit_conversion import UnitConversion
from app.services import regos_items as regos_items_service


def _to_factor(value: Any) -> Decimal:
    try:
        factor = Decimal(str(value))
    except Exception as exc:  # noqa: BLE001
        raise bad_request("Invalid conversion factor.", "CONVERSION_FACTOR_INVALID") from exc
    if factor <= 0:
        raise bad_request(
            "Conversion factor must be greater than zero.",
            "CONVERSION_FACTOR_INVALID",
        )
    return factor


async def _unit_lookup(
    session: AsyncSession,
    company_id: int,
) -> dict[int, dict[str, Any]]:
    data = await regos_items_service.list_units(session, company_id)
    lookup: dict[int, dict[str, Any]] = {}
    for unit in data.get("units") or []:
        if not isinstance(unit, dict):
            continue
        unit_id = unit.get("id")
        if not isinstance(unit_id, int) or unit_id <= 0:
            continue
        raw_type = unit.get("type")
        unit_type: int | None = None
        if raw_type == "pcs":
            unit_type = 1
        elif raw_type == "non_pcs":
            unit_type = 2
        lookup[unit_id] = {
            "name": unit.get("name"),
            "type": unit_type,
        }
    return lookup


def _map_row(
    row: UnitConversion,
    units: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    main = units.get(row.main_unit_id) or {}
    secondary = units.get(row.secondary_unit_id) or {}
    price_type_id = row.price_type_id if isinstance(row.price_type_id, int) and row.price_type_id > 0 else None
    return {
        "id": row.id,
        "main_unit_id": row.main_unit_id,
        "secondary_unit_id": row.secondary_unit_id,
        "conversion_factor": float(row.conversion_factor),
        "price_type_id": price_type_id,
        "main_unit_name": main.get("name") if isinstance(main.get("name"), str) else None,
        "secondary_unit_name": (
            secondary.get("name") if isinstance(secondary.get("name"), str) else None
        ),
        "secondary_unit_type": (
            secondary.get("type") if isinstance(secondary.get("type"), int) else None
        ),
    }


async def list_conversions(
    session: AsyncSession,
    company_id: int,
) -> list[dict[str, Any]]:
    result = await session.execute(
        select(UnitConversion)
        .where(UnitConversion.company_id == company_id)
        .order_by(UnitConversion.id.asc())
    )
    rows = list(result.scalars().all())
    if not rows:
        return []
    units = await _unit_lookup(session, company_id)
    return [_map_row(row, units) for row in rows]


async def upsert_conversion(
    session: AsyncSession,
    company_id: int,
    *,
    main_unit_id: int,
    secondary_unit_id: int,
    conversion_factor: float,
    price_type_id: int | None = None,
) -> dict[str, Any]:
    if main_unit_id <= 0 or secondary_unit_id <= 0:
        raise bad_request("Invalid unit.", "UNIT_CONVERSION_UNIT_INVALID")
    if main_unit_id == secondary_unit_id:
        raise bad_request(
            "Secondary unit must differ from the main unit.",
            "UNIT_CONVERSION_SAME_UNIT",
        )
    resolved_price_type_id: int | None = None
    if price_type_id is not None:
        if price_type_id <= 0:
            raise bad_request("Invalid price type.", "UNIT_CONVERSION_PRICE_TYPE_INVALID")
        resolved_price_type_id = price_type_id

    factor = _to_factor(conversion_factor)
    result = await session.execute(
        select(UnitConversion).where(
            UnitConversion.company_id == company_id,
            UnitConversion.main_unit_id == main_unit_id,
            UnitConversion.secondary_unit_id == secondary_unit_id,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        row.conversion_factor = factor
        row.price_type_id = resolved_price_type_id
    else:
        row = UnitConversion(
            company_id=company_id,
            main_unit_id=main_unit_id,
            secondary_unit_id=secondary_unit_id,
            conversion_factor=factor,
            price_type_id=resolved_price_type_id,
        )
        session.add(row)

    await session.flush()
    units = await _unit_lookup(session, company_id)
    return _map_row(row, units)


async def delete_conversion(
    session: AsyncSession,
    company_id: int,
    conversion_id: int,
) -> None:
    if conversion_id <= 0:
        raise bad_request("Invalid conversion id.", "UNIT_CONVERSION_INVALID")
    result = await session.execute(
        select(UnitConversion).where(
            UnitConversion.company_id == company_id,
            UnitConversion.id == conversion_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise not_found("Conversion not found.", "UNIT_CONVERSION_NOT_FOUND")
    await session.delete(row)
    await session.flush()


def merge_conversions_into_products(
    products: list[dict[str, Any]],
    conversions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_pair = {
        (int(item["main_unit_id"]), int(item["secondary_unit_id"])): item
        for item in conversions
        if isinstance(item.get("main_unit_id"), int)
        and isinstance(item.get("secondary_unit_id"), int)
    }
    for product in products:
        main_unit_id = product.get("unit_id")
        secondary_unit_id = product.get("secondary_unit_id")
        conversion = None
        if (
            isinstance(main_unit_id, int)
            and isinstance(secondary_unit_id, int)
            and main_unit_id > 0
            and secondary_unit_id > 0
        ):
            conversion = by_pair.get((main_unit_id, secondary_unit_id))

        if not conversion:
            # Keep Regos secondary_unit_id if present; Sell ignores it without a factor.
            product["secondary_unit_name"] = None
            product["secondary_unit_type"] = None
            product["conversion_factor"] = None
            product["secondary_price"] = None
            product["secondary_price_type_id"] = None
            continue

        product["secondary_unit_id"] = conversion.get("secondary_unit_id")
        product["secondary_unit_name"] = conversion.get("secondary_unit_name")
        product["secondary_unit_type"] = conversion.get("secondary_unit_type")
        product["conversion_factor"] = conversion.get("conversion_factor")
        price_type_id = conversion.get("price_type_id")
        product["secondary_price_type_id"] = (
            price_type_id if isinstance(price_type_id, int) and price_type_id > 0 else None
        )
        product["secondary_price"] = None
    return products


def collect_secondary_price_type_ids(products: list[dict[str, Any]]) -> list[int]:
    ids: list[int] = []
    seen: set[int] = set()
    for product in products:
        price_type_id = product.get("secondary_price_type_id")
        if isinstance(price_type_id, int) and price_type_id > 0 and price_type_id not in seen:
            seen.add(price_type_id)
            ids.append(price_type_id)
    return ids


def apply_secondary_prices(
    products: list[dict[str, Any]],
    prices_by_type: dict[int, dict[int, float]],
) -> list[dict[str, Any]]:
    for product in products:
        price_type_id = product.get("secondary_price_type_id")
        item_id = product.get("regos_item_id")
        if not isinstance(price_type_id, int) or not isinstance(item_id, int):
            product["secondary_price"] = None
            continue
        type_prices = prices_by_type.get(item_id) or {}
        price = type_prices.get(price_type_id)
        product["secondary_price"] = float(price) if price is not None else None
    return products


async def enrich_products_with_secondary_prices(
    session: AsyncSession,
    company_id: int,
    products: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not products:
        return products
    price_type_ids = collect_secondary_price_type_ids(products)
    if not price_type_ids:
        return products
    from app.services.regos_prices.fetch_item_prices.fetch_item_prices import (
        fetch_item_prices_by_types,
    )

    item_ids = [
        product["regos_item_id"]
        for product in products
        if isinstance(product.get("regos_item_id"), int)
    ]
    prices_by_type = await fetch_item_prices_by_types(
        session, company_id, item_ids, price_type_ids
    )
    return apply_secondary_prices(products, prices_by_type)
