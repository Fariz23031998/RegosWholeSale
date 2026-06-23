from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_permission
from app.database import get_db
from app.schemas.dashboard import DashboardProductsResponse, DashboardStatsResponse
from app.services import regos_dashboard as regos_dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardStatsResponse)
async def get_dashboard_stats(
    start_date: int | None = Query(default=None),
    end_date: int | None = Query(default=None),
    stock_ids: list[int] | None = Query(default=None),
    all_stocks: bool = Query(default=True),
    current: CurrentUser = Depends(require_permission("dashboard.read")),
    session: AsyncSession = Depends(get_db),
) -> DashboardStatsResponse:
    data = await regos_dashboard_service.get_dashboard_stats(
        session,
        current.company_id,
        current.id,
        start_date=start_date,
        end_date=end_date,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    return DashboardStatsResponse(**data)


@router.get("/products", response_model=DashboardProductsResponse)
async def get_dashboard_products(
    start_date: int | None = Query(default=None),
    end_date: int | None = Query(default=None),
    stock_ids: list[int] | None = Query(default=None),
    all_stocks: bool = Query(default=True),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=regos_dashboard_service.DASHBOARD_PRODUCTS_PAGE_SIZE, ge=1, le=200),
    current: CurrentUser = Depends(require_permission("dashboard.read")),
    session: AsyncSession = Depends(get_db),
) -> DashboardProductsResponse:
    data = await regos_dashboard_service.get_dashboard_products(
        session,
        current.company_id,
        current.id,
        start_date=start_date,
        end_date=end_date,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
        offset=offset,
        limit=limit,
    )
    return DashboardProductsResponse(**data)
