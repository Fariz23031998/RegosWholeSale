from typing import Any

from app.core.exceptions import bad_request


def parse_exchange_rate(value: Any, *, field: str = "exchange_rate") -> float:
    if value is None:
        return 1.0
    if isinstance(value, str):
        try:
            rate = float(value)
        except (ValueError, TypeError) as exc:
            raise bad_request(
                f"Invalid {field} value.",
                "CURRENCY_EXCHANGE_RATE_INVALID",
            ) from exc
    elif isinstance(value, (int, float)):
        rate = float(value)
    else:
        raise bad_request(
            f"Invalid {field} value.",
            "CURRENCY_EXCHANGE_RATE_INVALID",
        )
    if rate <= 0:
        raise bad_request(
            f"{field} must be greater than zero.",
            "CURRENCY_EXCHANGE_RATE_INVALID",
        )
    return rate


def same_currency(a: dict[str, Any] | None, b: dict[str, Any] | None) -> bool:
    if not a or not b:
        return False
    a_id = a.get("id")
    b_id = b.get("id")
    return isinstance(a_id, int) and isinstance(b_id, int) and a_id == b_id


def convert_between_rates(amount: float, from_rate: float, to_rate: float) -> float:
    from_rate = parse_exchange_rate(from_rate, field="sale exchange_rate")
    to_rate = parse_exchange_rate(to_rate, field="payment exchange_rate")
    return round(amount * from_rate / to_rate, 2)
