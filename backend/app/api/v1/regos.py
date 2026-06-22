from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_any_permission, require_permission
from app.core.exceptions import forbidden
from app.core.regos_api import regos_async_api_request_for_company
from app.database import get_db
from app.schemas.catalog import (
    CatalogGroupsResponse,
    CatalogProductsResponse,
    PaymentTypesResponse,
)
from app.schemas.regos import (
    RegosTokenConfig,
    RegosTokenMessage,
    RegosTokenStatus,
    RegosTokenUpsert,
)
from app.schemas.partners import (
    Partner,
    PartnerCreateRequest,
    PartnerCreateResponse,
    PartnerGroupsResponse,
    PartnerMutationResponse,
    PartnerUpdateRequest,
    PartnersListResponse,
)
from app.schemas.settings import RegosReferenceOptionsResponse
from app.services import regos_defaults as regos_defaults_service
from app.services import regos_groups as regos_groups_service
from app.services import regos_partners as regos_partners_service
from app.services import regos_payment_types as regos_payment_types_service
from app.services import regos_products as regos_products_service
from app.services import regos_tokens as regos_tokens_service

router = APIRouter(prefix="/regos", tags=["regos"])


@router.get("/tokens/status", response_model=RegosTokenStatus)
async def regos_token_status(
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> RegosTokenStatus:
    data = await regos_tokens_service.get_token_status(session, current.company_id)
    return RegosTokenStatus(**data)


@router.get("/tokens", response_model=RegosTokenConfig)
async def get_regos_token(
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> RegosTokenConfig:
    data = await regos_tokens_service.get_token_config(session, current.company_id)
    return RegosTokenConfig(**data)


@router.put("/tokens", response_model=RegosTokenMessage)
async def upsert_regos_token(
    body: RegosTokenUpsert,
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> RegosTokenMessage:
    await regos_tokens_service.upsert_token(
        session,
        current.company_id,
        body.token,
        body.is_replicable,
    )
    return RegosTokenMessage(
        message="Regos token saved successfully",
        is_replicable=body.is_replicable,
    )


@router.delete("/tokens", response_model=RegosTokenMessage)
async def delete_regos_token(
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> RegosTokenMessage:
    deleted = await regos_tokens_service.delete_token(session, current.company_id)
    if not deleted:
        return RegosTokenMessage(message="No Regos token configured")
    return RegosTokenMessage(message="Regos token deleted successfully")


@router.get("/reference-options", response_model=RegosReferenceOptionsResponse)
async def get_regos_reference_options(
    current: CurrentUser = Depends(
        require_any_permission("settings.manage", "pos.override_regos")
    ),
    session: AsyncSession = Depends(get_db),
) -> RegosReferenceOptionsResponse:
    data = await regos_defaults_service.list_reference_options(session, current.company_id)
    return RegosReferenceOptionsResponse(**data)


@router.get("/products", response_model=CatalogProductsResponse)
async def get_regos_products(
    offset: int = Query(0, ge=0),
    limit: int = Query(60, ge=1, le=200),
    search: str | None = Query(default=None, max_length=255),
    group_id: int | None = Query(default=None, ge=1),
    featured_only: bool = Query(default=False),
    warehouse_id: int | None = Query(default=None, ge=1),
    price_type_id: int | None = Query(default=None, ge=1),
    current: CurrentUser = Depends(require_permission("pos.access")),
    session: AsyncSession = Depends(get_db),
) -> CatalogProductsResponse:
    if (warehouse_id is not None or price_type_id is not None) and (
        "pos.override_regos" not in current.permissions
    ):
        raise forbidden(
            "Missing permission: pos.override_regos",
            "FORBIDDEN",
        )

    data = await regos_products_service.list_products(
        session,
        current.company_id,
        offset=offset,
        limit=limit,
        search=search,
        group_id=group_id,
        featured_only=featured_only,
        user_id=current.id,
        warehouse_id=warehouse_id,
        price_type_id=price_type_id,
    )
    return CatalogProductsResponse(**data)


@router.get("/product-groups", response_model=CatalogGroupsResponse)
async def get_regos_product_groups(
    current: CurrentUser = Depends(require_permission("pos.access")),
    session: AsyncSession = Depends(get_db),
) -> CatalogGroupsResponse:
    data = await regos_groups_service.list_groups(session, current.company_id)
    return CatalogGroupsResponse(**data)


@router.get("/payment-types", response_model=PaymentTypesResponse)
async def get_regos_payment_types(
    current: CurrentUser = Depends(require_permission("pos.access")),
    session: AsyncSession = Depends(get_db),
) -> PaymentTypesResponse:
    data = await regos_payment_types_service.list_payment_types(session, current.company_id)
    return PaymentTypesResponse(**data)


@router.get("/partners", response_model=PartnersListResponse)
async def get_regos_partners(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(default=None, max_length=255),
    current: CurrentUser = Depends(
        require_any_permission("settings.manage", "pos.override_regos")
    ),
    session: AsyncSession = Depends(get_db),
) -> PartnersListResponse:
    data = await regos_partners_service.list_partners(
        session,
        current.company_id,
        search=search,
        offset=offset,
        limit=limit,
    )
    return PartnersListResponse(**data)


@router.get("/partners/{partner_id}", response_model=Partner)
async def get_regos_partner(
    partner_id: int,
    current: CurrentUser = Depends(
        require_any_permission("settings.manage", "pos.override_regos")
    ),
    session: AsyncSession = Depends(get_db),
) -> Partner:
    data = await regos_partners_service.get_partner_by_id(
        session,
        current.company_id,
        partner_id,
    )
    return Partner(**data)


@router.get("/partner-groups", response_model=PartnerGroupsResponse)
async def get_regos_partner_groups(
    current: CurrentUser = Depends(
        require_any_permission("settings.manage", "pos.override_regos")
    ),
    session: AsyncSession = Depends(get_db),
) -> PartnerGroupsResponse:
    data = await regos_partners_service.list_partner_groups(session, current.company_id)
    return PartnerGroupsResponse(**data)


@router.post("/partners", response_model=PartnerCreateResponse)
async def create_regos_partner(
    body: PartnerCreateRequest,
    current: CurrentUser = Depends(
        require_any_permission("settings.manage", "pos.override_regos")
    ),
    session: AsyncSession = Depends(get_db),
) -> PartnerCreateResponse:
    data = await regos_partners_service.add_partner(
        session,
        current.company_id,
        body.model_dump(exclude_unset=True),
    )
    return PartnerCreateResponse(**data)


@router.patch("/partners/{partner_id}", response_model=PartnerMutationResponse)
async def update_regos_partner(
    partner_id: int,
    body: PartnerUpdateRequest,
    current: CurrentUser = Depends(
        require_any_permission("settings.manage", "pos.override_regos")
    ),
    session: AsyncSession = Depends(get_db),
) -> PartnerMutationResponse:
    data = await regos_partners_service.edit_partner(
        session,
        current.company_id,
        partner_id,
        body.model_dump(exclude_unset=True),
    )
    return PartnerMutationResponse(**data)


@router.post("/partners/{partner_id}/delete-mark", response_model=PartnerMutationResponse)
async def delete_mark_regos_partner(
    partner_id: int,
    current: CurrentUser = Depends(
        require_any_permission("settings.manage", "pos.override_regos")
    ),
    session: AsyncSession = Depends(get_db),
) -> PartnerMutationResponse:
    data = await regos_partners_service.delete_mark_partner(
        session,
        current.company_id,
        partner_id,
    )
    return PartnerMutationResponse(**data)


@router.post("/proxy/{endpoint:path}")
async def proxy_regos_request(
    endpoint: str,
    request: Request,
    current: CurrentUser = Depends(require_permission("pos.access")),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """
    Transparent proxy: forwards JSON body to the corresponding Regos API path.
    """
    try:
        data = await request.json()
    except Exception:
        data = {}

    return await regos_async_api_request_for_company(
        session,
        current.company_id,
        endpoint,
        data,
    )
