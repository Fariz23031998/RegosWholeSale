from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_permission
from app.database import get_db
from app.schemas.sales import (
    CheckoutRequest,
    CheckoutResponse,
    WholesaleDocumentsResponse,
    WholesaleOperationsResponse,
    WholesaleReturnDocumentsResponse,
    WholesaleReturnRequest,
    WholesaleReturnResponse,
    WholesaleReturnSummaryResponse,
)
from app.services import regos_sales as regos_sales_service

router = APIRouter(prefix="/sales", tags=["sales"])


@router.post("/checkout", response_model=CheckoutResponse)
async def checkout_sale(
    body: CheckoutRequest,
    current: CurrentUser = Depends(require_permission("sales.write")),
    session: AsyncSession = Depends(get_db),
) -> CheckoutResponse:
    result = await regos_sales_service.complete_checkout(
        session,
        current.company_id,
        current.id,
        body.model_dump(),
        allow_regos_overrides="pos.override_regos" in current.permissions,
    )
    return CheckoutResponse(**result)


@router.get("/wholesale-documents", response_model=WholesaleDocumentsResponse)
async def get_wholesale_documents(
    start_date: int | None = Query(default=None),
    end_date: int | None = Query(default=None),
    partner_ids: list[int] | None = Query(default=None),
    stock_ids: list[int] | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    current: CurrentUser = Depends(require_permission("sales.read")),
    session: AsyncSession = Depends(get_db),
) -> WholesaleDocumentsResponse:
    data = await regos_sales_service.list_wholesale_documents(
        session,
        current.company_id,
        user_id=current.id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        stock_ids=stock_ids,
        offset=offset,
        limit=limit,
    )
    return WholesaleDocumentsResponse(**data)


@router.get(
    "/wholesale-documents/{document_id}/operations",
    response_model=WholesaleOperationsResponse,
)
async def get_wholesale_operations(
    document_id: int,
    current: CurrentUser = Depends(require_permission("sales.read")),
    session: AsyncSession = Depends(get_db),
) -> WholesaleOperationsResponse:
    data = await regos_sales_service.list_wholesale_operations(
        session,
        current.company_id,
        document_id,
    )
    return WholesaleOperationsResponse(**data)


@router.get("/wholesale-return-documents", response_model=WholesaleReturnDocumentsResponse)
async def get_wholesale_return_documents(
    start_date: int | None = Query(default=None),
    end_date: int | None = Query(default=None),
    partner_ids: list[int] | None = Query(default=None),
    stock_ids: list[int] | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    current: CurrentUser = Depends(require_permission("sales.read")),
    session: AsyncSession = Depends(get_db),
) -> WholesaleReturnDocumentsResponse:
    data = await regos_sales_service.list_wholesale_return_documents(
        session,
        current.company_id,
        user_id=current.id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        stock_ids=stock_ids,
        offset=offset,
        limit=limit,
    )
    return WholesaleReturnDocumentsResponse(**data)


@router.get(
    "/wholesale-return-documents/{document_id}/operations",
    response_model=WholesaleOperationsResponse,
)
async def get_wholesale_return_operations(
    document_id: int,
    current: CurrentUser = Depends(require_permission("sales.read")),
    session: AsyncSession = Depends(get_db),
) -> WholesaleOperationsResponse:
    data = await regos_sales_service.list_wholesale_return_operations(
        session,
        current.company_id,
        document_id,
    )
    return WholesaleOperationsResponse(**data)


@router.get(
    "/wholesale-documents/{document_id}/return-summary",
    response_model=WholesaleReturnSummaryResponse,
)
async def get_wholesale_return_summary(
    document_id: int,
    current: CurrentUser = Depends(require_permission("sales.read")),
    session: AsyncSession = Depends(get_db),
) -> WholesaleReturnSummaryResponse:
    data = await regos_sales_service.get_wholesale_return_summary(
        session,
        current.company_id,
        document_id,
        user_id=current.id,
    )
    return WholesaleReturnSummaryResponse(**data)


@router.post("/wholesale-returns", response_model=WholesaleReturnResponse)
async def create_wholesale_return(
    body: WholesaleReturnRequest,
    current: CurrentUser = Depends(require_permission("sales.write")),
    session: AsyncSession = Depends(get_db),
) -> WholesaleReturnResponse:
    result = await regos_sales_service.complete_wholesale_return(
        session,
        current.company_id,
        current.id,
        body.model_dump(),
        allow_regos_overrides="pos.override_regos" in current.permissions,
    )
    return WholesaleReturnResponse(**result)
