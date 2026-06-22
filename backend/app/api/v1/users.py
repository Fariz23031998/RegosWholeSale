from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, require_permission
from app.database import get_db
from app.schemas.pos import UserPosSettingsPatchRequest, UserPosSettingsResponse
from app.schemas.settings import RegosDefaultsPatchRequest, RegosDefaultsResponse
from app.schemas.users import (
    PermissionsUpdateRequest,
    SchedulesUpdateRequest,
    UserCreateRequest,
    UserDetailResponse,
    UserUpdateRequest,
)
from app.services import pos_settings as pos_settings_service
from app.services import regos_defaults as regos_defaults_service
from app.services import users as users_service
from app.services.permissions import set_user_permissions
from app.services.users import get_company_user, user_to_dict

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserDetailResponse])
async def list_users(
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> list[UserDetailResponse]:
    users = await users_service.list_company_users(session, current.company_id)
    return [UserDetailResponse(**user_to_dict(u)) for u in users]


@router.post("", response_model=UserDetailResponse, status_code=201)
async def create_user(
    body: UserCreateRequest,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> UserDetailResponse:
    schedules = [s.model_dump() for s in body.schedules] if body.schedules else None
    user = await users_service.create_employee(
        session,
        company_id=current.company_id,
        login=body.login,
        password=body.password,
        display_name=body.display_name,
        role=body.role,
        permission_codes=body.permission_codes,
        schedules=schedules,
    )
    user = await get_company_user(session, current.company_id, user.id)
    return UserDetailResponse(**user_to_dict(user))


@router.get("/{user_id}", response_model=UserDetailResponse)
async def get_user(
    user_id: int,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> UserDetailResponse:
    user = await get_company_user(session, current.company_id, user_id)
    return UserDetailResponse(**user_to_dict(user))


@router.patch("/{user_id}", response_model=UserDetailResponse)
async def patch_user(
    user_id: int,
    body: UserUpdateRequest,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> UserDetailResponse:
    user = await get_company_user(session, current.company_id, user_id)
    schedules = [s.model_dump() for s in body.schedules] if body.schedules is not None else None
    user = await users_service.update_user(
        session,
        user,
        display_name=body.display_name,
        password=body.password,
        role=body.role,
        is_active=body.is_active,
        permission_codes=body.permission_codes,
        schedules=schedules,
    )
    user = await get_company_user(session, current.company_id, user.id)
    return UserDetailResponse(**user_to_dict(user))


@router.delete("/{user_id}", response_model=UserDetailResponse)
async def delete_user(
    user_id: int,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> UserDetailResponse:
    user = await get_company_user(session, current.company_id, user_id)
    user = await users_service.update_user(session, user, is_active=False)
    user = await get_company_user(session, current.company_id, user.id)
    return UserDetailResponse(**user_to_dict(user))


@router.put("/{user_id}/permissions", response_model=UserDetailResponse)
async def update_permissions(
    user_id: int,
    body: PermissionsUpdateRequest,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> UserDetailResponse:
    user = await get_company_user(session, current.company_id, user_id)
    await set_user_permissions(session, user, body.permission_codes)
    user = await get_company_user(session, current.company_id, user.id)
    return UserDetailResponse(**user_to_dict(user))


@router.get("/{user_id}/schedules", response_model=list[dict])
async def get_schedules(
    user_id: int,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> list[dict]:
    user = await get_company_user(session, current.company_id, user_id)
    return user_to_dict(user)["schedules"]


@router.put("/{user_id}/schedules", response_model=UserDetailResponse)
async def update_schedules(
    user_id: int,
    body: SchedulesUpdateRequest,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> UserDetailResponse:
    user = await get_company_user(session, current.company_id, user_id)
    await users_service.apply_schedules(session, user, [s.model_dump() for s in body.schedules])
    await session.flush()
    user = await get_company_user(session, current.company_id, user.id)
    return UserDetailResponse(**user_to_dict(user))


@router.get("/{user_id}/settings/pos", response_model=UserPosSettingsResponse)
async def get_user_pos_settings(
    user_id: int,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> UserPosSettingsResponse:
    user = await get_company_user(session, current.company_id, user_id)
    settings = await pos_settings_service.get_effective_pos_settings(
        session, user.id, current.company_id
    )
    return UserPosSettingsResponse(settings=settings)


@router.patch("/{user_id}/settings/pos", response_model=UserPosSettingsResponse)
async def patch_user_pos_settings(
    user_id: int,
    body: UserPosSettingsPatchRequest,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> UserPosSettingsResponse:
    user = await get_company_user(session, current.company_id, user_id)
    settings = await pos_settings_service.patch_user_pos_settings(
        session,
        user,
        body.model_dump(exclude_unset=True),
    )
    return UserPosSettingsResponse(settings=settings)


@router.delete("/{user_id}/settings/pos", response_model=UserPosSettingsResponse)
async def clear_user_pos_settings(
    user_id: int,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> UserPosSettingsResponse:
    user = await get_company_user(session, current.company_id, user_id)
    settings = await pos_settings_service.clear_user_pos_settings(session, user)
    return UserPosSettingsResponse(settings=settings)


@router.get("/{user_id}/settings/regos-defaults", response_model=RegosDefaultsResponse)
async def get_user_regos_defaults(
    user_id: int,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> RegosDefaultsResponse:
    user = await get_company_user(session, current.company_id, user_id)
    defaults = await regos_defaults_service.get_effective_enriched_regos_defaults(
        session, user.id, current.company_id
    )
    return RegosDefaultsResponse(defaults=defaults)


@router.patch("/{user_id}/settings/regos-defaults", response_model=RegosDefaultsResponse)
async def patch_user_regos_defaults(
    user_id: int,
    body: RegosDefaultsPatchRequest,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> RegosDefaultsResponse:
    user = await get_company_user(session, current.company_id, user_id)
    defaults = await regos_defaults_service.patch_user_regos_defaults(
        session,
        user,
        body.model_dump(exclude_unset=True),
    )
    return RegosDefaultsResponse(defaults=defaults)


@router.delete("/{user_id}/settings/regos-defaults", response_model=RegosDefaultsResponse)
async def clear_user_regos_defaults(
    user_id: int,
    current: CurrentUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_db),
) -> RegosDefaultsResponse:
    user = await get_company_user(session, current.company_id, user_id)
    defaults = await regos_defaults_service.clear_user_regos_defaults(session, user)
    return RegosDefaultsResponse(defaults=defaults)
