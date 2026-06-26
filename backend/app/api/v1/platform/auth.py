from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentPlatformAdmin, get_current_platform_admin
from app.database import get_db
from app.schemas.platform import (
    PlatformAdminResponse,
    PlatformAuthResponse,
    PlatformLoginRequest,
)
from app.services import platform_admin as platform_service

router = APIRouter(prefix="/auth", tags=["platform-auth"])


def _admin_response(admin) -> PlatformAdminResponse:
    return PlatformAdminResponse(
        id=admin.id,
        email=admin.email,
        display_name=admin.display_name,
        is_active=admin.is_active,
        created_at=admin.created_at,
    )


@router.post("/login", response_model=PlatformAuthResponse)
async def platform_login(
    body: PlatformLoginRequest,
    session: AsyncSession = Depends(get_db),
) -> PlatformAuthResponse:
    admin, token = await platform_service.login_platform_admin(
        session, login=body.login, password=body.password
    )
    return PlatformAuthResponse(access_token=token, admin=_admin_response(admin))


@router.get("/me", response_model=PlatformAdminResponse)
async def platform_me(
    current: CurrentPlatformAdmin = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_db),
) -> PlatformAdminResponse:
    admin = await platform_service.get_platform_admin(session, current.id)
    if not admin:
        from app.core.exceptions import not_found

        raise not_found("Admin not found")
    return _admin_response(admin)
