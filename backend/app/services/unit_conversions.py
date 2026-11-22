from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request
from app.models.unit_conversion import ItemUnitConversion
from app.services import pos_settings as pos_settings_service
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
    row: ItemUnitConversion,
    units: dict[int, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    secondary: dict[str, Any] = {}
    if units is not None:
        secondary = units.get(row.secondary_unit_id) or {}
    return {
        "id": row.id,
        "regos_item_id": row.regos_item_id,
        "secondary_unit_id": row.secondary_unit_id,
        "conversion_factor": float(row.conversion_factor),
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
        select(ItemUnitConversion)
        .where(ItemUnitConversion.company_id == company_id)
        .order_by(ItemUnitConversion.id.asc())
    )
    rows = list(result.scalars().all())
    if not rows:
        return []
    units = await _unit_lookup(session, company_id)
    return [_map_row(row, units) for row in rows]


async def get_conversion_for_item(
    session: AsyncSession,
    company_id: int,
    regos_item_id: int,
) -> dict[str, Any] | None:
    if regos_item_id <= 0:
        return None
    result = await session.execute(
        select(ItemUnitConversion).where(
            ItemUnitConversion.company_id == company_id,
            ItemUnitConversion.regos_item_id == regos_item_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        return None
    return _map_row(row)


async def upsert_item_conversion(
    session: AsyncSession,
    company_id: int,
    *,
    regos_item_id: int,
    secondary_unit_id: int,
    conversion_factor: float,
) -> dict[str, Any]:
    if regos_item_id <= 0:
        raise bad_request("Invalid item.", "ITEM_CONVERSION_ITEM_INVALID")
    if secondary_unit_id <= 0:
        raise bad_request("Invalid secondary unit.", "ITEM_CONVERSION_UNIT_INVALID")

    factor = _to_factor(conversion_factor)
    result = await session.execute(
        select(ItemUnitConversion).where(
            ItemUnitConversion.company_id == company_id,
            ItemUnitConversion.regos_item_id == regos_item_id,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        row.secondary_unit_id = secondary_unit_id
        row.conversion_factor = factor
    else:
        row = ItemUnitConversion(
            company_id=company_id,
            regos_item_id=regos_item_id,
            secondary_unit_id=secondary_unit_id,
            conversion_factor=factor,
        )
        session.add(row)

    await session.flush()
    return _map_row(row)


async def delete_item_conversion(
    session: AsyncSession,
    company_id: int,
    regos_item_id: int,
) -> None:
    if regos_item_id <= 0:
        return
    result = await session.execute(
        select(ItemUnitConversion).where(
            ItemUnitConversion.company_id == company_id,
            ItemUnitConversion.regos_item_id == regos_item_id,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        await session.delete(row)
        await session.flush()


def merge_conversions_into_products(
    products: list[dict[str, Any]],
    conversions: list[dict[str, Any]],
    *,
    secondary_price_type_id: int | None = None,
) -> list[dict[str, Any]]:
    by_item = {
        int(item["regos_item_id"]): item
        for item in conversions
        if isinstance(item.get("regos_item_id"), int)
    }
    resolved_price_type_id = (
        secondary_price_type_id
        if isinstance(secondary_price_type_id, int) and secondary_price_type_id > 0
        else None
    )

    for product in products:
        item_id = product.get("regos_item_id")
        if not isinstance(item_id, int) or item_id <= 0:
            item_id = product.get("item_id")
        if not isinstance(item_id, int) or item_id <= 0:
            raw_id = product.get("id")
            item_id = raw_id if isinstance(raw_id, int) else None
        conversion = by_item.get(item_id) if isinstance(item_id, int) else None

        product_secondary = product.get("secondary_unit_id")
        if not conversion:
            product["secondary_unit_name"] = None
            product["secondary_unit_type"] = None
            product["conversion_factor"] = None
            product["secondary_price"] = None
            product["secondary_price_type_id"] = None
            continue

        conversion_secondary = conversion.get("secondary_unit_id")
        factor = conversion.get("conversion_factor")
        usable = (
            isinstance(conversion_secondary, int)
            and conversion_secondary > 0
            and isinstance(factor, (int, float))
            and float(factor) > 0
            and (
                not isinstance(product_secondary, int)
                or product_secondary <= 0
                or product_secondary == conversion_secondary
            )
        )
        if not usable:
            product["secondary_unit_name"] = None
            product["secondary_unit_type"] = None
            product["conversion_factor"] = None
            product["secondary_price"] = None
            product["secondary_price_type_id"] = None
            continue

        product["secondary_unit_id"] = conversion_secondary
        product["secondary_unit_name"] = conversion.get("secondary_unit_name")
        product["secondary_unit_type"] = conversion.get("secondary_unit_type")
        product["conversion_factor"] = float(factor)
        product["secondary_price_type_id"] = resolved_price_type_id
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


async def company_secondary_price_type_id(
    session: AsyncSession,
    company_id: int,
) -> int | None:
    settings = await pos_settings_service.get_pos_settings(session, company_id)
    return settings.get("secondary_price_type_id")


async def enrich_products_with_conversions(
    session: AsyncSession,
    company_id: int,
    products: list[dict[str, Any]],
    *,
    with_secondary_prices: bool = True,
) -> list[dict[str, Any]]:
    if not products:
        return products
    conversions = await list_conversions(session, company_id)
    price_type_id = await company_secondary_price_type_id(session, company_id)
    merge_conversions_into_products(
        products,
        conversions,
        secondary_price_type_id=price_type_id,
    )
    if with_secondary_prices:
        return await enrich_products_with_secondary_prices(session, company_id, products)
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
