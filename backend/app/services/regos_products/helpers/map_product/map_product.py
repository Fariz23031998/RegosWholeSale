from typing import Any
from app.core.exceptions import bad_request
from app.services.regos_products.helpers.coerce_text.coerce_text import coerce_text
from app.services.regos_products.helpers.coerce_number.coerce_number import coerce_number
from app.services.regos_products.helpers.coerce_unit_type.coerce_unit_type import coerce_unit_type
from app.services.regos_products.helpers.nested_text.nested_text import nested_text

def map_product(row: dict[str, Any]) -> dict[str, Any]:
    item = row.get("item") if isinstance(row.get("item"), dict) else {}
    quantity = row.get("quantity") if isinstance(row.get("quantity"), dict) else {}

    regos_item_id = item.get("id")
    if not isinstance(regos_item_id, int) or regos_item_id <= 0:
        raise bad_request("Regos returned an invalid product item.", "REGOS_PRODUCT_INVALID")

    name = coerce_text(item.get("name")) or coerce_text(item.get("fullname")) or f"#{regos_item_id}"
    category = (
        nested_text(item, "group", "name")
        or nested_text(item, "department", "name")
        or "Other"
    )
    barcode = coerce_text(item.get("base_barcode")) or ""
    barcode_list = coerce_text(item.get("barcode_list")) or barcode
    code = coerce_text(item.get("code")) or ""
    articul = coerce_text(item.get("articul")) or ""
    unit = item.get("unit") if isinstance(item.get("unit"), dict) else {}
    unit_name = coerce_text(unit.get("name")) or ""
    unit_type = coerce_unit_type(unit.get("type"))
    sku = (
        articul
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
        "price": coerce_number(row.get("price")),
        "category": category,
        "stock": coerce_number(quantity.get("allowed"), quantity.get("common")),
        "image": coerce_text(row.get("image_url")) or coerce_text(item.get("image_url")) or "",
        "sku": sku,
        "articul": articul,
        "barcode": barcode,
        "barcode_list": barcode_list,
        "code": code,
        "unit_name": unit_name,
        "unit_type": unit_type,
    }
