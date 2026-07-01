from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_permission
from app.core.exceptions import not_found
from app.database import get_db
from app.schemas.receipt_shares import ReceiptShareCreateResponse
from app.services.receipt_shares import (
    build_share_url,
    create_receipt_share,
    get_receipt_share_by_token,
    get_share_file_path,
    increment_download_count,
    is_share_expired,
)

router = APIRouter()


@router.post("/receipts/share", response_model=ReceiptShareCreateResponse)
async def upload_receipt_share(
    file: UploadFile = File(...),
    document_code: str | None = Form(default=None),
    template_name: str | None = Form(default=None),
    current: CurrentUser = Depends(require_permission("documents.print")),
    session: AsyncSession = Depends(get_db),
) -> ReceiptShareCreateResponse:
    del template_name  # reserved for audit/logging in future
    pdf_bytes = await file.read()
    filename = file.filename or "receipt.pdf"
    share = await create_receipt_share(
        session,
        company_id=current.company_id,
        created_by_user_id=current.id,
        pdf_bytes=pdf_bytes,
        filename=filename,
        document_code=document_code,
    )
    await session.commit()
    return ReceiptShareCreateResponse(
        share_id=share.token,
        url=build_share_url(share.token),
        expires_at=share.expires_at,
        filename=share.filename,
    )


@router.get("/receipts/share/{token}")
async def download_receipt_share(
    token: str,
    session: AsyncSession = Depends(get_db),
):
    share = await get_receipt_share_by_token(session, token)
    if share is None:
        raise not_found("Receipt share not found", "RECEIPT_SHARE_NOT_FOUND")

    if is_share_expired(share):
        html = (
            "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>Link expired</title></head><body>"
            "<p>This receipt link has expired.</p></body></html>"
        )
        return HTMLResponse(content=html, status_code=410)

    path = await get_share_file_path(share)
    await increment_download_count(session, share)
    await session.commit()

    return FileResponse(
        path,
        media_type="application/pdf",
        filename=share.filename,
        headers={"Cache-Control": "no-store"},
    )
