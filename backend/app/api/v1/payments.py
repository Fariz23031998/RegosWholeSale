from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_permission
from app.database import get_db
from app.schemas.payments import (
    PaymentCreateRequest,
    PaymentDocument,
    PaymentEditRequest,
    PaymentMutationResponse,
    PaymentsListResponse,
)
from app.services import regos_payments as regos_payments_service

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get("", response_model=PaymentsListResponse)
async def list_payments(
    start_date: int | None = Query(default=None),
    end_date: int | None = Query(default=None),
    partner_ids: list[int] | None = Query(default=None),
    all_partners: bool = Query(default=True),
    firm_ids: list[int] | None = Query(default=None),
    direction: str | None = Query(default=None),
    performed: bool | None = Query(default=None),
    deleted_mark: bool | None = Query(default=False),
    search: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    current: CurrentUser = Depends(require_permission("payments.read")),
    session: AsyncSession = Depends(get_db),
) -> PaymentsListResponse:
    resolved_direction = None
    if direction in {"income", "outcome"}:
        resolved_direction = direction
    result = await regos_payments_service.list_payments(
        session,
        current.company_id,
        current.id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        firm_ids=firm_ids,
        direction=resolved_direction,
        performed=performed,
        deleted_mark=deleted_mark,
        search=search,
        offset=offset,
        limit=limit,
    )
    return PaymentsListResponse(**result)


@router.get("/{payment_id}", response_model=PaymentDocument)
async def get_payment(
    payment_id: int,
    current: CurrentUser = Depends(require_permission("payments.read")),
    session: AsyncSession = Depends(get_db),
) -> PaymentDocument:
    result = await regos_payments_service.get_payment(
        session, current.company_id, payment_id
    )
    return PaymentDocument(**result)


@router.post("", response_model=PaymentDocument)
async def create_payment(
    body: PaymentCreateRequest,
    current: CurrentUser = Depends(require_permission("payments.create")),
    session: AsyncSession = Depends(get_db),
) -> PaymentDocument:
    result = await regos_payments_service.create_payment(
        session,
        current.company_id,
        current.id,
        firm_id=body.firm_id,
        partner_id=body.partner_id,
        direction=body.direction,
        payment_type_id=body.payment_type_id,
        amount=body.amount,
        exchange_rate=body.exchange_rate,
        category_id=body.category_id,
        description=body.description,
        date=body.date,
    )
    return PaymentDocument(**result)


@router.patch("/{payment_id}", response_model=PaymentDocument)
async def edit_payment(
    payment_id: int,
    body: PaymentEditRequest,
    current: CurrentUser = Depends(require_permission("payments.edit")),
    session: AsyncSession = Depends(get_db),
) -> PaymentDocument:
    result = await regos_payments_service.edit_payment(
        session,
        current.company_id,
        payment_id,
        body.model_dump(exclude_unset=True),
    )
    return PaymentDocument(**result)


@router.post("/{payment_id}/perform", response_model=PaymentMutationResponse)
async def perform_payment(
    payment_id: int,
    current: CurrentUser = Depends(require_permission("payments.edit")),
    session: AsyncSession = Depends(get_db),
) -> PaymentMutationResponse:
    result = await regos_payments_service.perform_payment(
        session, current.company_id, payment_id
    )
    return PaymentMutationResponse(**result)


@router.post("/{payment_id}/perform-cancel", response_model=PaymentMutationResponse)
async def perform_cancel_payment(
    payment_id: int,
    current: CurrentUser = Depends(require_permission("payments.edit")),
    session: AsyncSession = Depends(get_db),
) -> PaymentMutationResponse:
    result = await regos_payments_service.perform_cancel_payment(
        session, current.company_id, payment_id
    )
    return PaymentMutationResponse(**result)


@router.post("/{payment_id}/delete-mark", response_model=PaymentMutationResponse)
async def delete_mark_payment(
    payment_id: int,
    current: CurrentUser = Depends(require_permission("payments.delete")),
    session: AsyncSession = Depends(get_db),
) -> PaymentMutationResponse:
    result = await regos_payments_service.delete_mark_payment(
        session, current.company_id, payment_id
    )
    return PaymentMutationResponse(**result)


@router.delete("/{payment_id}", response_model=PaymentMutationResponse)
async def delete_payment(
    payment_id: int,
    current: CurrentUser = Depends(require_permission("payments.delete")),
    session: AsyncSession = Depends(get_db),
) -> PaymentMutationResponse:
    result = await regos_payments_service.delete_payment(
        session, current.company_id, payment_id
    )
    return PaymentMutationResponse(**result)
