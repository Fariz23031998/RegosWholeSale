from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentPlatformAdmin, get_current_platform_admin
from app.core.exceptions import bad_request, not_found
from app.database import get_db
from app.schemas.platform import (
    CreatePlatformAdminRequest,
    PlatformAdminResponse,
    UpdatePlatformAdminRequest,
)
from app.services import platform_admin as platform_service

router = APIRouter(prefix="/admins", tags=["platform-admins"])


def _admin_response(admin) -> PlatformAdminResponse:
    return PlatformAdminResponse(
        id=admin.id,
        email=admin.email,
        username=admin.username,
        display_name=admin.display_name,
        is_active=admin.is_active,
        created_at=admin.created_at,
    )


@router.get("", response_model=list[PlatformAdminResponse])
async def list_admins(
    _current: CurrentPlatformAdmin = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_db),
) -> list[PlatformAdminResponse]:
    admins = await platform_service.list_platform_admins(session)
    return [_admin_response(a) for a in admins]


@router.post("", response_model=PlatformAdminResponse, status_code=201)
async def create_admin(
    body: CreatePlatformAdminRequest,
    _current: CurrentPlatformAdmin = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_db),
) -> PlatformAdminResponse:
    admin = await platform_service.create_platform_admin(
        session,
        email=body.email,
        username=body.username,
        password=body.password,
        display_name=body.display_name,
    )
    return _admin_response(admin)


@router.patch("/{admin_id}", response_model=PlatformAdminResponse)
async def update_admin(
    admin_id: int,
    body: UpdatePlatformAdminRequest,
    current: CurrentPlatformAdmin = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_db),
) -> PlatformAdminResponse:
    admin = await platform_service.get_platform_admin(session, admin_id)
    if not admin:
        raise not_found("Admin not found")
    if admin_id == current.id and body.is_active is False:
        raise bad_request("Cannot deactivate your own account", "CANNOT_DEACTIVATE_SELF")

    admin = await platform_service.update_platform_admin(
        session,
        admin,
        display_name=body.display_name,
        username=body.username,
        password=body.password,
        is_active=body.is_active,
    )
    return _admin_response(admin)
