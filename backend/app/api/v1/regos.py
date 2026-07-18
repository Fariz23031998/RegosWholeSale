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
    SyncMetaResponse,
    SyncMetaSettingsChange,
    SyncProductsResponse,
)
from app.schemas.regos import (
    RegosCustomField,
    RegosDocPaymentSaleIdFieldResponse,
    RegosPaymentLinkingPatch,
    RegosPaymentLinkingResponse,
    RegosTokenConfig,
    RegosTokenMessage,
    RegosTokenStatus,
    RegosTokenUpsert,
)
from app.schemas.partners import (
    FirmsListResponse,
    Partner,
    PartnerBalanceResponse,
    PartnerCreateRequest,
    PartnerCreateResponse,
    PartnerGroupsResponse,
    PartnerMutationResponse,
    PartnerPayDebtRequest,
    PartnerPayDebtResponse,
    PartnerUpdateRequest,
    PartnersListResponse,
)
from app.schemas.settings import RegosReferenceOptionsResponse
from app.services import events_log as events_log_service
from app.services import catalog_events as catalog_events_service
from app.services import regos_defaults as regos_defaults_service
from app.services import regos_fields as regos_fields_service
from app.services import regos_groups as regos_groups_service
from app.services import regos_firms as regos_firms_service
from app.services import regos_partner_balance as regos_partner_balance_service
from app.services import regos_partner_pay_debt as regos_partner_pay_debt_service
from app.services import regos_partners as regos_partners_service
from app.services import regos_payment_linking as regos_payment_linking_service
from app.services import regos_payment_types as regos_payment_types_service
from app.services import regos_products as regos_products_service
from app.services import regos_tokens as regos_tokens_service
from app.services.settings_change import notify_settings_updated
from app.services.permissions import POS_CONTEXT_CHANGE_PERMISSIONS

router = APIRouter(prefix="/regos", tags=["regos"])

_POS_CONTEXT_OR_SETTINGS = ("settings.manage", *POS_CONTEXT_CHANGE_PERMISSIONS)
_PARTNER_OR_SETTINGS = ("settings.manage", "pos.change_partner")
_PARTNER_PAY_DEBT = ("sales.write", "settings.manage", "pos.change_partner")


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
    await notify_settings_updated(session, 
        current.company_id,
        scope="company",
        namespace="regos_token",
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
    await notify_settings_updated(session, 
        current.company_id,
        scope="company",
        namespace="regos_token",
    )
    if not deleted:
        return RegosTokenMessage(message="No Regos token configured")
    return RegosTokenMessage(message="Regos token deleted successfully")


@router.post("/tokens/update-integration", response_model=RegosTokenMessage)
async def update_regos_integration(
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> RegosTokenMessage:
    data = await regos_tokens_service.update_integration(session, current.company_id)
    await notify_settings_updated(session, 
        current.company_id,
        scope="company",
        namespace="regos_token",
    )
    return RegosTokenMessage(**data)


@router.get("/reference-options", response_model=RegosReferenceOptionsResponse)
async def get_regos_reference_options(
    current: CurrentUser = Depends(require_any_permission(*_POS_CONTEXT_OR_SETTINGS)),
    session: AsyncSession = Depends(get_db),
) -> RegosReferenceOptionsResponse:
    data = await regos_defaults_service.list_reference_options(session, current.company_id)
    return RegosReferenceOptionsResponse(**data)


@router.get(
    "/fields/doc-payment-sale-id",
    response_model=RegosDocPaymentSaleIdFieldResponse,
)
async def get_doc_payment_sale_id_field(
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> RegosDocPaymentSaleIdFieldResponse:
    data = await regos_fields_service.get_doc_payment_sale_id_field_status(
        session, current.company_id
    )
    field = data.get("field")
    return RegosDocPaymentSaleIdFieldResponse(
        configured=bool(data.get("configured")),
        field=RegosCustomField(**field) if isinstance(field, dict) else None,
        created=bool(data.get("created")),
    )


@router.post(
    "/fields/doc-payment-sale-id",
    response_model=RegosDocPaymentSaleIdFieldResponse,
)
async def create_doc_payment_sale_id_field(
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> RegosDocPaymentSaleIdFieldResponse:
    data = await regos_fields_service.ensure_doc_payment_sale_id_field(
        session, current.company_id
    )
    await notify_settings_updated(session, 
        current.company_id,
        scope="company",
        namespace="doc_payment_sale_id",
    )
    field = data.get("field")
    return RegosDocPaymentSaleIdFieldResponse(
        configured=bool(data.get("configured")),
        field=RegosCustomField(**field) if isinstance(field, dict) else None,
        created=bool(data.get("created")),
    )


@router.get("/payment-linking", response_model=RegosPaymentLinkingResponse)
async def get_payment_linking_settings(
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> RegosPaymentLinkingResponse:
    data = await regos_payment_linking_service.get_payment_linking_settings(
        session, current.company_id
    )
    sale_id_field = data.get("sale_id_field")
    return RegosPaymentLinkingResponse(
        mode=str(data["mode"]),
        sale_id_field_configured=bool(data.get("sale_id_field_configured")),
        sale_id_field=RegosCustomField(**sale_id_field)
        if isinstance(sale_id_field, dict)
        else None,
    )


@router.patch("/payment-linking", response_model=RegosPaymentLinkingResponse)
async def patch_payment_linking_settings(
    body: RegosPaymentLinkingPatch,
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> RegosPaymentLinkingResponse:
    data = await regos_payment_linking_service.set_payment_linking_mode(
        session, current.company_id, body.mode
    )
    await notify_settings_updated(session, 
        current.company_id,
        scope="company",
        namespace="payment_linking",
    )
    sale_id_field = data.get("sale_id_field")
    return RegosPaymentLinkingResponse(
        mode=str(data["mode"]),
        sale_id_field_configured=bool(data.get("sale_id_field_configured")),
        sale_id_field=RegosCustomField(**sale_id_field)
        if isinstance(sale_id_field, dict)
        else None,
    )


@router.get("/products", response_model=CatalogProductsResponse)
async def get_regos_products(
    offset: int = Query(0, ge=0),
    limit: int = Query(60, ge=1, le=500),
    search: str | None = Query(default=None, max_length=255),
    group_id: int | None = Query(default=None, ge=1),
    featured_only: bool = Query(default=False),
    warehouse_id: int | None = Query(default=None, ge=1),
    price_type_id: int | None = Query(default=None, ge=1),
    zero_quantity: bool | None = Query(default=None),
    zero_price: bool | None = Query(default=None),
    sort_column: str | None = Query(default=None, max_length=64),
    sort_direction: str | None = Query(default=None, max_length=8),
    current: CurrentUser = Depends(require_permission("pos.access")),
    session: AsyncSession = Depends(get_db),
) -> CatalogProductsResponse:
    if warehouse_id is not None and "pos.change_warehouse" not in current.permissions:
        raise forbidden("Missing permission: pos.change_warehouse", "FORBIDDEN")
    if price_type_id is not None and "pos.change_price_type" not in current.permissions:
        raise forbidden("Missing permission: pos.change_price_type", "FORBIDDEN")

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
        include_zero_quantity=zero_quantity,
        include_zero_price=zero_price,
        sort_column=sort_column,
        sort_direction=sort_direction,
    )
    return CatalogProductsResponse(**data)


@router.get("/products/by-ids", response_model=CatalogProductsResponse)
async def get_regos_products_by_ids(
    ids: str = Query(..., min_length=1, max_length=4000),
    warehouse_id: int | None = Query(default=None, ge=1),
    price_type_id: int | None = Query(default=None, ge=1),
    current: CurrentUser = Depends(require_permission("pos.access")),
    session: AsyncSession = Depends(get_db),
) -> CatalogProductsResponse:
    if warehouse_id is not None and "pos.change_warehouse" not in current.permissions:
        raise forbidden("Missing permission: pos.change_warehouse", "FORBIDDEN")
    if price_type_id is not None and "pos.change_price_type" not in current.permissions:
        raise forbidden("Missing permission: pos.change_price_type", "FORBIDDEN")

    parsed_ids: list[int] = []
    seen: set[int] = set()
    for part in ids.split(","):
        trimmed = part.strip()
        if not trimmed:
            continue
        try:
            parsed = int(trimmed)
        except ValueError:
            continue
        if parsed <= 0 or parsed in seen:
            continue
        seen.add(parsed)
        parsed_ids.append(parsed)

    products = await regos_products_service.get_products_by_ids(
        session,
        current.company_id,
        current.id,
        parsed_ids,
        warehouse_id=warehouse_id,
        price_type_id=price_type_id,
    )
    return CatalogProductsResponse(
        products=products,
        next_offset=0,
        total=len(products),
    )


@router.get("/products/sync", response_model=SyncProductsResponse)
async def sync_products(
    since: str = Query(..., min_length=1, max_length=64),
    warehouse_id: int | None = Query(default=None, ge=1),
    price_type_id: int | None = Query(default=None, ge=1),
    current: CurrentUser = Depends(require_permission("pos.access")),
    session: AsyncSession = Depends(get_db),
) -> SyncProductsResponse:
    from datetime import datetime, timezone

    if warehouse_id is not None and "pos.change_warehouse" not in current.permissions:
        raise forbidden("Missing permission: pos.change_warehouse", "FORBIDDEN")
    if price_type_id is not None and "pos.change_price_type" not in current.permissions:
        raise forbidden("Missing permission: pos.change_price_type", "FORBIDDEN")

    try:
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        if since_dt.tzinfo is None:
            since_dt = since_dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        from app.core.exceptions import bad_request
        raise bad_request("Invalid 'since' timestamp. Use ISO 8601 format.", "INVALID_TIMESTAMP")

    synced_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    has_history = await events_log_service.has_history_since(
        session, current.company_id, since_dt,
    )
    if not has_history:
        return SyncProductsResponse(
            synced_at=synced_at,
            full_sync_required=True,
        )

    changes = await events_log_service.get_changes_since(
        session, current.company_id, since_dt,
    )

    updated_products = []
    if changes.updated_item_ids:
        products = await regos_products_service.get_products_by_ids(
            session,
            current.company_id,
            current.id,
            changes.updated_item_ids,
            warehouse_id=warehouse_id,
            price_type_id=price_type_id,
        )
        updated_products = products

    return SyncProductsResponse(
        updated_products=updated_products,
        removed_product_ids=changes.removed_item_ids,
        groups_invalidated=changes.groups_invalidated,
        synced_at=synced_at,
        full_sync_required=False,
    )


@router.get("/meta/sync", response_model=SyncMetaResponse)
async def sync_meta(
    since: str = Query(..., min_length=1, max_length=64),
    current: CurrentUser = Depends(require_permission("pos.access")),
    session: AsyncSession = Depends(get_db),
) -> SyncMetaResponse:
    """Catch up warehouses, price types, partners, payment types, and settings after downtime."""
    from datetime import datetime, timezone

    try:
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        if since_dt.tzinfo is None:
            since_dt = since_dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        from app.core.exceptions import bad_request
        raise bad_request("Invalid 'since' timestamp. Use ISO 8601 format.", "INVALID_TIMESTAMP")

    synced_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    has_history = await events_log_service.has_history_since(
        session, current.company_id, since_dt,
    )
    if not has_history:
        return SyncMetaResponse(
            synced_at=synced_at,
            full_sync_required=True,
        )

    changes = await events_log_service.get_meta_changes_since(
        session, current.company_id, since_dt,
    )

    return SyncMetaResponse(
        synced_at=synced_at,
        full_sync_required=False,
        reference_kinds=changes.reference_kinds,
        payment_types_invalidated=changes.payment_types_invalidated,
        settings=[
            SyncMetaSettingsChange(
                scope=item.scope,
                namespace=item.namespace,
                user_id=item.user_id,
            )
            for item in changes.settings
        ],
    )


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
    current: CurrentUser = Depends(require_any_permission(*_PARTNER_OR_SETTINGS)),
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
    current: CurrentUser = Depends(require_any_permission(*_PARTNER_OR_SETTINGS)),
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
    current: CurrentUser = Depends(require_any_permission(*_PARTNER_OR_SETTINGS)),
    session: AsyncSession = Depends(get_db),
) -> PartnerGroupsResponse:
    data = await regos_partners_service.list_partner_groups(session, current.company_id)
    return PartnerGroupsResponse(**data)


@router.post("/partners", response_model=PartnerCreateResponse)
async def create_regos_partner(
    body: PartnerCreateRequest,
    current: CurrentUser = Depends(require_any_permission(*_PARTNER_OR_SETTINGS)),
    session: AsyncSession = Depends(get_db),
) -> PartnerCreateResponse:
    data = await regos_partners_service.add_partner(
        session,
        current.company_id,
        body.model_dump(exclude_unset=True),
    )
    catalog_events_service.publish_reference_options_invalidated(
        current.company_id,
        kinds=["partner"],
        source_action="PartnerAdded",
    )
    await events_log_service.record_reference_options_invalidated(
        session, current.company_id, ["partner"], "PartnerAdded",
    )
    return PartnerCreateResponse(**data)


@router.patch("/partners/{partner_id}", response_model=PartnerMutationResponse)
async def update_regos_partner(
    partner_id: int,
    body: PartnerUpdateRequest,
    current: CurrentUser = Depends(require_any_permission(*_PARTNER_OR_SETTINGS)),
    session: AsyncSession = Depends(get_db),
) -> PartnerMutationResponse:
    data = await regos_partners_service.edit_partner(
        session,
        current.company_id,
        partner_id,
        body.model_dump(exclude_unset=True),
    )
    catalog_events_service.publish_reference_options_invalidated(
        current.company_id,
        kinds=["partner"],
        source_action="PartnerEdited",
    )
    await events_log_service.record_reference_options_invalidated(
        session, current.company_id, ["partner"], "PartnerEdited",
    )
    return PartnerMutationResponse(**data)


@router.get("/firms", response_model=FirmsListResponse)
async def get_regos_firms(
    current: CurrentUser = Depends(require_any_permission(*_PARTNER_OR_SETTINGS)),
    session: AsyncSession = Depends(get_db),
) -> FirmsListResponse:
    data = await regos_firms_service.list_firms(session, current.company_id)
    return FirmsListResponse(**data)


@router.get("/partners/{partner_id}/balance", response_model=PartnerBalanceResponse)
async def get_regos_partner_balance(
    partner_id: int,
    start_date: int = Query(..., ge=0),
    end_date: int = Query(..., ge=0),
    firm_id: int | None = Query(default=None, ge=1),
    currency_id: int | None = Query(default=None, ge=1),
    in_base_currency: bool = Query(default=False),
    current: CurrentUser = Depends(require_any_permission(*_PARTNER_OR_SETTINGS)),
    session: AsyncSession = Depends(get_db),
) -> PartnerBalanceResponse:
    data = await regos_partner_balance_service.get_partner_balance(
        session,
        current.company_id,
        partner_id=partner_id,
        start_date=start_date,
        end_date=end_date,
        firm_id=firm_id,
        currency_id=currency_id,
        in_base_currency=in_base_currency,
    )
    return PartnerBalanceResponse(**data)


@router.post(
    "/partners/{partner_id}/pay-debt",
    response_model=PartnerPayDebtResponse,
)
async def pay_regos_partner_debt(
    partner_id: int,
    body: PartnerPayDebtRequest,
    current: CurrentUser = Depends(require_any_permission(*_PARTNER_PAY_DEBT)),
    session: AsyncSession = Depends(get_db),
) -> PartnerPayDebtResponse:
    data = await regos_partner_pay_debt_service.pay_partner_debt(
        session,
        current.company_id,
        current.id,
        partner_id=partner_id,
        firm_id=body.firm_id,
        payments=[line.model_dump() for line in body.payments],
    )
    return PartnerPayDebtResponse(**data)


@router.post("/partners/{partner_id}/delete-mark", response_model=PartnerMutationResponse)
async def delete_mark_regos_partner(
    partner_id: int,
    current: CurrentUser = Depends(require_any_permission(*_PARTNER_OR_SETTINGS)),
    session: AsyncSession = Depends(get_db),
) -> PartnerMutationResponse:
    data = await regos_partners_service.delete_mark_partner(
        session,
        current.company_id,
        partner_id,
    )
    catalog_events_service.publish_reference_options_invalidated(
        current.company_id,
        kinds=["partner"],
        source_action="PartnerDeleted",
    )
    await events_log_service.record_reference_options_invalidated(
        session, current.company_id, ["partner"], "PartnerDeleted",
    )
    return PartnerMutationResponse(**data)


@router.post("/proxy/Item/Get")
async def proxy_item_get(
    request: Request,
    current: CurrentUser = Depends(require_permission("pos.access")),
    session: AsyncSession = Depends(get_db),
) -> dict:
    try:
        data = await request.json()
    except Exception:
        data = {}
    return await regos_async_api_request_for_company(
        session,
        current.company_id,
        "Item/Get",
        data,
    )


@router.post("/proxy/itemprice/get")
async def proxy_itemprice_get(
    request: Request,
    current: CurrentUser = Depends(require_permission("pos.access")),
    session: AsyncSession = Depends(get_db),
) -> dict:
    try:
        data = await request.json()
    except Exception:
        data = {}
    return await regos_async_api_request_for_company(
        session,
        current.company_id,
        "itemprice/get",
        data,
    )


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
