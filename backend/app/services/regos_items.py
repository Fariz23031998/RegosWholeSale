from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request, not_found
from app.core.regos_api import regos_async_api_request_for_company


def _coerce_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_barcode_list(value: Any) -> list[str]:
    if isinstance(value, list):
        parts = value
    elif isinstance(value, str):
        parts = value.split(",")
    else:
        return []
    seen: set[str] = set()
    result: list[str] = []
    for part in parts:
        text = _coerce_text(part)
        if not text or text in seen:
            continue
        if len(text) > 64:
            text = text[:64]
        seen.add(text)
        result.append(text)
    return result


def _normalize_barcodes(body: dict[str, Any]) -> list[str]:
    barcodes = _parse_barcode_list(body.get("barcodes"))
    legacy = _coerce_text(body.get("barcode"))
    if legacy and legacy not in barcodes:
        barcodes.insert(0, legacy)
    return barcodes


def _coerce_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _nested_id_name(obj: Any) -> tuple[int | None, str | None]:
    if not isinstance(obj, dict):
        return None, None
    nid = _coerce_int(obj.get("id"))
    name = _coerce_text(obj.get("name"))
    return nid, name


def _map_unit(row: dict[str, Any]) -> dict[str, Any] | None:
    unit_id = _coerce_int(row.get("id"))
    if unit_id is None or unit_id <= 0:
        return None
    name = _coerce_text(row.get("name")) or f"#{unit_id}"
    raw_type = row.get("type")
    unit_type: str | None = None
    if raw_type in ("pcs", "non_pcs", 1, 2, "1", "2"):
        if raw_type in ("pcs", 2, "2"):
            unit_type = "pcs"
        elif raw_type in ("non_pcs", 1, "1"):
            unit_type = "non_pcs"
    return {"id": unit_id, "name": name, "type": unit_type}


def _map_tax_vat(row: dict[str, Any]) -> dict[str, Any] | None:
    vat_id = _coerce_int(row.get("id"))
    if vat_id is None or vat_id <= 0:
        return None
    name = _coerce_text(row.get("name")) or f"#{vat_id}"
    value = row.get("value")
    try:
        vat_value = float(value) if value is not None else None
    except (TypeError, ValueError):
        vat_value = None
    enabled = bool(row.get("enabled", True))
    return {"id": vat_id, "name": name, "value": vat_value, "enabled": enabled}


def _map_item(row: dict[str, Any]) -> dict[str, Any]:
    item_id = _coerce_int(row.get("id")) or 0
    group_id, group_name = _nested_id_name(row.get("group"))
    unit_id, unit_name = _nested_id_name(row.get("unit"))
    vat_id, vat_name = _nested_id_name(row.get("vat"))
    vat_obj = row.get("vat") if isinstance(row.get("vat"), dict) else {}
    vat_value_raw = vat_obj.get("value") if isinstance(vat_obj, dict) else None
    try:
        vat_value = float(vat_value_raw) if vat_value_raw is not None else None
    except (TypeError, ValueError):
        vat_value = None

    barcodes = _parse_barcode_list(row.get("barcode_list"))
    barcode = _coerce_text(row.get("base_barcode"))
    if barcode:
        if barcode not in barcodes:
            barcodes.insert(0, barcode)
    elif barcodes:
        barcode = barcodes[0]

    raw_type = row.get("type")
    item_type = "Service" if raw_type in ("Service", 2, "2") else "Item"

    code_raw = row.get("code")
    code = str(code_raw) if code_raw is not None and str(code_raw).strip() else None

    return {
        "id": item_id,
        "name": _coerce_text(row.get("name")) or f"#{item_id}",
        "fullname": _coerce_text(row.get("fullname")),
        "description": _coerce_text(row.get("description")),
        "articul": _coerce_text(row.get("articul")),
        "code": code,
        "barcode": barcode,
        "barcodes": barcodes,
        "icps": _coerce_text(row.get("icps")),
        "package_code": _coerce_text(row.get("package_code")),
        "is_labeled": bool(row.get("is_labeled", False)),
        "group_id": group_id or 0,
        "group_name": group_name,
        "unit_id": unit_id or 0,
        "unit_name": unit_name,
        "vat_id": vat_id or 0,
        "vat_name": vat_name,
        "vat_value": vat_value,
        "type": item_type,
    }


async def list_units(session: AsyncSession, company_id: int) -> dict[str, Any]:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "unit/get",
        {"limit": 10000, "offset": 0},
    )
    result = response.get("result") or []
    units: list[dict[str, Any]] = []
    for row in result:
        if not isinstance(row, dict):
            continue
        mapped = _map_unit(row)
        if mapped:
            units.append(mapped)
    units.sort(key=lambda u: (u["name"].lower(), u["id"]))
    return {"units": units}


async def list_tax_vats(session: AsyncSession, company_id: int) -> dict[str, Any]:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "taxvat/get",
        {"enabled": True},
    )
    result = response.get("result") or []
    tax_vats: list[dict[str, Any]] = []
    for row in result:
        if not isinstance(row, dict):
            continue
        mapped = _map_tax_vat(row)
        if mapped and mapped.get("enabled", True):
            tax_vats.append(mapped)
    tax_vats.sort(key=lambda v: (v["name"].lower(), v["id"]))
    return {"tax_vats": tax_vats}


async def get_item(
    session: AsyncSession,
    company_id: int,
    item_id: int,
) -> dict[str, Any]:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "item/get",
        {"ids": [item_id], "deleted_mark": False},
    )
    result = response.get("result") or []
    for row in result:
        if isinstance(row, dict) and _coerce_int(row.get("id")) == item_id:
            return _map_item(row)
    raise not_found("Item not found.", "ITEM_NOT_FOUND")


def _build_item_payload(body: dict[str, Any], *, require_required: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {}

    if "group_id" in body and body["group_id"] is not None:
        group_id = body["group_id"]
        if not isinstance(group_id, int) or group_id < 0:
            raise bad_request("Invalid product group.", "ITEM_GROUP_INVALID")
        payload["group_id"] = group_id
    elif require_required:
        raise bad_request("Product group is required.", "ITEM_GROUP_REQUIRED")

    if "unit_id" in body and body["unit_id"] is not None:
        unit_id = body["unit_id"]
        if not isinstance(unit_id, int) or unit_id <= 0:
            raise bad_request("Invalid unit.", "ITEM_UNIT_INVALID")
        payload["unit_id"] = unit_id
    elif require_required:
        raise bad_request("Unit is required.", "ITEM_UNIT_REQUIRED")

    if "vat_id" in body and body["vat_id"] is not None:
        vat_id = body["vat_id"]
        if not isinstance(vat_id, int) or vat_id <= 0:
            raise bad_request("Invalid VAT.", "ITEM_VAT_INVALID")
        payload["vat_id"] = vat_id
    elif require_required:
        raise bad_request("VAT is required.", "ITEM_VAT_REQUIRED")

    if "type" in body and body["type"] is not None:
        item_type = body["type"]
        if item_type not in ("Item", "Service"):
            raise bad_request("Invalid item type.", "ITEM_TYPE_INVALID")
        payload["type"] = item_type
    elif require_required:
        payload["type"] = "Item"

    name = _coerce_text(body.get("name")) if "name" in body else None
    if name:
        payload["name"] = name
    elif require_required:
        raise bad_request("Product name is required.", "ITEM_NAME_REQUIRED")

    for field in ("fullname", "description", "articul"):
        if field not in body:
            continue
        text = _coerce_text(body.get(field))
        if text is not None:
            payload[field] = text

    if "icps" in body:
        payload["icps"] = _coerce_text(body.get("icps")) or ""

    if "package_code" in body:
        payload["package_code"] = _coerce_text(body.get("package_code")) or ""

    if "is_labeled" in body and body["is_labeled"] is not None:
        payload["is_labeled"] = bool(body["is_labeled"])

    if "code" in body and body["code"] is not None:
        code = body["code"]
        if isinstance(code, int) and code >= 0:
            payload["code"] = code
        else:
            raise bad_request("Invalid product code.", "ITEM_CODE_INVALID")

    return payload


async def _resolve_barcode_type_id(session: AsyncSession, company_id: int) -> int:
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "barcodetype/get",
        {},
    )
    result = response.get("result") or []
    ean13_id: int | None = None
    first_id: int | None = None
    for row in result:
        if not isinstance(row, dict):
            continue
        tid = _coerce_int(row.get("id"))
        if tid is None or tid <= 0:
            continue
        if first_id is None:
            first_id = tid
        name = (_coerce_text(row.get("name")) or "").upper()
        if name == "EAN13":
            ean13_id = tid
            break
    chosen = ean13_id or first_id
    if chosen is None:
        raise bad_request("No barcode types available.", "BARCODE_TYPE_MISSING")
    return chosen


async def _add_barcode(
    session: AsyncSession,
    company_id: int,
    *,
    item_id: int,
    barcode: str,
    base: bool = True,
) -> None:
    barcode_type_id = await _resolve_barcode_type_id(session, company_id)
    await regos_async_api_request_for_company(
        session,
        company_id,
        "barcode/add",
        {
            "item_id": item_id,
            "barcode_type_id": barcode_type_id,
            "value": barcode,
            "base": base,
        },
    )


async def add_item(
    session: AsyncSession,
    company_id: int,
    body: dict[str, Any],
) -> dict[str, int]:
    payload = _build_item_payload(body, require_required=True)
    response = await regos_async_api_request_for_company(
        session,
        company_id,
        "item/add",
        payload,
    )
    result = response.get("result") or {}
    new_id = result.get("new_id") if isinstance(result, dict) else None
    if not isinstance(new_id, int) or new_id <= 0:
        raise bad_request("Regos did not return an item id.", "ITEM_CREATE_FAILED")

    barcodes = _normalize_barcodes(body)
    for index, barcode in enumerate(barcodes):
        await _add_barcode(
            session,
            company_id,
            item_id=new_id,
            barcode=barcode,
            base=index == 0,
        )

    return {"id": new_id}


async def edit_item(
    session: AsyncSession,
    company_id: int,
    item_id: int,
    body: dict[str, Any],
) -> dict[str, int]:
    payload = _build_item_payload(body, require_required=False)
    has_barcodes_field = "barcodes" in body or "barcode" in body
    barcodes = _normalize_barcodes(body) if has_barcodes_field else None

    if not payload and barcodes is None:
        raise bad_request("No item fields to update.", "ITEM_UPDATE_EMPTY")

    row_affected = 0
    if payload:
        payload["id"] = item_id
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            "item/edit",
            payload,
        )
        result = response.get("result") or {}
        row_affected = result.get("row_affected") if isinstance(result, dict) else 0
        if not isinstance(row_affected, int) or row_affected < 0:
            row_affected = 0

    if barcodes is not None:
        existing = await get_item(session, company_id, item_id)
        existing_barcodes = {
            str(b).strip()
            for b in (existing.get("barcodes") or [])
            if str(b).strip()
        }
        primary = _coerce_text(existing.get("barcode"))
        if primary:
            existing_barcodes.add(primary)
        for barcode in barcodes:
            if barcode in existing_barcodes:
                continue
            await _add_barcode(
                session,
                company_id,
                item_id=item_id,
                barcode=barcode,
                base=False,
            )
            existing_barcodes.add(barcode)
            row_affected = max(row_affected, 1)

    return {"row_affected": row_affected}
