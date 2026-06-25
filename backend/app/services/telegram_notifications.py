from typing import Literal

TelegramNotificationType = Literal[
    "purchase",
    "return_purchase",
    "wholesale",
    "wholesale_return",
    "payment",
    "inout",
    "movement",
]

ALL_NOTIFICATION_TYPES: tuple[TelegramNotificationType, ...] = (
    "purchase",
    "return_purchase",
    "wholesale",
    "wholesale_return",
    "payment",
    "inout",
    "movement",
)

_NOTIFICATION_TYPE_SET = frozenset(ALL_NOTIFICATION_TYPES)


def default_notification_types() -> list[str]:
    return list(ALL_NOTIFICATION_TYPES)


def normalize_notification_types(types: list[str] | None) -> set[str]:
    if not types:
        return set(ALL_NOTIFICATION_TYPES)
    valid = {item for item in types if item in _NOTIFICATION_TYPE_SET}
    return valid if valid else set(ALL_NOTIFICATION_TYPES)


def user_receives_notification(
    user_types: list[str] | None,
    notification_type: str,
) -> bool:
    return notification_type in normalize_notification_types(user_types)


def validate_notification_types(types: list[str]) -> list[str]:
    if not types:
        raise ValueError("At least one notification type is required")
    normalized: list[str] = []
    seen: set[str] = set()
    for item in types:
        if item not in _NOTIFICATION_TYPE_SET:
            raise ValueError(f"Unknown notification type: {item}")
        if item not in seen:
            normalized.append(item)
            seen.add(item)
    return normalized
