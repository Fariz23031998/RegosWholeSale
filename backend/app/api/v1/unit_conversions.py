from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_any_permission, require_permission
from app.database import get_db
from app.schemas.unit_conversions import (
    UnitConversion,
    UnitConversionResponse,
    UnitConversionsListResponse,
    UnitConversionUpsertRequest,
)
from app.services import unit_conversions as conversions_service

router = APIRouter(prefix="/unit-conversions", tags=["unit-conversions"])

_READ = ("settings.manage", "pos.sell", "products.create", "products.edit")


@router.get("", response_model=UnitConversionsListResponse)
async def list_unit_conversions(
    current: CurrentUser = Depends(require_any_permission(*_READ)),
    session: AsyncSession = Depends(get_db),
) -> UnitConversionsListResponse:
    data = await conversions_service.list_conversions(session, current.company_id)
    return UnitConversionsListResponse(
        conversions=[UnitConversion(**item) for item in data]
    )


@router.put("", response_model=UnitConversionResponse)
async def upsert_unit_conversion(
    body: UnitConversionUpsertRequest,
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> UnitConversionResponse:
    data = await conversions_service.upsert_conversion(
        session,
        current.company_id,
        main_unit_id=body.main_unit_id,
        secondary_unit_id=body.secondary_unit_id,
        conversion_factor=body.conversion_factor,
        price_type_id=body.price_type_id,
    )
    return UnitConversionResponse(conversion=UnitConversion(**data))


@router.delete("/{conversion_id}", response_model=UnitConversionsListResponse)
async def delete_unit_conversion(
    conversion_id: int,
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> UnitConversionsListResponse:
    await conversions_service.delete_conversion(
        session, current.company_id, conversion_id
    )
    data = await conversions_service.list_conversions(session, current.company_id)
    return UnitConversionsListResponse(
        conversions=[UnitConversion(**item) for item in data]
    )
