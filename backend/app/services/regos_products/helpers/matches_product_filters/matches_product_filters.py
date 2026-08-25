from typing import Any

def matches_product_filters(
    product: dict[str, Any], *, include_zero_quantity: bool, include_zero_price: bool
) -> bool:
    if not include_zero_quantity and float(product.get("stock") or 0) <= 0:
        return False
    if not include_zero_price and float(product.get("price") or 0) <= 0:
        return False
    return True
