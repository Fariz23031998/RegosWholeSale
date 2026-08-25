from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_permission
from app.database import get_db
from app.schemas.dashboard import (
    DashboardOverviewResponse,
    DashboardOutOfStockResponse,
    DashboardPaymentsResponse,
    DashboardProductsResponse,
    DashboardStatsResponse,
)
from app.services import regos_out_of_stock as out_of_stock_service
from app.services import regos_dashboard as regos_dashboard_service
from app.services import regos_defaults as regos_defaults_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _permission_set(current: CurrentUser) -> set[str]:
    return set(current.permissions)


async def _scoped_stock_params(
    session: AsyncSession,
    current: CurrentUser,
    *,
    stock_ids: list[int] | None,
    all_stocks: bool,
) -> tuple[list[int] | None, bool]:
    return await regos_defaults_service.resolve_stock_filter_scope(
        session,
        current.company_id,
        current.id,
        _permission_set(current),
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )


@router.get("/overview", response_model=DashboardOverviewResponse)
async def get_dashboard_overview(
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
) -> DashboardOverviewResponse:
    scoped_stock_ids, scoped_all_stocks = await _scoped_stock_params(
        session,
        current,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    data = await regos_dashboard_service.get_dashboard_overview(
        session,
        current.company_id,
        current.id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=scoped_stock_ids,
        all_stocks=scoped_all_stocks,
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
    scoped_stock_ids, scoped_all_stocks = await _scoped_stock_params(
        session,
        current,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    data = await regos_dashboard_service.get_dashboard_stats(
        session,
        current.company_id,
        current.id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=scoped_stock_ids,
        all_stocks=scoped_all_stocks,
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
    currency_id: int | None = Query(default=None),
    currency_mode: str = Query(default=regos_dashboard_service.CURRENCY_MODE_ALL),
    current: CurrentUser = Depends(require_permission("dashboard.read")),
    session: AsyncSession = Depends(get_db),
) -> DashboardProductsResponse:
    scoped_stock_ids, scoped_all_stocks = await _scoped_stock_params(
        session,
        current,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    data = await regos_dashboard_service.get_dashboard_products(
        session,
        current.company_id,
        current.id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=scoped_stock_ids,
        all_stocks=scoped_all_stocks,
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
    currency_id: int | None = Query(default=None),
    currency_mode: str = Query(default=regos_dashboard_service.CURRENCY_MODE_ALL),
    current: CurrentUser = Depends(require_permission("dashboard.read")),
    session: AsyncSession = Depends(get_db),
) -> DashboardPaymentsResponse:
    scoped_stock_ids, scoped_all_stocks = await _scoped_stock_params(
        session,
        current,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    data = await regos_dashboard_service.get_dashboard_payments(
        session,
        current.company_id,
        current.id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=scoped_stock_ids,
        all_stocks=scoped_all_stocks,
        currency_id=currency_id,
        currency_mode=currency_mode,
    )
    return DashboardPaymentsResponse(**data)


@router.get("/out-of-stock", response_model=DashboardOutOfStockResponse)
async def get_dashboard_out_of_stock(
    stock_ids: list[int] | None = Query(default=None),
    all_stocks: bool = Query(default=True),
    current: CurrentUser = Depends(require_permission("dashboard.read")),
    session: AsyncSession = Depends(get_db),
) -> DashboardOutOfStockResponse:
    scoped_stock_ids, scoped_all_stocks = await _scoped_stock_params(
        session,
        current,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    if not scoped_all_stocks and not scoped_stock_ids:
        return DashboardOutOfStockResponse(products=[], total=0)
    products = await out_of_stock_service.get_out_of_stock_report(
        session,
        current.company_id,
        stock_ids=scoped_stock_ids,
        all_stocks=scoped_all_stocks,
    )
    return DashboardOutOfStockResponse(products=products, total=len(products))
