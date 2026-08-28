from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, require_permission
from app.core.exceptions import forbidden
from app.database import get_db
from app.schemas.stock import (
    StockDocument,
    StockDocumentCreateRequest,
    StockDocumentCreateResponse,
    StockDocumentUpdateRequest,
    StockDocumentsResponse,
    StockItemInfoResponse,
    StockItemSearchResponse,
    StockMutationResponse,
    StockOperationsAddRequest,
    StockOperationsDeleteRequest,
    StockOperationsEditRequest,
    StockOperationsResponse,
)
from app.services import regos_defaults as regos_defaults_service
from app.services import regos_stock_docs as stock_docs_service

router = APIRouter(prefix="/stock", tags=["stock"])


def _permission_set(current: CurrentUser) -> set[str]:
    return set(current.permissions)


async def _scoped_stock_params(
    session: AsyncSession,
    current: CurrentUser,
    *,
    stock_ids: list[int] | None,
    all_stocks: bool,
) -> tuple[list[int] | None, bool]:
    return await regos_defaults_service.resolve_stock_filter_scope(
        session,
        current.company_id,
        current.id,
        _permission_set(current),
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )


def _require_kind_read(current: CurrentUser, kind: str) -> stock_docs_service.StockKind:
    parsed = stock_docs_service.parse_kind(kind)
    code = stock_docs_service.read_permission_for(parsed)
    if code not in current.permissions:
        raise forbidden(f"Missing permission: {code}", "FORBIDDEN")
    return parsed


def _require_kind_write(current: CurrentUser, kind: str) -> stock_docs_service.StockKind:
    parsed = stock_docs_service.parse_kind(kind)
    code = stock_docs_service.write_permission_for(parsed)
    if code not in current.permissions:
        raise forbidden(f"Missing permission: {code}", "FORBIDDEN")
    return parsed


def _require_kind_action(
    current: CurrentUser,
    kind: str,
    action: stock_docs_service.StockDocAction,
) -> stock_docs_service.StockKind:
    parsed = stock_docs_service.parse_kind(kind)
    code = stock_docs_service.action_permission_for(parsed, action)
    if code not in current.permissions:
        raise forbidden(f"Missing permission: {code}", "FORBIDDEN")
    return parsed


@router.get("/item-info", response_model=StockItemSearchResponse)
async def search_item_info(
    search: str = Query(min_length=1),
    stock_id: int | None = Query(default=None, ge=1),
    price_type_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    current: CurrentUser = Depends(require_permission("stock.item_info")),
    session: AsyncSession = Depends(get_db),
) -> StockItemSearchResponse:
    data = await stock_docs_service.search_items(
        session,
        current.company_id,
        search=search,
        stock_id=stock_id,
        price_type_id=price_type_id,
        limit=limit,
    )
    return StockItemSearchResponse(**data)


@router.get("/item-info/{item_id}", response_model=StockItemInfoResponse)
async def get_item_info(
    item_id: int,
    stock_id: int | None = Query(default=None, ge=1),
    price_type_id: int | None = Query(default=None, ge=1),
    operation_limit: int = Query(default=20, ge=1, le=1000),
    current: CurrentUser = Depends(require_permission("stock.item_info")),
    session: AsyncSession = Depends(get_db),
) -> StockItemInfoResponse:
    data = await stock_docs_service.get_item_info(
        session,
        current.company_id,
        item_id=item_id,
        stock_id=stock_id,
        price_type_id=price_type_id,
        operation_limit=operation_limit,
    )
    return StockItemInfoResponse(**data)


@router.get("/{kind}/documents", response_model=StockDocumentsResponse)
async def list_stock_documents(
    kind: str,
    start_date: int | None = Query(default=None),
    end_date: int | None = Query(default=None),
    partner_ids: list[int] | None = Query(default=None),
    all_partners: bool = Query(default=True),
    stock_ids: list[int] | None = Query(default=None),
    all_stocks: bool = Query(default=True),
    performed: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    inout_type: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StockDocumentsResponse:
    parsed = _require_kind_read(current, kind)

    scoped_stock_ids, scoped_all_stocks = await _scoped_stock_params(
        session,
        current,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
    )
    data = await stock_docs_service.list_documents(
        session,
        current.company_id,
        kind=parsed,
        user_id=current.id,
        start_date=start_date,
        end_date=end_date,
        partner_ids=partner_ids,
        all_partners=all_partners,
        stock_ids=scoped_stock_ids,
        all_stocks=scoped_all_stocks,
        performed=performed,
        search=search,
        inout_type=inout_type,
        offset=offset,
        limit=limit,
    )
    return StockDocumentsResponse(**data)


@router.get("/{kind}/documents/{document_id}", response_model=StockDocument)
async def get_stock_document(
    kind: str,
    document_id: int,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StockDocument:
    parsed = _require_kind_read(current, kind)
    document = await stock_docs_service.assert_document_stock_access(
        session,
        current.company_id,
        current.id,
        _permission_set(current),
        kind=parsed,
        document_id=document_id,
    )
    return StockDocument(**document)


@router.post("/{kind}/documents", response_model=StockDocumentCreateResponse)
async def create_stock_document(
    kind: str,
    body: StockDocumentCreateRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StockDocumentCreateResponse:
    parsed = _require_kind_write(current, kind)
    data = await stock_docs_service.create_document(
        session,
        current.company_id,
        kind=parsed,
        user_id=current.id,
        payload=body.model_dump(exclude_none=True),
        permissions=_permission_set(current),
    )
    return StockDocumentCreateResponse(**data)


@router.patch("/{kind}/documents/{document_id}", response_model=StockMutationResponse)
async def update_stock_document(
    kind: str,
    document_id: int,
    body: StockDocumentUpdateRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StockMutationResponse:
    parsed = _require_kind_write(current, kind)
    existing = await stock_docs_service.assert_document_stock_access(
        session,
        current.company_id,
        current.id,
        _permission_set(current),
        kind=parsed,
        document_id=document_id,
    )
    data = await stock_docs_service.update_document(
        session,
        current.company_id,
        kind=parsed,
        document_id=document_id,
        payload=body.model_dump(exclude_none=True),
        existing=existing,
        user_id=current.id,
        permissions=_permission_set(current),
    )
    return StockMutationResponse(**data)


@router.post("/{kind}/documents/{document_id}/perform", response_model=StockMutationResponse)
async def perform_stock_document(
    kind: str,
    document_id: int,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StockMutationResponse:
    parsed = _require_kind_action(current, kind, "perform")
    await stock_docs_service.assert_document_stock_access(
        session,
        current.company_id,
        current.id,
        _permission_set(current),
        kind=parsed,
        document_id=document_id,
    )
    data = await stock_docs_service.perform_document(
        session, current.company_id, kind=parsed, document_id=document_id
    )
    return StockMutationResponse(**data)


@router.post(
    "/{kind}/documents/{document_id}/perform-cancel",
    response_model=StockMutationResponse,
)
async def perform_cancel_stock_document(
    kind: str,
    document_id: int,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StockMutationResponse:
    parsed = _require_kind_action(current, kind, "perform_cancel")
    await stock_docs_service.assert_document_stock_access(
        session,
        current.company_id,
        current.id,
        _permission_set(current),
        kind=parsed,
        document_id=document_id,
    )
    data = await stock_docs_service.perform_cancel_document(
        session, current.company_id, kind=parsed, document_id=document_id
    )
    return StockMutationResponse(**data)


@router.post("/{kind}/documents/{document_id}/lock", response_model=StockMutationResponse)
async def lock_stock_document(
    kind: str,
    document_id: int,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StockMutationResponse:
    parsed = _require_kind_action(current, kind, "lock")
    await stock_docs_service.assert_document_stock_access(
        session,
        current.company_id,
        current.id,
        _permission_set(current),
        kind=parsed,
        document_id=document_id,
    )
    data = await stock_docs_service.lock_document(
        session, current.company_id, kind=parsed, document_id=document_id
    )
    return StockMutationResponse(**data)


@router.post("/{kind}/documents/{document_id}/unlock", response_model=StockMutationResponse)
async def unlock_stock_document(
    kind: str,
    document_id: int,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StockMutationResponse:
    parsed = _require_kind_action(current, kind, "unlock")
    await stock_docs_service.assert_document_stock_access(
        session,
        current.company_id,
        current.id,
        _permission_set(current),
        kind=parsed,
        document_id=document_id,
    )
    data = await stock_docs_service.unlock_document(
        session, current.company_id, kind=parsed, document_id=document_id
    )
    return StockMutationResponse(**data)


@router.get(
    "/{kind}/documents/{document_id}/operations",
    response_model=StockOperationsResponse,
)
async def list_stock_operations(
    kind: str,
    document_id: int,
    search: str | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StockOperationsResponse:
    parsed = _require_kind_read(current, kind)
    await stock_docs_service.assert_document_stock_access(
        session,
        current.company_id,
        current.id,
        _permission_set(current),
        kind=parsed,
        document_id=document_id,
    )
    data = await stock_docs_service.list_operations(
        session,
        current.company_id,
        kind=parsed,
        document_id=document_id,
        search=search,
    )
    return StockOperationsResponse(**data)


@router.post("/{kind}/operations", response_model=StockMutationResponse)
async def add_stock_operations(
    kind: str,
    body: StockOperationsAddRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StockMutationResponse:
    parsed = _require_kind_write(current, kind)
    doc_ids = {op.document_id for op in body.operations}
    for doc_id in doc_ids:
        await stock_docs_service.assert_document_stock_access(
            session,
            current.company_id,
            current.id,
            _permission_set(current),
            kind=parsed,
            document_id=doc_id,
        )
    data = await stock_docs_service.add_operations(
        session,
        current.company_id,
        kind=parsed,
        operations=[op.model_dump(exclude_none=True) for op in body.operations],
    )
    return StockMutationResponse(**data)


@router.patch("/{kind}/operations", response_model=StockMutationResponse)
async def edit_stock_operations(
    kind: str,
    body: StockOperationsEditRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StockMutationResponse:
    parsed = _require_kind_write(current, kind)
    data = await stock_docs_service.edit_operations(
        session,
        current.company_id,
        kind=parsed,
        operations=[op.model_dump(exclude_none=True) for op in body.operations],
    )
    return StockMutationResponse(**data)


@router.delete("/{kind}/operations", response_model=StockMutationResponse)
async def delete_stock_operations(
    kind: str,
    body: StockOperationsDeleteRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> StockMutationResponse:
    parsed = _require_kind_write(current, kind)
    data = await stock_docs_service.delete_operations(
        session,
        current.company_id,
        kind=parsed,
        ids=body.ids,
    )
    return StockMutationResponse(**data)
