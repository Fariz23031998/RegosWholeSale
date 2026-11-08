import logging

from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    CurrentPartnerAccount,
    CurrentUser,
    get_partner_telegram_account,
    require_linked_partner_account,
    require_permission,
)
from app.core.exceptions import AppError, bad_request, not_found
from app.database import get_db
from app.schemas.partner_telegram import (
    PartnerOrderCreateRequest,
    PartnerTelegramAccountResponse,
    PartnerTelegramAccountUpdateRequest,
    PartnerPasswordConfirmRequest,
    PartnerPasswordLoginRequest,
    PartnerPasswordRequest,
    PartnerTelegramBotMessage,
    PartnerTelegramBotResponse,
    PartnerTelegramBotSaveRequest,
    PartnerTelegramBotSettingsRequest,
    PartnerWebAppAuthRequest,
    PartnerWebAppAuthResponse,
)
from app.services import partner_telegram as partner_telegram_service
from app.services import partner_telegram_webapp as webapp_service

logger = logging.getLogger("regos.backend")

router = APIRouter(prefix="/partner-telegram", tags=["partner-telegram"])


@router.get("/bot", response_model=PartnerTelegramBotResponse)
async def get_partner_bot(
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> PartnerTelegramBotResponse:
    data = await partner_telegram_service.get_company_bot(session, current.company_id)
    return PartnerTelegramBotResponse(**data)


@router.put("/bot", response_model=PartnerTelegramBotMessage)
async def save_partner_bot(
    body: PartnerTelegramBotSaveRequest,
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> PartnerTelegramBotMessage:
    bot = await partner_telegram_service.register_company_bot(
        session, current.company_id, body.bot_token
    )
    return PartnerTelegramBotMessage(
        message="Partner Telegram bot saved",
        bot=PartnerTelegramBotResponse(**bot),
    )


@router.patch("/bot/settings", response_model=PartnerTelegramBotResponse)
async def save_partner_bot_settings(
    body: PartnerTelegramBotSettingsRequest,
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> PartnerTelegramBotResponse:
    bot = await partner_telegram_service.update_bot_settings(
        session, current.company_id, body.model_dump()
    )
    return PartnerTelegramBotResponse(**bot)


@router.delete("/bot", response_model=PartnerTelegramBotMessage)
async def delete_partner_bot(
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> PartnerTelegramBotMessage:
    deleted = await partner_telegram_service.delete_company_bot(session, current.company_id)
    if not deleted:
        return PartnerTelegramBotMessage(message="No partner Telegram bot configured")
    return PartnerTelegramBotMessage(message="Partner Telegram bot removed")


@router.get("/accounts", response_model=list[PartnerTelegramAccountResponse])
async def list_partner_accounts(
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> list[PartnerTelegramAccountResponse]:
    accounts = await partner_telegram_service.list_accounts(session, current.company_id)
    return [PartnerTelegramAccountResponse(**account) for account in accounts]


@router.patch("/accounts/{account_id}", response_model=PartnerTelegramAccountResponse)
async def update_partner_account(
    account_id: int,
    body: PartnerTelegramAccountUpdateRequest,
    current: CurrentUser = Depends(require_permission("settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> PartnerTelegramAccountResponse:
    updated = await partner_telegram_service.update_account(
        session,
        current.company_id,
        account_id,
        body.model_dump(exclude_unset=True),
    )
    if updated is None:
        raise not_found("Partner Telegram account not found", "PARTNER_TELEGRAM_ACCOUNT_NOT_FOUND")
    return PartnerTelegramAccountResponse(**updated)


@router.post("/webhook/{webhook_secret}")
async def partner_telegram_webhook(
    webhook_secret: str,
    request: Request,
    session: AsyncSession = Depends(get_db),
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict[str, bool]:
    if x_telegram_bot_api_secret_token and x_telegram_bot_api_secret_token != webhook_secret:
        raise not_found("Telegram webhook not found", "TELEGRAM_WEBHOOK_NOT_FOUND")
    try:
        update = await request.json()
    except Exception:
        return {"ok": True}
    if not isinstance(update, dict):
        return {"ok": True}
    try:
        await partner_telegram_service.handle_webhook_update(session, webhook_secret, update)
    except AppError as exc:
        if exc.code == "TELEGRAM_WEBHOOK_NOT_FOUND":
            raise
        logger.warning("Partner Telegram webhook failed: %s", exc.detail)
    except Exception:
        logger.exception("Partner Telegram webhook failed")
    return {"ok": True}


@router.post("/webapp/auth", response_model=PartnerWebAppAuthResponse)
async def partner_webapp_auth(
    body: PartnerWebAppAuthRequest,
    session: AsyncSession = Depends(get_db),
) -> PartnerWebAppAuthResponse:
    data = await webapp_service.authenticate(
        session, public_key=body.public_key, init_data=body.init_data
    )
    return PartnerWebAppAuthResponse(**data)


@router.post("/webapp/login", response_model=PartnerWebAppAuthResponse)
async def partner_webapp_login(
    body: PartnerPasswordLoginRequest,
    session: AsyncSession = Depends(get_db),
) -> PartnerWebAppAuthResponse:
    data = await webapp_service.login_with_password(
        session, public_key=body.public_key, phone=body.phone, password=body.password
    )
    return PartnerWebAppAuthResponse(**data)


@router.post("/webapp/password/request")
async def partner_webapp_password_request(
    body: PartnerPasswordRequest,
    session: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    return await webapp_service.request_password_code(
        session, public_key=body.public_key, phone=body.phone
    )


@router.post("/webapp/password/confirm", response_model=PartnerWebAppAuthResponse)
async def partner_webapp_password_confirm(
    body: PartnerPasswordConfirmRequest,
    session: AsyncSession = Depends(get_db),
) -> PartnerWebAppAuthResponse:
    data = await webapp_service.confirm_password(
        session,
        public_key=body.public_key,
        phone=body.phone,
        code=body.code,
        password=body.password,
    )
    return PartnerWebAppAuthResponse(**data)


@router.get("/webapp/me", response_model=PartnerTelegramAccountResponse)
async def partner_webapp_me(
    current: CurrentPartnerAccount = Depends(get_partner_telegram_account),
    session: AsyncSession = Depends(get_db),
) -> PartnerTelegramAccountResponse:
    account = await webapp_service.account_profile(session, current.id)
    return PartnerTelegramAccountResponse(**account)


@router.get("/webapp/products")
async def partner_webapp_products(
    current: CurrentPartnerAccount = Depends(require_linked_partner_account),
    session: AsyncSession = Depends(get_db),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=50),
    search: str | None = None,
    group_id: int | None = Query(default=None, ge=1),
    filter_type: str | None = Query(default="in-stock"),
    warehouse_id: int | None = Query(default=None, ge=1),
    price_type_id: int | None = Query(default=None, ge=1),
) -> dict:
    return await webapp_service.list_products(
        session,
        current.id,
        offset=offset,
        limit=limit,
        search=search,
        group_id=group_id,
        filter_type=filter_type,
        warehouse_id=warehouse_id,
        price_type_id=price_type_id,
    )


@router.get("/webapp/catalog-options")
async def partner_webapp_catalog_options(
    current: CurrentPartnerAccount = Depends(require_linked_partner_account),
    session: AsyncSession = Depends(get_db),
) -> dict:
    return await webapp_service.catalog_options(session, current.id)


@router.get("/webapp/product-groups")
async def partner_webapp_product_groups(
    current: CurrentPartnerAccount = Depends(require_linked_partner_account),
    session: AsyncSession = Depends(get_db),
) -> dict:
    return await webapp_service.list_product_groups(session, current.company_id)


@router.get("/webapp/orders")
async def partner_webapp_orders(
    current: CurrentPartnerAccount = Depends(require_linked_partner_account),
    session: AsyncSession = Depends(get_db),
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    return await webapp_service.list_orders(
        session,
        current.company_id,
        int(current.regos_partner_id or 0),
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/webapp/orders/{order_id}")
async def partner_webapp_order_detail(
    order_id: int,
    current: CurrentPartnerAccount = Depends(require_linked_partner_account),
    session: AsyncSession = Depends(get_db),
) -> dict:
    return await webapp_service.get_order(
        session, current.company_id, int(current.regos_partner_id or 0), order_id
    )


@router.post("/webapp/orders")
async def partner_webapp_create_order(
    body: PartnerOrderCreateRequest,
    current: CurrentPartnerAccount = Depends(require_linked_partner_account),
    session: AsyncSession = Depends(get_db),
) -> dict:
    if not current.regos_partner_id:
        raise bad_request("Partner account is not linked", "PARTNER_TELEGRAM_NOT_LINKED")
    return await webapp_service.create_order(
        session,
        company_id=current.company_id,
        partner_id=current.regos_partner_id,
        language_code=current.language_code,
        is_takeaway=body.is_takeaway,
        address=body.address,
        phone=body.phone or current.phone,
        items=[item.model_dump() for item in body.items],
        account_id=current.id,
        warehouse_id=body.warehouse_id,
    )


@router.get("/webapp/documents/{kind}")
async def partner_webapp_documents(
    kind: str,
    current: CurrentPartnerAccount = Depends(require_linked_partner_account),
    session: AsyncSession = Depends(get_db),
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    return await webapp_service.list_documents(
        session,
        current.company_id,
        int(current.regos_partner_id or 0),
        kind,
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/webapp/documents/{kind}/{document_id}")
async def partner_webapp_document_detail(
    kind: str,
    document_id: int,
    current: CurrentPartnerAccount = Depends(require_linked_partner_account),
    session: AsyncSession = Depends(get_db),
) -> dict:
    return await webapp_service.get_document(
        session,
        current.company_id,
        int(current.regos_partner_id or 0),
        kind,
        document_id,
    )


@router.get("/webapp/payments")
async def partner_webapp_payments(
    current: CurrentPartnerAccount = Depends(require_linked_partner_account),
    session: AsyncSession = Depends(get_db),
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    return await webapp_service.list_payments(
        session,
        current.company_id,
        int(current.regos_partner_id or 0),
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/webapp/reconciliation")
async def partner_webapp_reconciliation(
    current: CurrentPartnerAccount = Depends(require_linked_partner_account),
    session: AsyncSession = Depends(get_db),
    start_date: str = Query(min_length=10, max_length=10),
    end_date: str = Query(min_length=10, max_length=10),
) -> dict:
    return await webapp_service.reconciliation(
        session,
        current.company_id,
        int(current.regos_partner_id or 0),
        start_date=start_date,
        end_date=end_date,
    )
