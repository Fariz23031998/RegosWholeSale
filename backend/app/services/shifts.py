"""Local cash shift management with Regos DocPayment expected-cash calculation."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import bad_request, conflict, forbidden, not_found
from app.models import (
    Shift,
    ShiftCurrencyAmount,
    ShiftOperation,
    ShiftOperationType,
    ShiftStatus,
    User,
)
from app.services import pos_settings as pos_settings_service
from app.services import regos_defaults as regos_defaults_service
from app.services import regos_payment_types as regos_payment_types_service
from app.services import regos_payments as regos_payments_service

IN_OPERATION_TYPES = {
    ShiftOperationType.cash_in,
    ShiftOperationType.change_in,
    ShiftOperationType.other_in,
}
OUT_OPERATION_TYPES = {
    ShiftOperationType.cash_out,
    ShiftOperationType.change_out,
    ShiftOperationType.other_out,
}
# debt_settlement reduces outstanding shortage; does not affect expected till cash.


def _dec(value: Any, default: str = "0") -> Decimal:
    if value is None:
        return Decimal(default)
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _to_unix(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def _currency_code_from_item(currency: dict[str, Any] | None) -> str | None:
    if not isinstance(currency, dict):
        return None
    if isinstance(currency.get("code_chr"), str) and currency["code_chr"].strip():
        return currency["code_chr"].strip()
    if isinstance(currency.get("name"), str) and currency["name"].strip():
        return currency["name"].strip()
    return None


def _shift_load_options():
    return (
        selectinload(Shift.operations).selectinload(ShiftOperation.created_by_user),
        selectinload(Shift.currency_amounts),
        selectinload(Shift.user),
    )


async def ensure_shift_management_enabled(session: AsyncSession, company_id: int) -> None:
    settings = await pos_settings_service.get_pos_settings(session, company_id)
    if not settings.get("shift_management_enabled"):
        raise forbidden(
            "Shift management is disabled for this company.",
            "SHIFT_MANAGEMENT_DISABLED",
        )


async def is_shift_management_enabled(session: AsyncSession, company_id: int) -> bool:
    settings = await pos_settings_service.get_pos_settings(session, company_id)
    return bool(settings.get("shift_management_enabled"))


async def require_open_shift_for_checkout(
    session: AsyncSession,
    *,
    company_id: int,
    user_id: int,
) -> Shift | None:
    """When shift management is enabled, require an open shift for the selling user."""
    if not await is_shift_management_enabled(session, company_id):
        return None
    shift = await get_open_shift(session, company_id, user_id)
    if shift is None:
        raise forbidden(
            "Open a cash shift before completing checkout.",
            "SHIFT_REQUIRED",
        )
    return shift


def can_manage_user(
    *,
    actor_id: int,
    actor_permissions: set[str] | list[str],
    target_user_id: int,
) -> bool:
    perms = set(actor_permissions)
    if "shifts.manage" in perms:
        return True
    if "shifts.manage_own" in perms and actor_id == target_user_id:
        return True
    return False


def assert_can_manage_user(
    *,
    actor_id: int,
    actor_permissions: set[str] | list[str],
    target_user_id: int,
) -> None:
    if not can_manage_user(
        actor_id=actor_id,
        actor_permissions=actor_permissions,
        target_user_id=target_user_id,
    ):
        raise forbidden(
            "You do not have permission to manage this shift.",
            "SHIFT_PERMISSION_DENIED",
        )


async def get_open_shift(
    session: AsyncSession,
    company_id: int,
    user_id: int,
) -> Shift | None:
    result = await session.execute(
        select(Shift)
        .options(*_shift_load_options())
        .where(
            Shift.company_id == company_id,
            Shift.user_id == user_id,
            Shift.status == ShiftStatus.open,
        )
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def get_shift(
    session: AsyncSession,
    company_id: int,
    shift_id: int,
) -> Shift:
    result = await session.execute(
        select(Shift)
        .options(*_shift_load_options())
        .where(Shift.company_id == company_id, Shift.id == shift_id)
        .execution_options(populate_existing=True)
    )
    shift = result.scalar_one_or_none()
    if shift is None:
        raise not_found("Shift not found.", "SHIFT_NOT_FOUND")
    return shift


async def list_shifts(
    session: AsyncSession,
    company_id: int,
    *,
    actor_id: int,
    actor_permissions: set[str] | list[str],
    user_id: int | None = None,
    status: ShiftStatus | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[Shift], int]:
    perms = set(actor_permissions)
    is_master = "shifts.manage" in perms

    query = (
        select(Shift)
        .options(*_shift_load_options())
        .where(Shift.company_id == company_id)
    )
    count_query = select(func.count()).select_from(Shift).where(Shift.company_id == company_id)

    if not is_master:
        query = query.where(Shift.user_id == actor_id)
        count_query = count_query.where(Shift.user_id == actor_id)
    elif user_id is not None:
        query = query.where(Shift.user_id == user_id)
        count_query = count_query.where(Shift.user_id == user_id)

    if status is not None:
        query = query.where(Shift.status == status)
        count_query = count_query.where(Shift.status == status)

    total = int((await session.execute(count_query)).scalar_one())
    result = await session.execute(
        query.order_by(Shift.opened_at.desc()).offset(offset).limit(limit)
    )
    return list(result.scalars().all()), total


async def _resolve_currency_meta(
    session: AsyncSession,
    company_id: int,
    currency_ids: list[int],
) -> dict[int, dict[str, Any]]:
    return await regos_defaults_service.fetch_currency_items_by_ids(
        session, company_id, currency_ids
    )


def _amount_row_for_currency(
    shift: Shift,
    currency_id: int,
) -> ShiftCurrencyAmount | None:
    for row in shift.currency_amounts:
        if row.currency_id == currency_id:
            return row
    return None


def outstanding_debt_for_amount(row: ShiftCurrencyAmount) -> Decimal:
    difference = _dec(row.difference_amount)
    if difference >= 0:
        return Decimal("0")
    shortage = -difference
    settled = _dec(row.debt_settled_amount)
    remaining = shortage - settled
    return remaining if remaining > 0 else Decimal("0")


def ops_net_by_currency(shift: Shift) -> dict[int, Decimal]:
    totals: dict[int, Decimal] = {}
    for op in shift.operations:
        if op.currency_id is None:
            continue
        if op.operation_type in IN_OPERATION_TYPES:
            totals[op.currency_id] = totals.get(op.currency_id, Decimal("0")) + _dec(op.amount)
        elif op.operation_type in OUT_OPERATION_TYPES:
            totals[op.currency_id] = totals.get(op.currency_id, Decimal("0")) - _dec(op.amount)
    return totals


async def open_shift(
    session: AsyncSession,
    *,
    company_id: int,
    actor_id: int,
    actor_permissions: set[str] | list[str],
    amounts: list[dict[str, Any]],
    notes: str | None = None,
    target_user_id: int | None = None,
) -> Shift:
    await ensure_shift_management_enabled(session, company_id)

    owner_id = target_user_id or actor_id
    assert_can_manage_user(
        actor_id=actor_id,
        actor_permissions=actor_permissions,
        target_user_id=owner_id,
    )

    if not amounts:
        raise bad_request(
            "At least one currency amount is required.",
            "SHIFT_INVALID_AMOUNT",
        )

    normalized: dict[int, Decimal] = {}
    for item in amounts:
        currency_id = item.get("currency_id")
        if not isinstance(currency_id, int) or currency_id < 1:
            raise bad_request("Invalid currency.", "SHIFT_INVALID_CURRENCY")
        amount = _dec(item.get("amount"))
        if amount < 0:
            raise bad_request("Starting cash must be zero or greater.", "SHIFT_INVALID_AMOUNT")
        if currency_id in normalized:
            raise bad_request(
                "Duplicate currency in starting amounts.",
                "SHIFT_DUPLICATE_CURRENCY",
            )
        normalized[currency_id] = amount

    existing = await get_open_shift(session, company_id, owner_id)
    if existing is not None:
        raise conflict(
            "This employee already has an open shift.",
            "SHIFT_ALREADY_OPEN",
        )

    owner = await session.get(User, owner_id)
    if owner is None or owner.company_id != company_id or not owner.is_active:
        raise not_found("User not found.", "USER_NOT_FOUND")

    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=owner_id
    )
    firm = defaults.get("firm") if isinstance(defaults.get("firm"), dict) else {}
    attached = (
        defaults.get("attached_user")
        if isinstance(defaults.get("attached_user"), dict)
        else {}
    )

    firm_id = firm.get("id") if isinstance(firm.get("id"), int) else None
    attached_user_id = attached.get("id") if isinstance(attached.get("id"), int) else None

    currency_meta = await _resolve_currency_meta(
        session, company_id, list(normalized.keys())
    )
    for currency_id in normalized:
        if currency_id not in currency_meta:
            raise bad_request(
                f"Currency {currency_id} was not found in Regos.",
                "SHIFT_INVALID_CURRENCY",
            )

    primary_currency_id = next(iter(normalized.keys()))
    primary_meta = currency_meta.get(primary_currency_id) or {}
    primary_code = _currency_code_from_item(primary_meta)
    primary_start = normalized[primary_currency_id]

    shift = Shift(
        company_id=company_id,
        user_id=owner_id,
        opened_by_user_id=actor_id,
        opened_at=datetime.now(timezone.utc),
        status=ShiftStatus.open,
        start_amount=primary_start,
        currency_id=primary_currency_id,
        currency_code=primary_code,
        firm_id=firm_id,
        attached_user_id=attached_user_id,
        debt_settled_amount=Decimal("0"),
        notes=notes.strip() if isinstance(notes, str) and notes.strip() else None,
    )
    session.add(shift)
    await session.flush()

    for currency_id, amount in normalized.items():
        meta = currency_meta.get(currency_id) or {}
        session.add(
            ShiftCurrencyAmount(
                shift_id=shift.id,
                company_id=company_id,
                currency_id=currency_id,
                currency_code=_currency_code_from_item(meta),
                start_amount=amount,
                debt_settled_amount=Decimal("0"),
            )
        )
    await session.flush()
    return await get_shift(session, company_id, shift.id)


async def add_operation(
    session: AsyncSession,
    *,
    company_id: int,
    actor_id: int,
    actor_permissions: set[str] | list[str],
    shift_id: int,
    operation_type: ShiftOperationType | str,
    amount: Decimal,
    currency_id: int,
    note: str | None = None,
) -> Shift:
    await ensure_shift_management_enabled(session, company_id)
    shift = await get_shift(session, company_id, shift_id)
    assert_can_manage_user(
        actor_id=actor_id,
        actor_permissions=actor_permissions,
        target_user_id=shift.user_id,
    )

    if isinstance(operation_type, str):
        try:
            operation_type = ShiftOperationType(operation_type)
        except ValueError as exc:
            raise bad_request("Invalid operation type.", "SHIFT_INVALID_OPERATION") from exc

    if amount <= 0:
        raise bad_request("Operation amount must be greater than zero.", "SHIFT_INVALID_AMOUNT")
    if currency_id < 1:
        raise bad_request("Invalid currency.", "SHIFT_INVALID_CURRENCY")

    currency_meta = await _resolve_currency_meta(session, company_id, [currency_id])
    meta = currency_meta.get(currency_id)
    if meta is None:
        raise bad_request(
            f"Currency {currency_id} was not found in Regos.",
            "SHIFT_INVALID_CURRENCY",
        )
    currency_code = _currency_code_from_item(meta)

    if operation_type == ShiftOperationType.debt_settlement:
        if shift.status != ShiftStatus.closed:
            raise bad_request(
                "Debt settlements can only be recorded on closed shifts.",
                "SHIFT_NOT_CLOSED",
            )
        row = _amount_row_for_currency(shift, currency_id)
        if row is None:
            raise bad_request(
                "No shortage recorded for this currency.",
                "SHIFT_SETTLEMENT_EXCEEDS_DEBT",
            )
        outstanding = outstanding_debt_for_amount(row)
        if amount > outstanding:
            raise bad_request(
                "Settlement amount exceeds outstanding shift debt.",
                "SHIFT_SETTLEMENT_EXCEEDS_DEBT",
            )
        row.debt_settled_amount = _dec(row.debt_settled_amount) + _dec(amount)
    elif shift.status != ShiftStatus.open:
        raise bad_request(
            "Cash operations can only be added to an open shift.",
            "SHIFT_NOT_OPEN",
        )
    else:
        # Ensure a currency amount row exists so preview/close include this currency.
        if _amount_row_for_currency(shift, currency_id) is None:
            session.add(
                ShiftCurrencyAmount(
                    shift_id=shift.id,
                    company_id=company_id,
                    currency_id=currency_id,
                    currency_code=currency_code,
                    start_amount=Decimal("0"),
                    debt_settled_amount=Decimal("0"),
                )
            )

    op = ShiftOperation(
        shift_id=shift.id,
        company_id=company_id,
        created_by_user_id=actor_id,
        operation_type=operation_type,
        amount=_dec(amount),
        currency_id=currency_id,
        currency_code=currency_code,
        note=note.strip() if isinstance(note, str) and note.strip() else None,
    )
    session.add(op)
    await session.flush()
    return await get_shift(session, company_id, shift.id)


async def compute_expected_cash(
    session: AsyncSession,
    shift: Shift,
    *,
    actor_user_id: int,
) -> dict[str, Any]:
    """Query Regos cash DocPayments for the shift window and combine with local ops."""
    ops_net = ops_net_by_currency(shift)

    end_at = shift.closed_at or datetime.now(timezone.utc)
    start_ts = _to_unix(shift.opened_at)
    end_ts = _to_unix(end_at)

    cash_type_ids = await _cash_payment_type_ids(session, shift.company_id)
    cash_by_currency: dict[int, Decimal] = {}
    code_by_currency: dict[int, str | None] = {
        row.currency_id: row.currency_code for row in shift.currency_amounts
    }
    docs_count = 0

    if cash_type_ids:
        payments = await _fetch_all_payments(
            session,
            company_id=shift.company_id,
            actor_user_id=actor_user_id,
            start_date=start_ts,
            end_date=end_ts,
            firm_id=shift.firm_id,
        )

        for payment in payments:
            type_id = payment.get("payment_type_id")
            if not isinstance(type_id, int) or type_id not in cash_type_ids:
                continue
            if shift.attached_user_id is not None:
                attached = payment.get("attached_user_id")
                if attached != shift.attached_user_id:
                    continue

            amount = payment.get("amount")
            if amount is None:
                continue
            amount_dec = _dec(amount)

            currency = (
                payment.get("currency") if isinstance(payment.get("currency"), dict) else {}
            )
            currency_id = currency.get("id")
            if not isinstance(currency_id, int) or currency_id < 1:
                # Fall back to shift legacy currency when payment has no currency.
                if shift.currency_id is None:
                    continue
                currency_id = shift.currency_id
                if currency_id not in code_by_currency:
                    code_by_currency[currency_id] = shift.currency_code
            else:
                code = _currency_code_from_item(currency)
                if code:
                    code_by_currency[currency_id] = code

            direction = payment.get("payment_direction")
            if direction == "outcome":
                cash_by_currency[currency_id] = (
                    cash_by_currency.get(currency_id, Decimal("0")) - amount_dec
                )
            else:
                cash_by_currency[currency_id] = (
                    cash_by_currency.get(currency_id, Decimal("0")) + amount_dec
                )
            docs_count += 1

    start_by_currency = {
        row.currency_id: _dec(row.start_amount) for row in shift.currency_amounts
    }
    for currency_id, code in code_by_currency.items():
        if currency_id not in start_by_currency:
            start_by_currency[currency_id] = Decimal("0")
            if currency_id not in code_by_currency:
                code_by_currency[currency_id] = code

    all_currency_ids = sorted(
        set(start_by_currency) | set(cash_by_currency) | set(ops_net)
    )

    by_currency: list[dict[str, Any]] = []
    for currency_id in all_currency_ids:
        start_amount = start_by_currency.get(currency_id, Decimal("0"))
        cash_from_docs = cash_by_currency.get(currency_id, Decimal("0"))
        net = ops_net.get(currency_id, Decimal("0"))
        expected = start_amount + cash_from_docs + net
        by_currency.append(
            {
                "currency_id": currency_id,
                "currency_code": code_by_currency.get(currency_id),
                "start_amount": start_amount,
                "cash_from_docs": cash_from_docs,
                "ops_net": net,
                "expected_amount": expected,
            }
        )

    return {
        "docs_count": docs_count,
        "by_currency": by_currency,
    }


async def close_shift(
    session: AsyncSession,
    *,
    company_id: int,
    actor_id: int,
    actor_permissions: set[str] | list[str],
    shift_id: int,
    amounts: list[dict[str, Any]],
    notes: str | None = None,
) -> Shift:
    await ensure_shift_management_enabled(session, company_id)
    shift = await get_shift(session, company_id, shift_id)
    assert_can_manage_user(
        actor_id=actor_id,
        actor_permissions=actor_permissions,
        target_user_id=shift.user_id,
    )

    if shift.status != ShiftStatus.open:
        raise bad_request("Shift is already closed.", "SHIFT_ALREADY_CLOSED")

    actual_by_currency: dict[int, Decimal] = {}
    for item in amounts:
        currency_id = item.get("currency_id")
        if not isinstance(currency_id, int) or currency_id < 1:
            raise bad_request("Invalid currency.", "SHIFT_INVALID_CURRENCY")
        amount = _dec(item.get("amount"))
        if amount < 0:
            raise bad_request("Actual cash must be zero or greater.", "SHIFT_INVALID_AMOUNT")
        if currency_id in actual_by_currency:
            raise bad_request(
                "Duplicate currency in actual amounts.",
                "SHIFT_DUPLICATE_CURRENCY",
            )
        actual_by_currency[currency_id] = amount

    breakdown = await compute_expected_cash(session, shift, actor_user_id=actor_id)
    expected_rows: list[dict[str, Any]] = breakdown["by_currency"]

    required_currency_ids: set[int] = set()
    for row in expected_rows:
        currency_id = int(row["currency_id"])
        start_amount = _dec(row["start_amount"])
        expected_amount = _dec(row["expected_amount"])
        cash_from_docs = _dec(row["cash_from_docs"])
        ops_net = _dec(row["ops_net"])
        if (
            start_amount != 0
            or expected_amount != 0
            or cash_from_docs != 0
            or ops_net != 0
        ):
            required_currency_ids.add(currency_id)

    missing = required_currency_ids - set(actual_by_currency.keys())
    if missing:
        raise bad_request(
            "Actual cash is required for every currency with till activity.",
            "SHIFT_MISSING_CURRENCY_AMOUNT",
        )

    expected_by_id = {int(row["currency_id"]): row for row in expected_rows}
    code_by_id = {
        int(row["currency_id"]): row.get("currency_code") for row in expected_rows
    }

    # Ensure amount rows exist for every currency we are closing.
    existing_ids = {row.currency_id for row in shift.currency_amounts}
    for currency_id in set(actual_by_currency) | set(expected_by_id):
        if currency_id not in existing_ids:
            session.add(
                ShiftCurrencyAmount(
                    shift_id=shift.id,
                    company_id=company_id,
                    currency_id=currency_id,
                    currency_code=code_by_id.get(currency_id),
                    start_amount=_dec(
                        (expected_by_id.get(currency_id) or {}).get("start_amount")
                    ),
                    debt_settled_amount=Decimal("0"),
                )
            )
    await session.flush()
    shift = await get_shift(session, company_id, shift.id)

    primary_expected = Decimal("0")
    primary_actual = Decimal("0")
    primary_difference = Decimal("0")

    for row in shift.currency_amounts:
        expected_row = expected_by_id.get(row.currency_id)
        expected = (
            _dec(expected_row["expected_amount"])
            if expected_row is not None
            else _dec(row.start_amount)
        )
        if row.currency_id in actual_by_currency:
            actual = actual_by_currency[row.currency_id]
        elif row.currency_id in required_currency_ids:
            # Should have been rejected above; defensive default.
            actual = Decimal("0")
        else:
            # Zero-activity currency not submitted — leave as zero actual.
            actual = Decimal("0")
        difference = actual - expected
        row.expected_amount = expected
        row.actual_amount = actual
        row.difference_amount = difference
        if expected_row and expected_row.get("currency_code"):
            row.currency_code = expected_row.get("currency_code")

        if row.currency_id == shift.currency_id or (
            shift.currency_id is None and primary_expected == 0 and primary_actual == 0
        ):
            primary_expected = expected
            primary_actual = actual
            primary_difference = difference

    # If legacy primary currency wasn't among rows, use first closed currency.
    if shift.currency_id is None and shift.currency_amounts:
        first = shift.currency_amounts[0]
        primary_expected = _dec(first.expected_amount)
        primary_actual = _dec(first.actual_amount)
        primary_difference = _dec(first.difference_amount)
        shift.currency_id = first.currency_id
        shift.currency_code = first.currency_code

    shift.closed_at = datetime.now(timezone.utc)
    shift.closed_by_user_id = actor_id
    shift.status = ShiftStatus.closed
    shift.expected_amount = primary_expected
    shift.actual_amount = primary_actual
    shift.difference_amount = primary_difference
    if isinstance(notes, str) and notes.strip():
        existing = shift.notes or ""
        shift.notes = f"{existing}\n{notes.strip()}".strip() if existing else notes.strip()

    await session.flush()
    return await get_shift(session, company_id, shift.id)


async def get_employee_debt(
    session: AsyncSession,
    *,
    company_id: int,
    actor_id: int,
    actor_permissions: set[str] | list[str],
    user_id: int,
) -> dict[str, Any]:
    await ensure_shift_management_enabled(session, company_id)
    assert_can_manage_user(
        actor_id=actor_id,
        actor_permissions=actor_permissions,
        target_user_id=user_id,
    )

    user = await session.get(User, user_id)
    if user is None or user.company_id != company_id:
        raise not_found("User not found.", "USER_NOT_FOUND")

    result = await session.execute(
        select(Shift)
        .options(selectinload(Shift.currency_amounts))
        .where(
            Shift.company_id == company_id,
            Shift.user_id == user_id,
            Shift.status == ShiftStatus.closed,
        )
    )
    shifts = list(result.scalars().all())
    totals: dict[int, dict[str, Any]] = {}
    for shift in shifts:
        for row in shift.currency_amounts:
            outstanding = outstanding_debt_for_amount(row)
            if outstanding <= 0:
                continue
            entry = totals.get(row.currency_id)
            if entry is None:
                totals[row.currency_id] = {
                    "currency_id": row.currency_id,
                    "currency_code": row.currency_code,
                    "amount": outstanding,
                }
            else:
                entry["amount"] = _dec(entry["amount"]) + outstanding
                if not entry.get("currency_code") and row.currency_code:
                    entry["currency_code"] = row.currency_code

    by_currency = sorted(totals.values(), key=lambda item: int(item["currency_id"]))
    return {
        "user_id": user_id,
        "user_display_name": user.display_name,
        "outstanding_debt_by_currency": by_currency,
    }


def serialize_operation(op: ShiftOperation) -> dict[str, Any]:
    created_by_name = None
    if op.created_by_user is not None:
        created_by_name = op.created_by_user.display_name
    return {
        "id": op.id,
        "shift_id": op.shift_id,
        "created_by_user_id": op.created_by_user_id,
        "created_by_display_name": created_by_name,
        "operation_type": op.operation_type.value,
        "amount": op.amount,
        "currency_id": op.currency_id,
        "currency_code": op.currency_code,
        "note": op.note,
        "created_at": op.created_at,
    }


def serialize_currency_amount(row: ShiftCurrencyAmount) -> dict[str, Any]:
    return {
        "currency_id": row.currency_id,
        "currency_code": row.currency_code,
        "start_amount": row.start_amount,
        "expected_amount": row.expected_amount,
        "actual_amount": row.actual_amount,
        "difference_amount": row.difference_amount,
        "debt_settled_amount": row.debt_settled_amount,
        "outstanding_debt": outstanding_debt_for_amount(row),
    }


def serialize_shift(
    shift: Shift,
    *,
    expected_preview: dict[str, Any] | None = None,
) -> dict[str, Any]:
    user_name = shift.user.display_name if shift.user is not None else None
    return {
        "id": shift.id,
        "company_id": shift.company_id,
        "user_id": shift.user_id,
        "user_display_name": user_name,
        "opened_by_user_id": shift.opened_by_user_id,
        "closed_by_user_id": shift.closed_by_user_id,
        "opened_at": shift.opened_at,
        "closed_at": shift.closed_at,
        "status": shift.status.value,
        "firm_id": shift.firm_id,
        "attached_user_id": shift.attached_user_id,
        "notes": shift.notes,
        "currency_amounts": [
            serialize_currency_amount(row) for row in shift.currency_amounts
        ],
        "operations": [serialize_operation(op) for op in shift.operations],
        "expected_preview": expected_preview,
    }


async def _cash_payment_type_ids(session: AsyncSession, company_id: int) -> set[int]:
    data = await regos_payment_types_service.list_payment_types(session, company_id)
    ids: set[int] = set()
    for item in data.get("payment_types") or []:
        if item.get("is_cash") and isinstance(item.get("id"), int):
            ids.add(item["id"])
    return ids


async def _fetch_all_payments(
    session: AsyncSession,
    *,
    company_id: int,
    actor_user_id: int,
    start_date: int,
    end_date: int,
    firm_id: int | None,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    offset = 0
    limit = 100
    while True:
        page = await regos_payments_service.list_payments(
            session,
            company_id,
            actor_user_id,
            start_date=start_date,
            end_date=end_date,
            firm_ids=[firm_id] if firm_id else None,
            all_partners=True,
            performed=True,
            deleted_mark=False,
            offset=offset,
            limit=limit,
        )
        batch = page.get("documents") or page.get("items") or page.get("payments") or []
        if not isinstance(batch, list):
            break
        items.extend(item for item in batch if isinstance(item, dict))
        total = int(page.get("total") or 0)
        if len(batch) < limit or (total and offset + len(batch) >= total):
            break
        offset += limit
        if offset > 5000:
            break
    return items
