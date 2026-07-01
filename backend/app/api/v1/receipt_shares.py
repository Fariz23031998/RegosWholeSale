from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_permission
from app.database import get_db
from app.schemas.receipt_shares import (
    PublicTemplateShareCreateRequest,
    PublicTemplateShareCreateResponse,
    PublicTemplateShareResponse,
)
from app.services.receipt_shares import (
    build_public_template_url,
    create_public_template_share,
    get_public_template_share,
    increment_view_count,
)

router = APIRouter()


@router.post("/receipts/share", response_model=PublicTemplateShareCreateResponse)
async def create_receipt_share(
    body: PublicTemplateShareCreateRequest,
    current: CurrentUser = Depends(require_permission("documents.print")),
    session: AsyncSession = Depends(get_db),
) -> PublicTemplateShareCreateResponse:
    share = await create_public_template_share(
        session,
        company_id=current.company_id,
        created_by_user_id=current.id,
        template=body.template,
        context=body.context,
        document_code=body.document_code,
    )
    await session.commit()
    return PublicTemplateShareCreateResponse(
        public_token=share.token,
        url=build_public_template_url(share.token),
        public_expires_at=share.expires_at,
        is_public=share.is_public,
    )


@router.get("/public/templates/{public_token}", response_model=PublicTemplateShareResponse)
async def read_public_template(
    public_token: str,
    session: AsyncSession = Depends(get_db),
) -> PublicTemplateShareResponse:
    share, template, context = await get_public_template_share(session, public_token)
    await increment_view_count(session, share)
    await session.commit()
    return PublicTemplateShareResponse(
        public_token=share.token,
        public_expires_at=share.expires_at,
        is_public=share.is_public,
        template=template,
        context=context,
        document_code=share.document_code,
    )
