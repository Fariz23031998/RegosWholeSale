from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, require_any_permission, require_permission
from app.core.exceptions import forbidden
from app.database import get_db
from app.schemas.sales import (
    CheckoutRequest,
    CheckoutResponse,
    PostponeRequest,
    PostponeResponse,
    WholesaleDocumentsResponse,
    WholesaleOperationsResponse,
    WholesalePaymentsResponse,
    WholesaleReturnDocumentsResponse,
    WholesaleReturnRequest,
    WholesaleReturnResponse,
    WholesaleReturnSummaryResponse,
)
from app.services import regos_sales as regos_sales_service

router = APIRouter(prefix="/sales", tags=["sales"])


def _permission_set(current: CurrentUser) -> set[str]:
    return set(current.permissions)


def _resolve_document_kind(document_kind: str | None) -> str:
    if document_kind in {"wholesale", "order_from_partner"}:
        return document_kind
    return "wholesale"


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
        permissions=_permission_set(current),
    )
    return CheckoutResponse(**result)


@router.post("/postpone", response_model=PostponeResponse)
async def postpone_sale(
    body: PostponeRequest,
    current: CurrentUser = Depends(require_permission("sales.postpone")),
    session: AsyncSession = Depends(get_db),
) -> PostponeResponse:
    result = await regos_sales_service.postpone_sale(
        session,
        current.company_id,
        current.id,
        body.model_dump(),
        permissions=_permission_set(current),
    )
    return PostponeResponse(**result)


@router.get("/wholesale-documents", response_model=WholesaleDocumentsResponse)
async def get_wholesale_documents(
    start_date: int | None = Query(default=None),
    end_date: int | None = Query(default=None),
    partner_ids: list[int] | None = Query(default=None),
    all_partners: bool = Query(default=True),
    stock_ids: list[int] | None = Query(default=None),
    all_stocks: bool = Query(default=True),
    performed: bool | None = Query(default=None),
    document_kind: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> WholesaleDocumentsResponse:
    if performed is False:
        if "sales.continue" not in current.permissions:
            raise forbidden("Missing permission: sales.continue", "FORBIDDEN")
    elif "sales.read" not in current.permissions:
        raise forbidden("Missing permission: sales.read", "FORBIDDEN")

    resolved_kind = _resolve_document_kind(document_kind)
    list_kwargs = dict(
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
        offset=offset,
        limit=limit,
    )
    if resolved_kind == "order_from_partner":
        data = await regos_sales_service.list_order_from_partner_documents(
            session,
            current.company_id,
            user_id=current.id,
            **list_kwargs,
        )
    else:
        data = await regos_sales_service.list_wholesale_documents(
            session,
            current.company_id,
            user_id=current.id,
            performed=performed,
            **list_kwargs,
        )
    return WholesaleDocumentsResponse(**data)


@router.get("/wholesale-operations", response_model=WholesaleOperationsResponse)
async def get_wholesale_operations_batch(
    document_ids: list[int] = Query(..., min_length=1),
    document_kind: str | None = Query(default=None),
    current: CurrentUser = Depends(
        require_any_permission("sales.read", "sales.continue")
    ),
    session: AsyncSession = Depends(get_db),
) -> WholesaleOperationsResponse:
    resolved_kind = _resolve_document_kind(document_kind)
    if resolved_kind == "order_from_partner":
        data = await regos_sales_service.list_order_from_partner_operations_batch(
            session,
            current.company_id,
            document_ids,
        )
    else:
        data = await regos_sales_service.list_wholesale_operations_batch(
            session,
            current.company_id,
            document_ids,
        )
    return WholesaleOperationsResponse(**data)


@router.get(
    "/wholesale-documents/{document_id}/operations",
    response_model=WholesaleOperationsResponse,
)
async def get_wholesale_operations(
    document_id: int,
    document_kind: str | None = Query(default=None),
    current: CurrentUser = Depends(
        require_any_permission("sales.read", "sales.continue")
    ),
    session: AsyncSession = Depends(get_db),
) -> WholesaleOperationsResponse:
    resolved_kind = _resolve_document_kind(document_kind)
    if resolved_kind == "order_from_partner":
        data = await regos_sales_service.list_order_from_partner_operations(
            session,
            current.company_id,
            document_id,
        )
    else:
        data = await regos_sales_service.list_wholesale_operations(
            session,
            current.company_id,
            document_id,
        )
    return WholesaleOperationsResponse(**data)


@router.get(
    "/wholesale-documents/{document_id}/payments",
    response_model=WholesalePaymentsResponse,
)
async def get_wholesale_document_payments(
    document_id: int,
    current: CurrentUser = Depends(require_permission("sales.read")),
    session: AsyncSession = Depends(get_db),
) -> WholesalePaymentsResponse:
    data = await regos_sales_service.list_wholesale_document_payments(
        session,
        current.company_id,
        document_id,
    )
    return WholesalePaymentsResponse(**data)


@router.get("/wholesale-return-documents", response_model=WholesaleReturnDocumentsResponse)
async def get_wholesale_return_documents(
    start_date: int | None = Query(default=None),
    end_date: int | None = Query(default=None),
    partner_ids: list[int] | None = Query(default=None),
    all_partners: bool = Query(default=True),
    stock_ids: list[int] | None = Query(default=None),
    all_stocks: bool = Query(default=True),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    current: CurrentUser = Depends(require_permission("returns.manage")),
    session: AsyncSession = Depends(get_db),
) -> WholesaleReturnDocumentsResponse:
    data = await regos_sales_service.list_wholesale_return_documents(
        session,
        current.company_id,
        user_id=current.id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
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
    current: CurrentUser = Depends(require_permission("returns.manage")),
    session: AsyncSession = Depends(get_db),
) -> WholesaleOperationsResponse:
    data = await regos_sales_service.list_wholesale_return_operations(
        session,
        current.company_id,
        document_id,
    )
    return WholesaleOperationsResponse(**data)


@router.get(
    "/wholesale-return-documents/{document_id}/payments",
    response_model=WholesalePaymentsResponse,
)
async def get_wholesale_return_document_payments(
    document_id: int,
    current: CurrentUser = Depends(require_permission("returns.manage")),
    session: AsyncSession = Depends(get_db),
) -> WholesalePaymentsResponse:
    data = await regos_sales_service.list_wholesale_return_document_payments(
        session,
        current.company_id,
        document_id,
    )
    return WholesalePaymentsResponse(**data)


@router.get(
    "/wholesale-documents/{document_id}/return-summary",
    response_model=WholesaleReturnSummaryResponse,
)
async def get_wholesale_return_summary(
    document_id: int,
    current: CurrentUser = Depends(require_any_permission("sales.read", "returns.manage")),
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
    current: CurrentUser = Depends(require_permission("returns.manage")),
    session: AsyncSession = Depends(get_db),
) -> WholesaleReturnResponse:
    result = await regos_sales_service.complete_wholesale_return(
        session,
        current.company_id,
        current.id,
        body.model_dump(),
        permissions=_permission_set(current),
    )
    return WholesaleReturnResponse(**result)
