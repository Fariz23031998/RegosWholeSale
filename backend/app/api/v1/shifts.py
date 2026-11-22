from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_any_permission
from app.database import get_db
from app.models import ShiftStatus
from app.schemas.shifts import (
    EmployeeDebtResponse,
    ShiftCloseRequest,
    ShiftListResponse,
    ShiftOpenRequest,
    ShiftOperationCreateRequest,
    ShiftResponse,
)
from app.services import shifts as shifts_service

router = APIRouter(prefix="/shifts", tags=["shifts"])

_SHIFT_PERMS = ("shifts.manage", "shifts.manage_own")


@router.get("", response_model=ShiftListResponse)
async def list_shifts(
    user_id: int | None = Query(default=None, ge=1),
    status: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    current: CurrentUser = Depends(require_any_permission(*_SHIFT_PERMS)),
    session: AsyncSession = Depends(get_db),
) -> ShiftListResponse:
    await shifts_service.ensure_shift_management_enabled(session, current.company_id)
    status_enum = None
    if status in {"open", "closed"}:
        status_enum = ShiftStatus(status)
    shifts, total = await shifts_service.list_shifts(
        session,
        current.company_id,
        actor_id=current.id,
        actor_permissions=current.permissions,
        user_id=user_id,
        status=status_enum,
        offset=offset,
        limit=limit,
    )
    return ShiftListResponse(
        shifts=[ShiftResponse(**shifts_service.serialize_shift(s)) for s in shifts],
        total=total,
    )


@router.get("/current", response_model=ShiftResponse | None)
async def get_current_shift(
    current: CurrentUser = Depends(require_any_permission(*_SHIFT_PERMS)),
    session: AsyncSession = Depends(get_db),
) -> ShiftResponse | None:
    await shifts_service.ensure_shift_management_enabled(session, current.company_id)
    shift = await shifts_service.get_open_shift(session, current.company_id, current.id)
    if shift is None:
        return None
    preview = await shifts_service.compute_expected_cash(
        session, shift, actor_user_id=current.id
    )
    return ShiftResponse(
        **shifts_service.serialize_shift(shift, expected_preview=preview)
    )


@router.get("/employees/{user_id}/debt", response_model=EmployeeDebtResponse)
async def get_employee_debt(
    user_id: int,
    current: CurrentUser = Depends(require_any_permission(*_SHIFT_PERMS)),
    session: AsyncSession = Depends(get_db),
) -> EmployeeDebtResponse:
    data = await shifts_service.get_employee_debt(
        session,
        company_id=current.company_id,
        actor_id=current.id,
        actor_permissions=current.permissions,
        user_id=user_id,
    )
    return EmployeeDebtResponse(**data)


@router.get("/{shift_id}", response_model=ShiftResponse)
async def get_shift(
    shift_id: int,
    current: CurrentUser = Depends(require_any_permission(*_SHIFT_PERMS)),
    session: AsyncSession = Depends(get_db),
) -> ShiftResponse:
    await shifts_service.ensure_shift_management_enabled(session, current.company_id)
    shift = await shifts_service.get_shift(session, current.company_id, shift_id)
    shifts_service.assert_can_manage_user(
        actor_id=current.id,
        actor_permissions=current.permissions,
        target_user_id=shift.user_id,
    )
    preview = None
    if shift.status.value == "open":
        preview = await shifts_service.compute_expected_cash(
            session, shift, actor_user_id=current.id
        )
    return ShiftResponse(
        **shifts_service.serialize_shift(shift, expected_preview=preview)
    )


@router.post("/open", response_model=ShiftResponse)
async def open_shift(
    body: ShiftOpenRequest,
    current: CurrentUser = Depends(require_any_permission(*_SHIFT_PERMS)),
    session: AsyncSession = Depends(get_db),
) -> ShiftResponse:
    shift = await shifts_service.open_shift(
        session,
        company_id=current.company_id,
        actor_id=current.id,
        actor_permissions=current.permissions,
        amounts=[item.model_dump() for item in body.amounts],
        notes=body.notes,
        target_user_id=body.user_id,
    )
    return ShiftResponse(**shifts_service.serialize_shift(shift))


@router.post("/{shift_id}/operations", response_model=ShiftResponse)
async def add_shift_operation(
    shift_id: int,
    body: ShiftOperationCreateRequest,
    current: CurrentUser = Depends(require_any_permission(*_SHIFT_PERMS)),
    session: AsyncSession = Depends(get_db),
) -> ShiftResponse:
    shift = await shifts_service.add_operation(
        session,
        company_id=current.company_id,
        actor_id=current.id,
        actor_permissions=current.permissions,
        shift_id=shift_id,
        operation_type=body.operation_type,
        amount=body.amount,
        currency_id=body.currency_id,
        note=body.note,
    )
    preview = None
    if shift.status.value == "open":
        preview = await shifts_service.compute_expected_cash(
            session, shift, actor_user_id=current.id
        )
    return ShiftResponse(
        **shifts_service.serialize_shift(shift, expected_preview=preview)
    )


@router.post("/{shift_id}/close", response_model=ShiftResponse)
async def close_shift(
    shift_id: int,
    body: ShiftCloseRequest,
    current: CurrentUser = Depends(require_any_permission(*_SHIFT_PERMS)),
    session: AsyncSession = Depends(get_db),
) -> ShiftResponse:
    shift = await shifts_service.close_shift(
        session,
        company_id=current.company_id,
        actor_id=current.id,
        actor_permissions=current.permissions,
        shift_id=shift_id,
        amounts=[item.model_dump() for item in body.amounts],
        notes=body.notes,
    )
    return ShiftResponse(**shifts_service.serialize_shift(shift))
