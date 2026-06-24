from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_permission
from app.database import get_db
from app.schemas.dashboard import (
    DashboardOverviewResponse,
    DashboardPaymentsResponse,
    DashboardProductsResponse,
    DashboardStatsResponse,
)
from app.services import regos_dashboard as regos_dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/overview", response_model=DashboardOverviewResponse)
async def get_dashboard_overview(
    start_date: int | None = Query(default=None),
    end_date: int | None = Query(default=None),
    partner_ids: list[int] | None = Query(default=None),
    all_partners: bool = Query(default=True),
    stock_ids: list[int] | None = Query(default=None),
    all_stocks: bool = Query(default=True),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=regos_dashboard_service.DASHBOARD_PRODUCTS_PAGE_SIZE, ge=1, le=200),
    currency_id: int | None = Query(default=None),
    currency_mode: str = Query(default=regos_dashboard_service.CURRENCY_MODE_ALL),
    current: CurrentUser = Depends(require_permission("dashboard.read")),
    session: AsyncSession = Depends(get_db),
) -> DashboardOverviewResponse:
    data = await regos_dashboard_service.get_dashboard_overview(
        session,
        current.company_id,
        current.id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
        offset=offset,
        limit=limit,
        currency_id=currency_id,
        currency_mode=currency_mode,
    )
    return DashboardOverviewResponse(**data)


@router.get("/stats", response_model=DashboardStatsResponse)
async def get_dashboard_stats(
    start_date: int | None = Query(default=None),
    end_date: int | None = Query(default=None),
    partner_ids: list[int] | None = Query(default=None),
    all_partners: bool = Query(default=True),
    stock_ids: list[int] | None = Query(default=None),
    all_stocks: bool = Query(default=True),
    currency_id: int | None = Query(default=None),
    currency_mode: str = Query(default=regos_dashboard_service.CURRENCY_MODE_ALL),
    current: CurrentUser = Depends(require_permission("dashboard.read")),
    session: AsyncSession = Depends(get_db),
) -> DashboardStatsResponse:
    data = await regos_dashboard_service.get_dashboard_stats(
        session,
        current.company_id,
        current.id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
        currency_id=currency_id,
        currency_mode=currency_mode,
    )
    return DashboardStatsResponse(**data)


@router.get("/products", response_model=DashboardProductsResponse)
async def get_dashboard_products(
    start_date: int | None = Query(default=None),
    end_date: int | None = Query(default=None),
    partner_ids: list[int] | None = Query(default=None),
    all_partners: bool = Query(default=True),
    stock_ids: list[int] | None = Query(default=None),
    all_stocks: bool = Query(default=True),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=regos_dashboard_service.DASHBOARD_PRODUCTS_PAGE_SIZE, ge=1, le=200),
    currency_id: int | None = Query(default=None),
    currency_mode: str = Query(default=regos_dashboard_service.CURRENCY_MODE_ALL),
    current: CurrentUser = Depends(require_permission("dashboard.read")),
    session: AsyncSession = Depends(get_db),
) -> DashboardProductsResponse:
    data = await regos_dashboard_service.get_dashboard_products(
        session,
        current.company_id,
        current.id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
        offset=offset,
        limit=limit,
        currency_id=currency_id,
        currency_mode=currency_mode,
    )
    return DashboardProductsResponse(**data)


@router.get("/payments", response_model=DashboardPaymentsResponse)
async def get_dashboard_payments(
    start_date: int | None = Query(default=None),
    end_date: int | None = Query(default=None),
    partner_ids: list[int] | None = Query(default=None),
    all_partners: bool = Query(default=True),
    stock_ids: list[int] | None = Query(default=None),
    all_stocks: bool = Query(default=True),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=regos_dashboard_service.DASHBOARD_PAYMENTS_PAGE_SIZE, ge=1, le=200),
    currency_id: int | None = Query(default=None),
    currency_mode: str = Query(default=regos_dashboard_service.CURRENCY_MODE_ALL),
    current: CurrentUser = Depends(require_permission("dashboard.read")),
    session: AsyncSession = Depends(get_db),
) -> DashboardPaymentsResponse:
    data = await regos_dashboard_service.get_dashboard_payments(
        session,
        current.company_id,
        current.id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
        offset=offset,
        limit=limit,
        currency_id=currency_id,
        currency_mode=currency_mode,
    )
    return DashboardPaymentsResponse(**data)
