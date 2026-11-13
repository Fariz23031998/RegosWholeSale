"""Click merchant pay URL + signature helpers (shared cabinet with DocVision)."""

from __future__ import annotations

import hashlib
from urllib.parse import urlencode

from app.config import get_settings

REGOS_CLICK_ORDER_PREFIX = "rw_"
ALLOWED_CHECKOUT_PERIODS = (1, 3, 6, 12)


def merchant_trans_id_for_order(order_id: str) -> str:
    return f"{REGOS_CLICK_ORDER_PREFIX}{order_id}"


def order_id_from_merchant_trans_id(merchant_trans_id: str) -> str | None:
    value = str(merchant_trans_id or "")
    if not value.startswith(REGOS_CLICK_ORDER_PREFIX):
        return None
    order_id = value[len(REGOS_CLICK_ORDER_PREFIX) :]
    return order_id or None


def is_click_configured() -> bool:
    settings = get_settings()
    return all(
        [
            settings.click_merchant_id.strip(),
            settings.click_service_id.strip(),
            settings.click_merchant_user_id.strip(),
            settings.click_secret_key.strip(),
        ]
    )


def is_checkout_configured() -> bool:
    settings = get_settings()
    return settings.subscription_monthly_price_uzs > 0 and is_click_configured()


def format_click_url(*, order_id: str, amount: int | float) -> str:
    settings = get_settings()
    if not is_click_configured():
        raise ValueError("Click is not configured")
    params = {
        "service_id": settings.click_service_id.strip(),
        "merchant_id": settings.click_merchant_id.strip(),
        "merchant_user_id": settings.click_merchant_user_id.strip(),
        "amount": str(int(amount)),
        "transaction_param": merchant_trans_id_for_order(order_id),
        "return_url": settings.click_return_url.strip() or "https://regosoptom.uz/billing",
    }
    return f"{settings.click_payment_base_url.rstrip('/')}?{urlencode(params)}"


def click_generate_sign_string(
    click_trans_id: str,
    service_id: str,
    secret_key: str,
    merchant_trans_id: str,
    merchant_prepare_id: str,
    amount: str,
    action: str,
    sign_time: str,
) -> str:
    data = (
        f"{click_trans_id}{service_id}{secret_key}{merchant_trans_id}"
        f"{merchant_prepare_id}{amount}{action}{sign_time}"
    )
    return hashlib.md5(data.encode("utf-8")).hexdigest()


def verify_click_signature(payload: dict) -> bool:
    settings = get_settings()
    secret = settings.click_secret_key.strip()
    if not secret or not payload.get("sign_string"):
        return False
    calc = click_generate_sign_string(
        str(payload.get("click_trans_id", "")),
        str(payload.get("service_id", "")),
        secret,
        str(payload.get("merchant_trans_id", "")),
        str(payload.get("merchant_prepare_id", "")),
        str(payload.get("amount", "")),
        str(payload.get("action", "")),
        str(payload.get("sign_time", "")),
    )
    return calc == str(payload["sign_string"])
