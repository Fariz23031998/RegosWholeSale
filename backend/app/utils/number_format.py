"""Number formatting utilities for Telegram document messages."""


def format_number(value, max_decimals: int = 2) -> str:
    if value is None or value == "":
        return "0"

    try:
        num = float(value)
    except (ValueError, TypeError):
        return "0"

    if num != num:
        return "0"

    rounded = round(num, max_decimals)
    parts = str(rounded).split(".")
    integer_part = parts[0]
    decimal_part = parts[1] if len(parts) > 1 else ""

    integer_reversed = integer_part[::-1]
    formatted_integer = " ".join(
        integer_reversed[i : i + 3] for i in range(0, len(integer_reversed), 3)
    )[::-1]

    if decimal_part:
        trimmed_decimal = decimal_part.rstrip("0")
        if trimmed_decimal:
            return f"{formatted_integer}.{trimmed_decimal}"

    return formatted_integer
