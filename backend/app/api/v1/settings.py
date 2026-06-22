from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, require_permission
from app.database import get_db
from app.schemas.featured import FeaturedProductMutationResponse, FeaturedProductsResponse
from app.schemas.pos import (
    PosSettingsPatchRequest,
    PosSettingsResponse,
    UserPosSettingsPatchRequest,
    UserPosSettingsResponse,
)
from app.schemas.settings import (
    RegosDefaultsPatchRequest,
    RegosDefaultsResponse,
    SettingsPatchRequest,
    SettingsResponse,
)
from app.services import featured_products as featured_products_service
from app.services import pos_settings as pos_settings_service
from app.services import regos_defaults as regos_defaults_service
from app.services import settings as settings_service
from app.services.permissions import get_user_with_permissions

router = APIRouter(tags=["settings"])


@router.get("/company/settings", response_model=SettingsResponse)
async def get_company_settings(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SettingsResponse:
    data = await settings_service.get_company_settings(session, current.company_id)
    return SettingsResponse(settings=data)


@router.patch("/company/settings", response_model=SettingsResponse)
async def patch_company_settings(
    body: SettingsPatchRequest,
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> SettingsResponse:
    data = await settings_service.patch_company_settings(
        session, current.company_id, body.settings
    )
    return SettingsResponse(settings=data)


@router.get("/company/settings/regos-defaults", response_model=RegosDefaultsResponse)
async def get_company_regos_defaults(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> RegosDefaultsResponse:
    defaults = await regos_defaults_service.get_enriched_regos_defaults(session, current.company_id)
    return RegosDefaultsResponse(defaults=defaults)


@router.patch("/company/settings/regos-defaults", response_model=RegosDefaultsResponse)
async def patch_company_regos_defaults(
    body: RegosDefaultsPatchRequest,
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> RegosDefaultsResponse:
    defaults = await regos_defaults_service.patch_regos_defaults(
        session,
        current.company_id,
        body.model_dump(exclude_unset=True),
    )
    return RegosDefaultsResponse(defaults=defaults)


@router.get("/me/settings", response_model=SettingsResponse)
async def get_my_settings(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SettingsResponse:
    data = await settings_service.get_user_settings(session, current.id)
    return SettingsResponse(settings=data)


@router.patch("/me/settings", response_model=SettingsResponse)
async def patch_my_settings(
    body: SettingsPatchRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SettingsResponse:
    user = await get_user_with_permissions(session, current.id)
    if not user:
        from app.core.exceptions import not_found

        raise not_found("User not found")
    data = await settings_service.patch_user_settings(session, user, body.settings)
    return SettingsResponse(settings=data)


@router.get("/me/settings/regos-defaults", response_model=RegosDefaultsResponse)
async def get_my_regos_defaults(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> RegosDefaultsResponse:
    defaults = await regos_defaults_service.get_effective_enriched_regos_defaults(
        session, current.id, current.company_id
    )
    return RegosDefaultsResponse(defaults=defaults)


@router.patch("/me/settings/regos-defaults", response_model=RegosDefaultsResponse)
async def patch_my_regos_defaults(
    body: RegosDefaultsPatchRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> RegosDefaultsResponse:
    user = await get_user_with_permissions(session, current.id)
    if not user:
        from app.core.exceptions import not_found

        raise not_found("User not found")
    defaults = await regos_defaults_service.patch_user_regos_defaults(
        session,
        user,
        body.model_dump(exclude_unset=True),
    )
    return RegosDefaultsResponse(defaults=defaults)


@router.get("/me/settings/pos", response_model=UserPosSettingsResponse)
async def get_my_pos_settings(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> UserPosSettingsResponse:
    settings = await pos_settings_service.get_effective_pos_settings(
        session, current.id, current.company_id
    )
    return UserPosSettingsResponse(settings=settings)


@router.patch("/me/settings/pos", response_model=UserPosSettingsResponse)
async def patch_my_pos_settings(
    body: UserPosSettingsPatchRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> UserPosSettingsResponse:
    user = await get_user_with_permissions(session, current.id)
    if not user:
        from app.core.exceptions import not_found

        raise not_found("User not found")
    settings = await pos_settings_service.patch_user_pos_settings(
        session,
        user,
        body.model_dump(exclude_unset=True),
    )
    return UserPosSettingsResponse(settings=settings)


@router.get("/company/settings/pos", response_model=PosSettingsResponse)
async def get_company_pos_settings(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> PosSettingsResponse:
    settings = await pos_settings_service.get_pos_settings(session, current.company_id)
    return PosSettingsResponse(settings=settings)


@router.patch("/company/settings/pos", response_model=PosSettingsResponse)
async def patch_company_pos_settings(
    body: PosSettingsPatchRequest,
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> PosSettingsResponse:
    settings = await pos_settings_service.patch_pos_settings(
        session,
        current.company_id,
        body.model_dump(exclude_unset=True),
    )
    return PosSettingsResponse(settings=settings)


@router.get("/me/featured-products", response_model=FeaturedProductsResponse)
async def get_my_featured_products(
    current: CurrentUser = Depends(require_permission("pos.access")),
    session: AsyncSession = Depends(get_db),
) -> FeaturedProductsResponse:
    product_ids = await featured_products_service.list_product_ids(session, current.id)
    return FeaturedProductsResponse(product_ids=product_ids)


@router.put("/me/featured-products/{product_id}", response_model=FeaturedProductMutationResponse)
async def add_my_featured_product(
    product_id: int,
    current: CurrentUser = Depends(require_permission("pos.access")),
    session: AsyncSession = Depends(get_db),
) -> FeaturedProductMutationResponse:
    if product_id <= 0:
        from app.core.exceptions import bad_request

        raise bad_request("Invalid product id.", "INVALID_PRODUCT_ID")
    product_ids = await featured_products_service.add_product(session, current.id, product_id)
    return FeaturedProductMutationResponse(product_ids=product_ids, featured=True)


@router.delete("/me/featured-products/{product_id}", response_model=FeaturedProductMutationResponse)
async def remove_my_featured_product(
    product_id: int,
    current: CurrentUser = Depends(require_permission("pos.access")),
    session: AsyncSession = Depends(get_db),
) -> FeaturedProductMutationResponse:
    if product_id <= 0:
        from app.core.exceptions import bad_request

        raise bad_request("Invalid product id.", "INVALID_PRODUCT_ID")
    product_ids = await featured_products_service.remove_product(session, current.id, product_id)
    return FeaturedProductMutationResponse(product_ids=product_ids, featured=False)
