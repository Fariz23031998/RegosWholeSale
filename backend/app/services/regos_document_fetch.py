import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.core.regos_api import regos_async_api_request_for_company

logger = logging.getLogger("regos.backend")


def _first_result_item(result: Any) -> dict[str, Any] | None:
    if not result:
        return None
    if isinstance(result, list):
        if not result:
            return None
        first = result[0]
        return first if isinstance(first, dict) else None
    if isinstance(result, dict):
        return result
    return None


def _result_list(result: Any) -> list[dict[str, Any]]:
    if not result:
        return []
    if isinstance(result, list):
        return [item for item in result if isinstance(item, dict)]
    if isinstance(result, dict):
        return [result]
    return []


async def fetch_document(
    session: AsyncSession,
    company_id: int,
    endpoint: str,
    document_id: int,
) -> dict[str, Any] | None:
    try:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            endpoint,
            {"ids": [document_id]},
        )
        document = _first_result_item(response.get("result"))
        if not document:
            logger.warning("No document found at %s for id %s", endpoint, document_id)
        return document
    except AppError as exc:
        logger.warning("Failed to fetch document %s/%s: %s", endpoint, document_id, exc.detail)
        return None
    except Exception:
        logger.warning("Failed to fetch document %s/%s", endpoint, document_id, exc_info=True)
        return None


async def fetch_operations(
    session: AsyncSession,
    company_id: int,
    endpoint: str,
    document_id: int,
) -> list[dict[str, Any]] | None:
    try:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            endpoint,
            {"document_ids": [document_id]},
        )
        operations = _result_list(response.get("result"))
        if not operations:
            logger.warning("No operations found at %s for document %s", endpoint, document_id)
            return None
        return operations
    except AppError as exc:
        logger.warning(
            "Failed to fetch operations %s/%s: %s", endpoint, document_id, exc.detail
        )
        return None
    except Exception:
        logger.warning("Failed to fetch operations %s/%s", endpoint, document_id, exc_info=True)
        return None


async def fetch_stock_name(
    session: AsyncSession,
    company_id: int,
    stock_id: int,
) -> str | None:
    try:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            "Stock/Get",
            {"id": stock_id},
        )
        stock = _first_result_item(response.get("result"))
        if stock and isinstance(stock.get("name"), str):
            return stock["name"]
        return None
    except Exception:
        logger.warning("Failed to fetch stock %s", stock_id, exc_info=True)
        return None


def stock_id_from_document(document: dict[str, Any]) -> int | None:
    stock_obj = document.get("stock")
    if isinstance(stock_obj, dict) and stock_obj.get("id") is not None:
        return int(stock_obj["id"])
    stock_id = document.get("stock_id")
    if stock_id is not None:
        return int(stock_id)
    return None


def stock_name_from_document(document: dict[str, Any]) -> str | None:
    stock_obj = document.get("stock")
    if isinstance(stock_obj, dict):
        name = stock_obj.get("name")
        if isinstance(name, str) and name.strip():
            return name
    return None


def _stock_id_from_nested(document: dict[str, Any], key: str) -> int | None:
    stock_obj = document.get(key)
    if isinstance(stock_obj, dict) and stock_obj.get("id") is not None:
        return int(stock_obj["id"])
    return None


def stock_sender_id_from_document(document: dict[str, Any]) -> int | None:
    return _stock_id_from_nested(document, "stock_sender")


def stock_receiver_id_from_document(document: dict[str, Any]) -> int | None:
    return _stock_id_from_nested(document, "stock_receiver")


def item_ids_from_operations(operations: list[dict[str, Any]]) -> list[int]:
    item_ids: list[int] = []
    seen: set[int] = set()
    for operation in operations:
        item_id = operation.get("item_id")
        if item_id is None:
            item = operation.get("item")
            if isinstance(item, dict):
                item_id = item.get("id")
        if item_id is None:
            continue
        try:
            parsed = int(item_id)
        except (TypeError, ValueError):
            continue
        if parsed <= 0 or parsed in seen:
            continue
        seen.add(parsed)
        item_ids.append(parsed)
    return item_ids


@dataclass(frozen=True)
class OperationDocumentSpec:
    doc_endpoint: str
    ops_endpoint: str
    kind: str
    is_return: bool = False
    use_cost: bool = False


PURCHASE_SPEC = OperationDocumentSpec("DocPurchase/Get", "PurchaseOperation/Get", "purchase", use_cost=True)
RETURN_TO_PARTNER_SPEC = OperationDocumentSpec(
    "DocReturnsToPartner/Get",
    "ReturnsToPartnerOperation/Get",
    "return_purchase",
    is_return=True,
    use_cost=True,
)
WHOLESALE_SPEC = OperationDocumentSpec("DocWholeSale/Get", "WholesaleOperation/Get", "wholesale")
WHOLESALE_RETURN_SPEC = OperationDocumentSpec(
    "DocWholeSaleReturn/Get",
    "WholeSaleReturnOperation/Get",
    "wholesale_return",
    is_return=True,
)
INOUT_SPEC = OperationDocumentSpec("DocInOut/Get", "InOutOperation/Get", "inout")
MOVEMENT_SPEC = OperationDocumentSpec("DocMovement/Get", "MovementOperation/Get", "movement")
PAYMENT_DOC_ENDPOINT = "DocPayment/Get"
