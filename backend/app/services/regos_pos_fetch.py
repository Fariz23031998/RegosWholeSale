import logging
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.core.regos_api import regos_async_api_request_for_company
from app.core.regos_batch import BatchStep, regos_batch_request_chunks_for_company
from app.services.regos_document_fetch import _first_result_item, _result_list

logger = logging.getLogger("regos.backend")

CHEQUE_DOC_ENDPOINT = "doccheque/get"
CHEQUE_SHORT_ENDPOINT = "doccheque/getshort"
CHEQUE_OPS_ENDPOINT = "chequeitemoperation/get"
CHEQUE_PAYMENTS_ENDPOINT = "chequepaymentoperation/get"
SESSION_DOC_ENDPOINT = "doccashsession/get"
SESSION_CHEQUE_PAGE_SIZE = 1000

_UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _looks_like_uuid(value: str) -> bool:
    return bool(_UUID_PATTERN.match(value.strip()))


def _session_code_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or _looks_like_uuid(text):
        return None
    return text


def session_uuid_from_cheque(cheque: dict[str, Any]) -> str | None:
    session_uuid = cheque.get("session_uuid")
    if isinstance(session_uuid, str) and session_uuid.strip():
        return _normalize_uuid(session_uuid)

    session = cheque.get("session")
    if isinstance(session, str) and _looks_like_uuid(session):
        return _normalize_uuid(session)
    if isinstance(session, dict):
        uuid = session.get("uuid")
        if isinstance(uuid, str) and uuid.strip():
            return _normalize_uuid(uuid)
    return None


async def resolve_cheque_session_code(
    session: AsyncSession,
    company_id: int,
    cheque: dict[str, Any],
) -> str | None:
    session_code = _session_code_text(cheque.get("session_code"))
    if session_code:
        return session_code

    session_obj = cheque.get("session")
    if isinstance(session_obj, dict):
        code = _session_code_text(session_obj.get("code"))
        if code:
            return code

    session_uuid = session_uuid_from_cheque(cheque)
    if not session_uuid:
        return None

    cash_session = await fetch_session_by_uuid(session, company_id, session_uuid)
    if not cash_session:
        return None
    return _session_code_text(cash_session.get("code"))


def _normalize_uuid(value: str) -> str:
    return value.strip().lower()


def pos_cheque_cache_key(company_id: int, cheque_uuid: str) -> str:
    return f"{company_id}:{_normalize_uuid(cheque_uuid)}"


def is_pos_cheque_closed(cheque: dict[str, Any]) -> bool:
    if cheque.get("closed") is True:
        return True
    for key in ("sale_status", "status"):
        value = cheque.get(key)
        if isinstance(value, str) and value.strip().lower() == "closed":
            return True
    return False


async def fetch_cheque_by_uuid(
    session: AsyncSession,
    company_id: int,
    cheque_uuid: str,
) -> dict[str, Any] | None:
    normalized_uuid = _normalize_uuid(cheque_uuid)
    try:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            CHEQUE_DOC_ENDPOINT,
            {"uuids": [normalized_uuid]},
        )
        cheque = _first_result_item(response.get("result"))
        if not cheque:
            logger.warning(
                "No cheque found at %s for uuid %s", CHEQUE_DOC_ENDPOINT, normalized_uuid
            )
        return cheque
    except AppError as exc:
        logger.warning(
            "Failed to fetch cheque %s/%s: %s",
            CHEQUE_DOC_ENDPOINT,
            normalized_uuid,
            exc.detail,
        )
        return None
    except Exception:
        logger.warning(
            "Failed to fetch cheque %s/%s", CHEQUE_DOC_ENDPOINT, normalized_uuid, exc_info=True
        )
        return None


async def fetch_cheque_operations(
    session: AsyncSession,
    company_id: int,
    cheque_uuid: str,
) -> list[dict[str, Any]] | None:
    normalized_uuid = _normalize_uuid(cheque_uuid)
    try:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            CHEQUE_OPS_ENDPOINT,
            {"doc_sale_uuid": normalized_uuid},
        )
        operations = _result_list(response.get("result"))
        if not operations:
            logger.warning(
                "No operations found at %s for cheque %s",
                CHEQUE_OPS_ENDPOINT,
                normalized_uuid,
            )
            return None
        return operations
    except AppError as exc:
        logger.warning(
            "Failed to fetch cheque operations %s/%s: %s",
            CHEQUE_OPS_ENDPOINT,
            normalized_uuid,
            exc.detail,
        )
        return None
    except Exception:
        logger.warning(
            "Failed to fetch cheque operations %s/%s",
            CHEQUE_OPS_ENDPOINT,
            normalized_uuid,
            exc_info=True,
        )
        return None


def _cheque_operations_payload(cheque_uuid: str) -> dict[str, str]:
    return {"doc_sale_uuid": cheque_uuid}


async def fetch_cheque_payments(
    session: AsyncSession,
    company_id: int,
    cheque_uuid: str,
) -> list[dict[str, Any]]:
    normalized_uuid = _normalize_uuid(cheque_uuid)
    try:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            CHEQUE_PAYMENTS_ENDPOINT,
            _cheque_operations_payload(normalized_uuid),
        )
        return _result_list(response.get("result"))
    except AppError as exc:
        logger.warning(
            "Failed to fetch cheque payments %s/%s: %s",
            CHEQUE_PAYMENTS_ENDPOINT,
            normalized_uuid,
            exc.detail,
        )
        return []
    except Exception:
        logger.warning(
            "Failed to fetch cheque payments %s/%s",
            CHEQUE_PAYMENTS_ENDPOINT,
            normalized_uuid,
            exc_info=True,
        )
        return []


async def fetch_session_cheques(
    session: AsyncSession,
    company_id: int,
    session_uuid: str,
) -> list[dict[str, Any]]:
    normalized_uuid = _normalize_uuid(session_uuid)
    cheques: list[dict[str, Any]] = []
    offset = 0

    while True:
        try:
            response = await regos_async_api_request_for_company(
                session,
                company_id,
                CHEQUE_SHORT_ENDPOINT,
                {
                    "session_uuids": [normalized_uuid],
                    "sale_status": "Closed",
                    "limit": SESSION_CHEQUE_PAGE_SIZE,
                    "offset": offset,
                },
            )
        except AppError as exc:
            logger.warning(
                "Failed to fetch session cheques %s/%s: %s",
                CHEQUE_SHORT_ENDPOINT,
                normalized_uuid,
                exc.detail,
            )
            break
        except Exception:
            logger.warning(
                "Failed to fetch session cheques %s/%s",
                CHEQUE_SHORT_ENDPOINT,
                normalized_uuid,
                exc_info=True,
            )
            break

        page = _result_list(response.get("result"))
        cheques.extend(page)

        total = response.get("total")
        next_offset = response.get("next_offset")
        if not page:
            break
        if isinstance(total, int) and len(cheques) >= total:
            break
        if isinstance(next_offset, int) and next_offset > offset:
            offset = next_offset
            continue
        if len(page) < SESSION_CHEQUE_PAGE_SIZE:
            break
        offset += len(page)

    return cheques


async def _fetch_session_cheque_payments(
    session: AsyncSession,
    company_id: int,
    normalized_uuids: list[str],
) -> dict[str, list[dict[str, Any]]]:
    payments_by_cheque: dict[str, list[dict[str, Any]]] = {}
    for cheque_uuid in normalized_uuids:
        payments_by_cheque[cheque_uuid] = await fetch_cheque_payments(
            session,
            company_id,
            cheque_uuid,
        )
    return payments_by_cheque


async def fetch_session_cheque_details(
    session: AsyncSession,
    company_id: int,
    cheque_uuids: list[str],
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]:
    normalized_uuids = [_normalize_uuid(cheque_uuid) for cheque_uuid in cheque_uuids]
    if not normalized_uuids:
        return {}, {}

    # Batch only item operations. Payment batch steps route through POS logic and
    # require an active cash session, which is unavailable after DocSessionClosed.
    steps: list[BatchStep] = [
        {
            "key": f"ops:{cheque_uuid}",
            "path": CHEQUE_OPS_ENDPOINT,
            "payload": _cheque_operations_payload(cheque_uuid),
        }
        for cheque_uuid in normalized_uuids
    ]

    operations_by_cheque: dict[str, list[dict[str, Any]]] = {}
    failed_ops_uuids: list[str] = []

    try:
        batch_results = await regos_batch_request_chunks_for_company(
            session,
            company_id,
            steps,
            stop_on_error=False,
        )
    except AppError as exc:
        logger.warning(
            "Failed to batch fetch session cheque operations, falling back to sequential fetch: %s",
            exc.detail,
        )
        failed_ops_uuids = list(normalized_uuids)
    except Exception:
        logger.warning(
            "Failed to batch fetch session cheque operations, falling back to sequential fetch",
            exc_info=True,
        )
        failed_ops_uuids = list(normalized_uuids)
    else:
        for cheque_uuid in normalized_uuids:
            ops_response = batch_results.get(f"ops:{cheque_uuid}", {})
            if ops_response.get("ok"):
                operations_by_cheque[cheque_uuid] = _result_list(ops_response.get("result"))
            else:
                operations_by_cheque[cheque_uuid] = []
                failed_ops_uuids.append(cheque_uuid)
                logger.warning(
                    "Batch ops fetch failed for cheque %s: %s",
                    cheque_uuid,
                    ops_response.get("result"),
                )

    for cheque_uuid in failed_ops_uuids:
        operations = await fetch_cheque_operations(session, company_id, cheque_uuid)
        operations_by_cheque[cheque_uuid] = operations or []

    payments_by_cheque = await _fetch_session_cheque_payments(
        session,
        company_id,
        normalized_uuids,
    )

    return operations_by_cheque, payments_by_cheque


async def fetch_session_by_uuid(
    session: AsyncSession,
    company_id: int,
    session_uuid: str,
) -> dict[str, Any] | None:
    normalized_uuid = _normalize_uuid(session_uuid)
    try:
        response = await regos_async_api_request_for_company(
            session,
            company_id,
            SESSION_DOC_ENDPOINT,
            {"uuids": [normalized_uuid]},
        )
        cash_session = _first_result_item(response.get("result"))
        if not cash_session:
            logger.warning(
                "No session found at %s for uuid %s", SESSION_DOC_ENDPOINT, normalized_uuid
            )
        return cash_session
    except AppError as exc:
        logger.warning(
            "Failed to fetch session %s/%s: %s",
            SESSION_DOC_ENDPOINT,
            normalized_uuid,
            exc.detail,
        )
        return None
    except Exception:
        logger.warning(
            "Failed to fetch session %s/%s", SESSION_DOC_ENDPOINT, normalized_uuid, exc_info=True
        )
        return None
