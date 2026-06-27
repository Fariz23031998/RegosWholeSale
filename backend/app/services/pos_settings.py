from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import not_found
from app.models import Company, User
from app.schemas.pos import (
    DEFAULT_CROSS_CURRENCY_PAYMENT_MODE,
    DEFAULT_INTERNAL_BARCODE_PIECE_PREFIX,
    DEFAULT_INTERNAL_BARCODE_WEIGHT_PREFIX,
    DEFAULT_POSTPONE_DOCUMENT_TYPE,
)
from app.services import settings as settings_service

POS_SETTINGS_KEY = "pos"
VALID_CROSS_CURRENCY_PAYMENT_MODES = {"payment_currency", "sale_currency_transfer"}
VALID_POSTPONE_DOCUMENT_TYPES = {"doc_wholesale", "doc_order_from_partner"}
DEFAULT_TENDERED_QUICK_AMOUNTS = [20.0, 50.0, 100.0]
MAX_TENDERED_QUICK_AMOUNTS = 8


async def get_pos_settings(session: AsyncSession, company_id: int) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    return _normalize_company_pos_settings((company.settings or {}).get(POS_SETTINGS_KEY))


async def patch_pos_settings(
    session: AsyncSession, company_id: int, patch: dict[str, Any]
) -> dict[str, Any]:
    company = await _get_company(session, company_id)
    current = _normalize_company_pos_settings((company.settings or {}).get(POS_SETTINGS_KEY))
    current = _apply_company_pos_patch(current, patch)

    settings = dict(company.settings or {})
    settings[POS_SETTINGS_KEY] = current
    company.settings = settings
    await session.flush()
    return current


async def get_effective_pos_settings(
    session: AsyncSession, user_id: int, company_id: int
) -> dict[str, Any]:
    company_settings = await get_pos_settings(session, company_id)
    user_overrides = await _get_user_pos_overrides(session, user_id)
    return _merge_pos_settings(company_settings, user_overrides)


async def patch_user_pos_settings(
    session: AsyncSession,
    user: User,
    patch: dict[str, Any],
) -> dict[str, Any]:
    all_settings = await settings_service.get_user_settings(session, user.id)
    current = _raw_user_pos_overrides(all_settings.get(POS_SETTINGS_KEY))
    current = _apply_user_pos_patch(current, patch)

    await settings_service.patch_user_settings(
        session,
        user,
        {POS_SETTINGS_KEY: current},
    )
    return await get_effective_pos_settings(session, user.id, user.company_id)


async def clear_user_pos_settings(session: AsyncSession, user: User) -> dict[str, Any]:
    await settings_service.delete_user_setting(session, user, POS_SETTINGS_KEY)
    return await get_effective_pos_settings(session, user.id, user.company_id)


def _merge_pos_settings(
    company_settings: dict[str, Any], user_overrides: dict[str, Any]
) -> dict[str, Any]:
    merged = dict(company_settings)

    if "allow_out_of_stock" in user_overrides:
        merged["allow_out_of_stock"] = bool(user_overrides["allow_out_of_stock"])

    if "tendered_quick_amounts" in user_overrides:
        merged["tendered_quick_amounts"] = _normalize_tendered_quick_amounts(
            user_overrides["tendered_quick_amounts"]
        )

    if "default_category" in user_overrides:
        merged["default_category"] = _normalize_default_category(
            user_overrides["default_category"]
        )
    else:
        merged["default_category"] = _normalize_default_category(
            company_settings.get("default_category")
        )

    if "auto_open_qty_keypad" in user_overrides:
        merged["auto_open_qty_keypad"] = bool(user_overrides["auto_open_qty_keypad"])
    else:
        merged["auto_open_qty_keypad"] = bool(company_settings.get("auto_open_qty_keypad", False))

    return merged


def _apply_company_pos_patch(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    updated = dict(current)

    if patch.get("allow_out_of_stock") is not None:
        updated["allow_out_of_stock"] = bool(patch["allow_out_of_stock"])

    if patch.get("tendered_quick_amounts") is not None:
        updated["tendered_quick_amounts"] = _normalize_tendered_quick_amounts(
            patch["tendered_quick_amounts"]
        )

    if patch.get("default_category") is not None:
        updated["default_category"] = _normalize_default_category(patch["default_category"])

    if patch.get("auto_open_qty_keypad") is not None:
        updated["auto_open_qty_keypad"] = bool(patch["auto_open_qty_keypad"])

    if patch.get("cross_currency_payment_mode") is not None:
        updated["cross_currency_payment_mode"] = _normalize_cross_currency_payment_mode(
            patch["cross_currency_payment_mode"]
        )

    if patch.get("internal_barcode_weight_prefix") is not None:
        updated["internal_barcode_weight_prefix"] = _normalize_internal_barcode_prefix(
            patch["internal_barcode_weight_prefix"],
            DEFAULT_INTERNAL_BARCODE_WEIGHT_PREFIX,
        )

    if patch.get("internal_barcode_piece_prefix") is not None:
        updated["internal_barcode_piece_prefix"] = _normalize_internal_barcode_prefix(
            patch["internal_barcode_piece_prefix"],
            DEFAULT_INTERNAL_BARCODE_PIECE_PREFIX,
        )

    if patch.get("postpone_document_type") is not None:
        updated["postpone_document_type"] = _normalize_postpone_document_type(
            patch["postpone_document_type"]
        )

    if patch.get("postpone_order_booked") is not None:
        updated["postpone_order_booked"] = bool(patch["postpone_order_booked"])

    return updated


def _apply_user_pos_patch(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    updated = dict(current)

    if patch.get("allow_out_of_stock") is not None:
        updated["allow_out_of_stock"] = bool(patch["allow_out_of_stock"])

    if patch.get("tendered_quick_amounts") is not None:
        updated["tendered_quick_amounts"] = _normalize_tendered_quick_amounts(
            patch["tendered_quick_amounts"]
        )

    if patch.get("default_category") is not None:
        updated["default_category"] = _normalize_default_category(patch["default_category"])

    if patch.get("auto_open_qty_keypad") is not None:
        updated["auto_open_qty_keypad"] = bool(patch["auto_open_qty_keypad"])

    return updated


def _normalize_company_pos_settings(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    return {
        "allow_out_of_stock": bool(data.get("allow_out_of_stock", False)),
        "tendered_quick_amounts": _normalize_tendered_quick_amounts(
            data.get("tendered_quick_amounts")
        ),
        "default_category": _normalize_default_category(data.get("default_category")),
        "auto_open_qty_keypad": bool(data.get("auto_open_qty_keypad", False)),
        "cross_currency_payment_mode": _normalize_cross_currency_payment_mode(
            data.get("cross_currency_payment_mode")
        ),
        "internal_barcode_weight_prefix": _normalize_internal_barcode_prefix(
            data.get("internal_barcode_weight_prefix"),
            DEFAULT_INTERNAL_BARCODE_WEIGHT_PREFIX,
        ),
        "internal_barcode_piece_prefix": _normalize_internal_barcode_prefix(
            data.get("internal_barcode_piece_prefix"),
            DEFAULT_INTERNAL_BARCODE_PIECE_PREFIX,
        ),
        "postpone_document_type": _normalize_postpone_document_type(
            data.get("postpone_document_type")
        ),
        "postpone_order_booked": bool(data.get("postpone_order_booked", True)),
    }


def _raw_user_pos_overrides(raw: Any) -> dict[str, Any]:
    return dict(raw) if isinstance(raw, dict) else {}


async def _get_user_pos_overrides(session: AsyncSession, user_id: int) -> dict[str, Any]:
    all_settings = await settings_service.get_user_settings(session, user_id)
    return _raw_user_pos_overrides(all_settings.get(POS_SETTINGS_KEY))


def _normalize_default_category(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    mode = data.get("mode", "all")
    if mode not in {"all", "featured", "group"}:
        mode = "all"

    group_id = data.get("group_id")
    if mode == "group":
        if not isinstance(group_id, int) or group_id <= 0:
            mode = "all"
            group_id = None
    else:
        group_id = None

    return {"mode": mode, "group_id": group_id}


def _normalize_tendered_quick_amounts(raw: Any) -> list[float]:
    if not isinstance(raw, list):
        return list(DEFAULT_TENDERED_QUICK_AMOUNTS)

    amounts: list[float] = []
    for item in raw:
        if isinstance(item, bool):
            continue
        if isinstance(item, (int, float)):
            value = float(item)
            if value > 0:
                amounts.append(value)

    if not amounts:
        return list(DEFAULT_TENDERED_QUICK_AMOUNTS)

    return amounts[:MAX_TENDERED_QUICK_AMOUNTS]


def _normalize_cross_currency_payment_mode(raw: Any) -> str:
    if isinstance(raw, str) and raw in VALID_CROSS_CURRENCY_PAYMENT_MODES:
        return raw
    return DEFAULT_CROSS_CURRENCY_PAYMENT_MODE


def _normalize_postpone_document_type(raw: Any) -> str:
    if isinstance(raw, str) and raw in VALID_POSTPONE_DOCUMENT_TYPES:
        return raw
    return DEFAULT_POSTPONE_DOCUMENT_TYPE


def _normalize_internal_barcode_prefix(raw: Any, default: str) -> str:
    if raw is None:
        return default
    if not isinstance(raw, str):
        return default
    digits = "".join(ch for ch in raw if ch.isdigit())
    return digits[:2]


async def _get_company(session: AsyncSession, company_id: int) -> Company:
    company = await session.get(Company, company_id)
    if not company:
        raise not_found("Company not found")
    return company
