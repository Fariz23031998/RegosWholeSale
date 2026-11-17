from typing import Any, Literal

TelegramNotificationCategory = Literal[
    "purchase",
    "return_purchase",
    "wholesale",
    "wholesale_return",
    "payment",
    "inout",
    "movement",
    "out_of_stock",
    "pos_cheque",
    "pos_session",
]

TelegramNotificationLeaf = Literal[
    "purchase_performed",
    "purchase_cancelled",
    "return_purchase_performed",
    "return_purchase_cancelled",
    "wholesale_performed",
    "wholesale_cancelled",
    "wholesale_return_performed",
    "wholesale_return_cancelled",
    "payment_performed",
    "payment_cancelled",
    "inout_performed",
    "inout_cancelled",
    "movement_performed",
    "movement_cancelled",
    "out_of_stock",
    "pos_cheque_closed",
    "pos_cheque_cancelled",
    "pos_cheque_return",
    "pos_session_opened",
    "pos_session_closed",
]

NOTIFICATION_CATEGORIES: dict[str, tuple[str, ...]] = {
    "purchase": ("purchase_performed", "purchase_cancelled"),
    "return_purchase": ("return_purchase_performed", "return_purchase_cancelled"),
    "wholesale": ("wholesale_performed", "wholesale_cancelled"),
    "wholesale_return": ("wholesale_return_performed", "wholesale_return_cancelled"),
    "payment": ("payment_performed", "payment_cancelled"),
    "inout": ("inout_performed", "inout_cancelled"),
    "movement": ("movement_performed", "movement_cancelled"),
    "out_of_stock": ("out_of_stock",),
    "pos_cheque": ("pos_cheque_closed", "pos_cheque_cancelled", "pos_cheque_return"),
    "pos_session": ("pos_session_opened", "pos_session_closed"),
}

ALL_LEAF_NOTIFICATION_TYPES: tuple[str, ...] = tuple(
    leaf for leaves in NOTIFICATION_CATEGORIES.values() for leaf in leaves
)

LEGACY_PARENT_TYPES: tuple[str, ...] = tuple(NOTIFICATION_CATEGORIES.keys())

LEGACY_TO_LEAVES: dict[str, tuple[str, ...]] = NOTIFICATION_CATEGORIES

# Backward-compatible alias for tests and API `types` field.
ALL_NOTIFICATION_TYPES = ALL_LEAF_NOTIFICATION_TYPES

_LEAF_TYPE_SET = frozenset(ALL_LEAF_NOTIFICATION_TYPES)
_LEGACY_PARENT_SET = frozenset(LEGACY_PARENT_TYPES)
_POS_CHEQUE_LEAVES = frozenset(NOTIFICATION_CATEGORIES["pos_cheque"])

PAY_DEBT_NOTIFICATION_TYPE = "pos_cheque_pay_debt"

PosChequeStornoMode = Literal["all", "storno_only"]

POS_CHEQUE_STORNO_FILTER_KEYS: tuple[str, ...] = ("pos_cheque_closed", "pos_cheque_return")
_POS_CHEQUE_STORNO_FILTER_KEY_SET = frozenset(POS_CHEQUE_STORNO_FILTER_KEYS)
_POS_CHEQUE_STORNO_MODES = frozenset({"all", "storno_only"})
DEFAULT_POS_CHEQUE_STORNO_MODE: PosChequeStornoMode = "all"


def default_notification_types() -> list[str]:
    return list(ALL_LEAF_NOTIFICATION_TYPES)


def default_pos_cheque_storno_filters() -> dict[str, PosChequeStornoMode]:
    return {key: DEFAULT_POS_CHEQUE_STORNO_MODE for key in POS_CHEQUE_STORNO_FILTER_KEYS}


def normalize_pos_cheque_storno_filters(
    value: object | None,
) -> dict[str, PosChequeStornoMode]:
    normalized = default_pos_cheque_storno_filters()
    if not isinstance(value, dict):
        return normalized
    for key in POS_CHEQUE_STORNO_FILTER_KEYS:
        mode = value.get(key)
        if mode in _POS_CHEQUE_STORNO_MODES:
            normalized[key] = mode  # type: ignore[assignment]
    return normalized


def validate_pos_cheque_storno_filters(value: object) -> dict[str, PosChequeStornoMode]:
    if not isinstance(value, dict):
        raise ValueError("pos_cheque_storno_filters must be an object")
    for key in value:
        if key not in _POS_CHEQUE_STORNO_FILTER_KEY_SET:
            raise ValueError(f"Unknown pos cheque storno filter key: {key}")
        mode = value[key]
        if mode not in _POS_CHEQUE_STORNO_MODES:
            raise ValueError(f"Unknown pos cheque storno filter mode: {mode}")
    return normalize_pos_cheque_storno_filters(value)


def pos_cheque_storno_mode_for(
    filters: object | None,
    notification_type: str,
) -> PosChequeStornoMode:
    if notification_type not in _POS_CHEQUE_STORNO_FILTER_KEY_SET:
        return DEFAULT_POS_CHEQUE_STORNO_MODE
    return normalize_pos_cheque_storno_filters(filters)[notification_type]


def user_matches_pos_cheque_storno_filter(
    filters: object | None,
    notification_type: str,
    *,
    cheque_has_storno: bool | None,
) -> bool:
    if notification_type not in _POS_CHEQUE_STORNO_FILTER_KEY_SET:
        return True
    mode = pos_cheque_storno_mode_for(filters, notification_type)
    if mode == "all":
        return True
    if cheque_has_storno is None:
        return True
    return bool(cheque_has_storno)


def expand_to_leaf_types(types: list[str] | None) -> set[str]:
    if not types:
        return set(ALL_LEAF_NOTIFICATION_TYPES)

    expanded: set[str] = set()
    for item in types:
        if item in _LEAF_TYPE_SET:
            expanded.add(item)
        elif item in _LEGACY_PARENT_SET:
            expanded.update(LEGACY_TO_LEAVES[item])

    return expanded if expanded else set(ALL_LEAF_NOTIFICATION_TYPES)


def normalize_notification_types(types: list[str] | None) -> set[str]:
    return expand_to_leaf_types(types)


def resolve_document_notification_type(parent: str, *, is_cancelled: bool) -> str:
    suffix = "cancelled" if is_cancelled else "performed"
    return f"{parent}_{suffix}"


def resolve_pos_cheque_notification_type(variant: str, cheque: dict[str, Any]) -> str:
    if variant == "canceled":
        return "pos_cheque_cancelled"
    if variant == "pay_debt":
        return PAY_DEBT_NOTIFICATION_TYPE
    if variant == "closed" and bool(cheque.get("is_return")):
        return "pos_cheque_return"
    if variant == "closed":
        return "pos_cheque_closed"
    raise ValueError(f"Unknown POS cheque variant: {variant}")


def resolve_pos_session_notification_type(variant: str) -> str:
    if variant == "opened":
        return "pos_session_opened"
    if variant == "closed":
        return "pos_session_closed"
    raise ValueError(f"Unknown POS session variant: {variant}")


def user_receives_pos_cheque_pay_debt(user_types: list[str] | None) -> bool:
    normalized = normalize_notification_types(user_types)
    if "pos_cheque" in (user_types or []):
        return True
    return bool(normalized & _POS_CHEQUE_LEAVES)


def user_receives_notification(
    user_types: list[str] | None,
    notification_type: str,
) -> bool:
    if notification_type == PAY_DEBT_NOTIFICATION_TYPE:
        return user_receives_pos_cheque_pay_debt(user_types)
    return notification_type in normalize_notification_types(user_types)


def validate_notification_types(types: list[str]) -> list[str]:
    if not types:
        raise ValueError("At least one notification type is required")

    normalized: list[str] = []
    seen: set[str] = set()
    for item in types:
        if item in _LEAF_TYPE_SET:
            if item not in seen:
                normalized.append(item)
                seen.add(item)
            continue
        if item in _LEGACY_PARENT_SET:
            raise ValueError(
                f"Legacy parent notification type is not allowed: {item}. "
                "Use subcategory types instead."
            )
        raise ValueError(f"Unknown notification type: {item}")
    return normalized


def notification_categories_response() -> list[dict[str, object]]:
    return [
        {"id": category_id, "subcategories": list(leaves)}
        for category_id, leaves in NOTIFICATION_CATEGORIES.items()
    ]
