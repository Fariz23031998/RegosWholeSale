"""Regos stock document CRUD for purchase, movement, inventory, wholesale, inout, and return_to_partner drafts."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request, forbidden, not_found
from app.core.regos_api import regos_async_api_request_for_company
from app.core.regos_batch import regos_batch_request_for_company
from app.services import regos_defaults as regos_defaults_service
from app.services.document_telegram_format import parse_inout_type
from app.services.regos_defaults import _extract_currency_reference

StockKind = Literal["purchase", "movement", "inventory", "wholesale", "inout", "return_to_partner"]

_EMPTY_DOCUMENT_LIST: dict[str, Any] = {"documents": [], "next_offset": 0, "total": 0}

_VALID_COMPARE_TYPES = frozenset({"open_date", "close_date", "operation_date"})

KIND_READ_PERMISSION: dict[StockKind, str] = {
    "purchase": "purchase.read",
    "movement": "movement.read",
    "inventory": "inventory.read",
    "wholesale": "sales.read",
    "inout": "inout.read",
    "return_to_partner": "return_to_partner.read",
}

KIND_WRITE_PERMISSION: dict[StockKind, str] = {
    "purchase": "purchase.write",
    "movement": "movement.write",
    "inventory": "inventory.write",
    "wholesale": "sales.write",
    "inout": "inout.write",
    "return_to_partner": "return_to_partner.write",
}

StockDocAction = Literal["perform", "perform_cancel", "lock", "unlock"]

KIND_ACTION_PERMISSION: dict[StockKind, dict[StockDocAction, str]] = {
    "purchase": {
        "perform": "purchase.perform",
        "perform_cancel": "purchase.perform_cancel",
        "lock": "purchase.lock",
        "unlock": "purchase.unlock",
    },
    "movement": {
        "perform": "movement.perform",
        "perform_cancel": "movement.perform_cancel",
        "lock": "movement.lock",
        "unlock": "movement.unlock",
    },
    "inventory": {
        "perform": "inventory.perform",
        "perform_cancel": "inventory.perform_cancel",
        "lock": "inventory.lock",
        "unlock": "inventory.unlock",
    },
    "inout": {
        "perform": "inout.perform",
        "perform_cancel": "inout.perform_cancel",
        "lock": "inout.lock",
        "unlock": "inout.unlock",
    },
    "return_to_partner": {
        "perform": "return_to_partner.perform",
        "perform_cancel": "return_to_partner.perform_cancel",
        "lock": "return_to_partner.lock",
        "unlock": "return_to_partner.unlock",
    },
}


@dataclass(frozen=True)
class KindEndpoints:
    doc_get: str
    doc_get_by_ids: str
    doc_add: str | None
    doc_edit: str | None
    doc_perform: str
    doc_perform_cancel: str
    doc_lock: str
    doc_unlock: str
    ops_get: str
    ops_add: str
    ops_edit: str
    ops_delete: str
    list_performed_key: str  # "performed" or "closed"
    supports_create: bool
    stock_filter_mode: str  # "stock_ids" | "sender_receiver"


ENDPOINTS: dict[StockKind, KindEndpoints] = {
    "purchase": KindEndpoints(
        doc_get="docpurchase/get",
        doc_get_by_ids="docpurchase/get",
        doc_add="docpurchase/add",
        doc_edit="docpurchase/edit",
        doc_perform="docpurchase/perform",
        doc_perform_cancel="docpurchase/performcancel",
        doc_lock="docpurchase/lock",
        doc_unlock="docpurchase/unlock",
        ops_get="purchaseoperation/get",
        ops_add="purchaseoperation/add",
        ops_edit="purchaseoperation/edit",
        ops_delete="purchaseoperation/delete",
        list_performed_key="performed",
        supports_create=True,
        stock_filter_mode="stock_ids",
    ),
    "movement": KindEndpoints(
        doc_get="docmovement/get",
        doc_get_by_ids="docmovement/get",
        doc_add="docmovement/add",
        doc_edit="docmovement/edit",
        doc_perform="docmovement/perform",
        doc_perform_cancel="docmovement/performcancel",
        doc_lock="docmovement/lock",
        doc_unlock="docmovement/unlock",
        ops_get="movementoperation/get",
        ops_add="movementoperation/add",
        ops_edit="movementoperation/edit",
        ops_delete="movementoperation/delete",
        list_performed_key="performed",
        supports_create=True,
        stock_filter_mode="sender_receiver",
    ),
    "inventory": KindEndpoints(
        doc_get="docinventory/get",
        doc_get_by_ids="docinventory/get",
        doc_add="docinventory/add",
        doc_edit="docinventory/edit",
        doc_perform="docinventory/perform",
        doc_perform_cancel="docinventory/performcancel",
        doc_lock="docinventory/lock",
        doc_unlock="docinventory/unlock",
        ops_get="inventoryoperation/get",
        ops_add="inventoryoperation/add",
        ops_edit="inventoryoperation/edit",
        ops_delete="inventoryoperation/delete",
        list_performed_key="closed",
        supports_create=True,
        stock_filter_mode="stock_ids",
    ),
    "wholesale": KindEndpoints(
        doc_get="docwholesale/get",
        doc_get_by_ids="docwholesale/get",
        doc_add="docwholesale/add",
        doc_edit="docwholesale/edit",
        doc_perform="docwholesale/perform",
        doc_perform_cancel="docwholesale/performcancel",
        doc_lock="docwholesale/lock",
        doc_unlock="docwholesale/unlock",
        ops_get="wholesaleoperation/get",
        ops_add="wholesaleoperation/add",
        ops_edit="wholesaleoperation/edit",
        ops_delete="wholesaleoperation/delete",
        list_performed_key="performed",
        supports_create=True,
        stock_filter_mode="stock_ids",
    ),
    "inout": KindEndpoints(
        doc_get="docinout/get",
        doc_get_by_ids="docinout/get",
        doc_add="docinout/add",
        doc_edit="docinout/edit",
        doc_perform="docinout/perform",
        doc_perform_cancel="docinout/performcancel",
        doc_lock="docinout/lock",
        doc_unlock="docinout/unlock",
        ops_get="inoutoperation/get",
        ops_add="inoutoperation/add",
        ops_edit="inoutoperation/edit",
        ops_delete="inoutoperation/delete",
        list_performed_key="performed",
        supports_create=True,
        stock_filter_mode="stock_ids",
    ),
    "return_to_partner": KindEndpoints(
        doc_get="docreturnstopartner/get",
        doc_get_by_ids="docreturnstopartner/get",
        doc_add="docreturnstopartner/add",
        doc_edit="docreturnstopartner/edit",
        doc_perform="docreturnstopartner/perform",
        doc_perform_cancel="docreturnstopartner/performcancel",
        doc_lock="docreturnstopartner/lock",
        doc_unlock="docreturnstopartner/unlock",
        ops_get="returnstopartneroperation/get",
        ops_add="returnstopartneroperation/add",
        ops_edit="returnstopartneroperation/edit",
        ops_delete="returnstopartneroperation/delete",
        list_performed_key="performed",
        supports_create=True,
        stock_filter_mode="stock_ids",
    ),
}


def parse_kind(raw: str) -> StockKind:
    if raw not in ENDPOINTS:
        raise bad_request(f"Unsupported stock document kind: {raw}", "INVALID_STOCK_KIND")
    return raw  # type: ignore[return-value]


def read_permission_for(kind: StockKind) -> str:
    return KIND_READ_PERMISSION[kind]


def write_permission_for(kind: StockKind) -> str:
    return KIND_WRITE_PERMISSION[kind]


def action_permission_for(kind: StockKind, action: StockDocAction) -> str:
    mapping = KIND_ACTION_PERMISSION.get(kind)
    if mapping is None:
        return write_permission_for(kind)
    return mapping[action]


def _regos_inout_type(value: str | None) -> str | None:
    """Normalize app inout_type to Regos Income/Outcome enum."""
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized == "income":
        return "Income"
    if normalized == "outcome":
        return "Outcome"
    raise bad_request("inout_type must be income or outcome.", "INVALID_INOUT_TYPE")


async def _regos_call(
    session: AsyncSession,
    company_id: int,
    endpoint: str,
    payload: dict | list,
) -> dict[str, Any]:
    return await regos_async_api_request_for_company(session, company_id, endpoint, payload)


def _nested_id_name(obj: Any) -> tuple[int | None, str | None]:
    if not isinstance(obj, dict):
        return None, None
    raw_id = obj.get("id")
    parsed_id = int(raw_id) if isinstance(raw_id, int) else None
    name = obj.get("name") if isinstance(obj.get("name"), str) else None
    return parsed_id, name


def _attached_user_fields(item: dict[str, Any]) -> tuple[int | None, str | None]:
    user = item.get("attached_user")
    if isinstance(user, dict):
        uid, uname = _nested_id_name(user)
        if uname is None:
            parts = [
                user.get("last_name") or "",
                user.get("first_name") or "",
            ]
            full = " ".join(p for p in parts if p).strip()
            uname = full or (user.get("login") if isinstance(user.get("login"), str) else None)
        return uid, uname
    raw = item.get("attached_user_id")
    if isinstance(raw, int):
        return raw, None
    return None, None


def _map_document(kind: StockKind, item: dict[str, Any]) -> dict[str, Any]:
    partner_id, partner_name = _nested_id_name(item.get("partner"))
    stock_id, stock_name = _nested_id_name(item.get("stock"))
    sender_id, sender_name = _nested_id_name(item.get("stock_sender"))
    receiver_id, receiver_name = _nested_id_name(item.get("stock_receiver"))
    price_type_id, _ = _nested_id_name(item.get("price_type"))
    attached_user_id, attached_user_name = _attached_user_fields(item)

    date_val = item.get("date")
    if date_val is None:
        date_val = item.get("open_date") or 0

    performed = bool(item.get("performed", False))
    closed = bool(item.get("closed", False))
    if kind == "inventory":
        performed = closed

    mapped: dict[str, Any] = {
        "id": int(item.get("id") or 0),
        "code": str(item.get("code") or item.get("id") or ""),
        "date": int(date_val or 0),
        "open_date": int(item["open_date"]) if item.get("open_date") is not None else None,
        "close_date": int(item["close_date"]) if item.get("close_date") is not None else None,
        "partner_id": partner_id,
        "partner_name": partner_name,
        "stock_id": stock_id,
        "stock_name": stock_name,
        "stock_sender_id": sender_id,
        "stock_sender_name": sender_name,
        "stock_receiver_id": receiver_id,
        "stock_receiver_name": receiver_name,
        "price_type_id": price_type_id,
        "attached_user_id": attached_user_id,
        "attached_user_name": attached_user_name,
        "amount": float(item["amount"]) if item.get("amount") is not None else None,
        "performed": performed,
        "closed": closed,
        "blocked": bool(item.get("blocked", False)),
        "description": item.get("description") if isinstance(item.get("description"), str) else None,
        "compare_type": item.get("compare_type") if isinstance(item.get("compare_type"), str) else None,
        "vat_calculation_type": (
            item.get("vat_calculation_type")
            if isinstance(item.get("vat_calculation_type"), str)
            else None
        ),
    }
    if kind == "inout":
        mapped["inout_type"] = parse_inout_type(item)
    currency = _extract_currency_reference(item, "currency")
    if currency:
        mapped["currency"] = currency
    return mapped


def _map_operation(kind: StockKind, item: dict[str, Any]) -> dict[str, Any]:
    product = item.get("item") if isinstance(item.get("item"), dict) else {}
    unit = product.get("unit") if isinstance(product.get("unit"), dict) else {}

    if kind == "inventory":
        qty = item.get("actual_quantity", item.get("quantity", 0))
    else:
        qty = item.get("quantity", item.get("qty", 0))

    price = item.get("price")
    cost = item.get("cost")
    if cost is None and kind == "inout" and item.get("last_purchase_cost") is not None:
        cost = item.get("last_purchase_cost")
    amount = item.get("amount")
    if amount is None and qty is not None and price is not None:
        try:
            amount = float(qty) * float(price)
        except (TypeError, ValueError):
            amount = None
    elif amount is None and qty is not None and cost is not None and kind in {
        "purchase",
        "inout",
        "return_to_partner",
    }:
        try:
            amount = float(qty) * float(cost)
        except (TypeError, ValueError):
            amount = None

    return {
        "id": int(item.get("id") or 0),
        "document_id": int(item.get("document_id") or 0),
        "item_id": int(product.get("id") or item.get("item_id") or 0),
        "item_code": str(product.get("code") or "") or None,
        "item_name": product.get("name") if isinstance(product.get("name"), str) else None,
        "item_unit_name": unit.get("name") if isinstance(unit.get("name"), str) else None,
        "quantity": float(qty or 0),
        "cost": float(cost) if cost is not None else None,
        "price": float(price) if price is not None else None,
        "price2": float(item["price2"]) if item.get("price2") is not None else None,
        "amount": float(amount) if amount is not None else None,
        "description": item.get("description") if isinstance(item.get("description"), str) else None,
        "vat_value": float(item["vat_value"]) if item.get("vat_value") is not None else None,
    }


def _apply_stock_filter(
    payload: dict[str, Any],
    *,
    kind: StockKind,
    stock_ids: list[int] | None,
    all_stocks: bool,
    warehouse: dict[str, Any] | None,
) -> dict[str, Any] | None:
    endpoints = ENDPOINTS[kind]
    if endpoints.stock_filter_mode == "sender_receiver":
        if stock_ids:
            payload["stock_sender_ids"] = stock_ids
            payload["stock_receiver_ids"] = stock_ids
            return payload
        if all_stocks:
            return payload
        if warehouse and warehouse.get("id"):
            wid = warehouse["id"]
            payload["stock_sender_ids"] = [wid]
            payload["stock_receiver_ids"] = [wid]
            return payload
        return None

    if stock_ids:
        payload["stock_ids"] = stock_ids
        return payload
    if all_stocks:
        return payload
    if warehouse and warehouse.get("id"):
        payload["stock_ids"] = [warehouse["id"]]
        return payload
    return None


async def list_documents(
    session: AsyncSession,
    company_id: int,
    *,
    kind: StockKind,
    user_id: int,
    start_date: int | None = None,
    end_date: int | None = None,
    partner_ids: list[int] | None = None,
    all_partners: bool = True,
    stock_ids: list[int] | None = None,
    all_stocks: bool = True,
    performed: bool | None = None,
    search: str | None = None,
    inout_type: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> dict[str, Any]:
    endpoints = ENDPOINTS[kind]
    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=user_id
    )
    warehouse = defaults.get("warehouse")
    partner = defaults.get("partner")

    payload: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "deleted_mark": False,
        "sort_orders": [{"column": "Date" if kind != "inventory" else "OpenDate", "direction": "desc"}],
    }
    if performed is not None:
        payload[endpoints.list_performed_key] = performed
    if start_date is not None:
        payload["start_date"] = start_date
    if end_date is not None:
        payload["end_date"] = end_date
    if search and search.strip():
        payload["search"] = search.strip()
    if partner_ids:
        payload["partner_ids"] = partner_ids
    elif not all_partners and partner and kind in {"purchase", "wholesale", "return_to_partner"}:
        payload["partner_ids"] = [partner["id"]]
    if kind == "inout" and inout_type:
        payload["inout_type"] = _regos_inout_type(inout_type)

    filtered = _apply_stock_filter(
        payload,
        kind=kind,
        stock_ids=stock_ids,
        all_stocks=all_stocks,
        warehouse=warehouse if isinstance(warehouse, dict) else None,
    )
    if filtered is None:
        return dict(_EMPTY_DOCUMENT_LIST)

    response = await _regos_call(session, company_id, endpoints.doc_get, filtered)
    raw_items = response.get("result") or []
    documents = [_map_document(kind, item) for item in raw_items if isinstance(item, dict)]
    return {
        "documents": documents,
        "next_offset": int(response.get("next_offset") or 0),
        "total": int(response.get("total") or len(documents)),
    }


async def get_document(
    session: AsyncSession,
    company_id: int,
    *,
    kind: StockKind,
    document_id: int,
) -> dict[str, Any]:
    if document_id <= 0:
        raise bad_request("Invalid document id.", "INVALID_DOCUMENT_ID")
    endpoints = ENDPOINTS[kind]
    response = await _regos_call(
        session, company_id, endpoints.doc_get_by_ids, {"ids": [document_id]}
    )
    raw = response.get("result")
    item: dict[str, Any] | None = None
    if isinstance(raw, list) and raw:
        first = raw[0]
        if isinstance(first, dict):
            item = first
    elif isinstance(raw, dict):
        item = raw
    if not item:
        raise not_found(f"Document {document_id} was not found.", "DOCUMENT_NOT_FOUND")
    return _map_document(kind, item)


def _document_stock_ids(doc: dict[str, Any]) -> list[int]:
    ids: list[int] = []
    for key in ("stock_id", "stock_sender_id", "stock_receiver_id"):
        value = doc.get(key)
        if isinstance(value, int) and value > 0:
            ids.append(value)
    return ids


async def assert_document_stock_access(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    permissions: set[str],
    *,
    kind: StockKind,
    document_id: int,
) -> dict[str, Any]:
    document = await get_document(session, company_id, kind=kind, document_id=document_id)
    if "pos.change_warehouse" in permissions:
        return document

    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=user_id
    )
    warehouse = defaults.get("warehouse")
    allowed = warehouse.get("id") if isinstance(warehouse, dict) else None
    if not isinstance(allowed, int):
        raise forbidden("Document is not accessible for your warehouse scope.", "FORBIDDEN")

    doc_stocks = _document_stock_ids(document)
    if not doc_stocks or allowed not in doc_stocks:
        raise forbidden("Document is not accessible for your warehouse scope.", "FORBIDDEN")
    return document


async def list_operations(
    session: AsyncSession,
    company_id: int,
    *,
    kind: StockKind,
    document_id: int,
    search: str | None = None,
) -> dict[str, Any]:
    if document_id <= 0:
        raise bad_request("Invalid document id.", "INVALID_DOCUMENT_ID")
    endpoints = ENDPOINTS[kind]
    payload: dict[str, Any] = {
        "document_ids": [document_id],
        "limit": 1000,
        "offset": 0,
    }
    if search and search.strip():
        payload["search"] = search.strip()
    response = await _regos_call(session, company_id, endpoints.ops_get, payload)
    raw_items = response.get("result") or []
    operations = [_map_operation(kind, item) for item in raw_items if isinstance(item, dict)]
    return {"operations": operations}


def _row_affected(response: dict[str, Any]) -> int | None:
    result = response.get("result")
    if isinstance(result, dict) and result.get("row_affected") is not None:
        return int(result["row_affected"])
    return None


async def create_document(
    session: AsyncSession,
    company_id: int,
    *,
    kind: StockKind,
    user_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    endpoints = ENDPOINTS[kind]
    if not endpoints.supports_create or not endpoints.doc_add:
        raise bad_request("Creating this document type is not supported.", "CREATE_NOT_SUPPORTED")

    defaults = await regos_defaults_service.get_regos_defaults(
        session, company_id, user_id=user_id
    )

    body: dict[str, Any] = {}
    date_val = payload.get("date")
    now_ts = int(time.time())

    if kind == "inventory":
        # DocInventory/Add uses open_date (not date); partial so lines can be added manually.
        body["open_date"] = int(date_val) if date_val is not None else now_ts
        compare_type = payload.get("compare_type") or "open_date"
        if compare_type not in _VALID_COMPARE_TYPES:
            raise bad_request("Invalid compare_type.", "INVALID_COMPARE_TYPE")
        body["compare_type"] = compare_type
        body["full"] = False
        body["create_docinout"] = True

        stock_id = payload.get("stock_id")
        if stock_id is None and isinstance(defaults.get("warehouse"), dict):
            stock_id = defaults["warehouse"].get("id")
        if stock_id is None:
            raise bad_request("stock_id is required.", "STOCK_REQUIRED")
        body["stock_id"] = int(stock_id)

        price_type_id = payload.get("price_type_id")
        if price_type_id is None and isinstance(defaults.get("price_type"), dict):
            price_type_id = defaults["price_type"].get("id")
        if price_type_id is None:
            raise bad_request("price_type_id is required.", "PRICE_TYPE_REQUIRED")
        body["price_type_id"] = int(price_type_id)

        attached = payload.get("attached_user_id")
        if attached is None and isinstance(defaults.get("attached_user"), dict):
            attached = defaults["attached_user"].get("id")
        if attached is None:
            raise bad_request("attached_user_id is required.", "ATTACHED_USER_REQUIRED")
        body["attached_user_id"] = int(attached)

    elif kind in {"purchase", "wholesale", "return_to_partner"}:
        body["date"] = int(date_val) if date_val is not None else now_ts

        partner_id = payload.get("partner_id")
        if partner_id is None and isinstance(defaults.get("partner"), dict):
            partner_id = defaults["partner"].get("id")
        if partner_id is None:
            raise bad_request("partner_id is required.", "PARTNER_REQUIRED")
        body["partner_id"] = int(partner_id)

        stock_id = payload.get("stock_id")
        if stock_id is None and isinstance(defaults.get("warehouse"), dict):
            stock_id = defaults["warehouse"].get("id")
        if stock_id is None:
            raise bad_request("stock_id is required.", "STOCK_REQUIRED")
        body["stock_id"] = int(stock_id)

        currency_id = payload.get("currency_id")
        if currency_id is None and isinstance(defaults.get("currency"), dict):
            currency_id = defaults["currency"].get("id")
        if kind == "return_to_partner":
            if currency_id is None:
                raise bad_request("currency_id is required.", "CURRENCY_REQUIRED")
            body["currency_id"] = int(currency_id)
        elif currency_id is not None:
            body["currency_id"] = int(currency_id)

        if kind != "return_to_partner":
            price_type_id = payload.get("price_type_id")
            if price_type_id is None and isinstance(defaults.get("price_type"), dict):
                price_type_id = defaults["price_type"].get("id")
            if price_type_id is not None:
                body["price_type_id"] = int(price_type_id)

        vat = payload.get("vat_calculation_type")
        if kind == "return_to_partner":
            if not vat:
                raise bad_request(
                    "vat_calculation_type is required.",
                    "VAT_CALCULATION_TYPE_REQUIRED",
                )
            body["vat_calculation_type"] = vat
        elif vat:
            body["vat_calculation_type"] = vat

        attached = payload.get("attached_user_id")
        if attached is not None:
            body["attached_user_id"] = int(attached)

    elif kind == "movement":
        body["date"] = int(date_val) if date_val is not None else now_ts

        sender = payload.get("stock_sender_id")
        receiver = payload.get("stock_receiver_id")
        if sender is None and isinstance(defaults.get("warehouse"), dict):
            sender = defaults["warehouse"].get("id")
        if sender is None or receiver is None:
            raise bad_request(
                "stock_sender_id and stock_receiver_id are required.",
                "STOCKS_REQUIRED",
            )
        body["stock_sender_id"] = int(sender)
        body["stock_receiver_id"] = int(receiver)

        attached = payload.get("attached_user_id")
        if attached is not None:
            body["attached_user_id"] = int(attached)

    elif kind == "inout":
        body["date"] = int(date_val) if date_val is not None else now_ts

        stock_id = payload.get("stock_id")
        if stock_id is None and isinstance(defaults.get("warehouse"), dict):
            stock_id = defaults["warehouse"].get("id")
        if stock_id is None:
            raise bad_request("stock_id is required.", "STOCK_REQUIRED")
        body["stock_id"] = int(stock_id)

        regos_type = _regos_inout_type(payload.get("inout_type"))
        if regos_type is None:
            raise bad_request("inout_type is required.", "INOUT_TYPE_REQUIRED")
        body["inout_type"] = regos_type

        attached = payload.get("attached_user_id")
        if attached is None and isinstance(defaults.get("attached_user"), dict):
            attached = defaults["attached_user"].get("id")
        if attached is None:
            raise bad_request("attached_user_id is required.", "ATTACHED_USER_REQUIRED")
        body["attached_user_id"] = int(attached)

    if payload.get("description"):
        body["description"] = payload["description"]

    response = await _regos_call(session, company_id, endpoints.doc_add, body)
    result = response.get("result")
    new_id: int | None = None
    code: str | None = None
    if isinstance(result, dict):
        if result.get("new_id") is not None:
            new_id = int(result["new_id"])
        code = result.get("code") if isinstance(result.get("code"), str) else None
    elif isinstance(result, list) and result and isinstance(result[0], dict):
        if result[0].get("new_id") is not None:
            new_id = int(result[0]["new_id"])
        code = result[0].get("code") if isinstance(result[0].get("code"), str) else None
    if new_id is None:
        raise bad_request("Regos did not return a new document id.", "REGOS_DOCUMENT_CREATE_FAILED")
    return {"id": new_id, "code": code or str(new_id)}


def _build_update_body(kind: StockKind, document_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    body: dict[str, Any] = {"id": document_id}
    date_val = payload.get("date")

    if kind == "inventory":
        if date_val is not None:
            body["open_date"] = int(date_val)
        if "compare_type" in payload and payload["compare_type"] is not None:
            compare_type = payload["compare_type"]
            if compare_type not in _VALID_COMPARE_TYPES:
                raise bad_request("Invalid compare_type.", "INVALID_COMPARE_TYPE")
            body["compare_type"] = compare_type
        if payload.get("stock_id") is not None:
            body["stock_id"] = int(payload["stock_id"])
        if payload.get("price_type_id") is not None:
            body["price_type_id"] = int(payload["price_type_id"])
        if payload.get("attached_user_id") is not None:
            body["attached_user_id"] = int(payload["attached_user_id"])
    elif kind in {"purchase", "wholesale", "return_to_partner"}:
        if date_val is not None:
            body["date"] = int(date_val)
        if payload.get("partner_id") is not None:
            body["partner_id"] = int(payload["partner_id"])
        if payload.get("stock_id") is not None:
            body["stock_id"] = int(payload["stock_id"])
        if payload.get("currency_id") is not None:
            body["currency_id"] = int(payload["currency_id"])
        if kind != "return_to_partner" and payload.get("price_type_id") is not None:
            body["price_type_id"] = int(payload["price_type_id"])
        if payload.get("vat_calculation_type"):
            body["vat_calculation_type"] = payload["vat_calculation_type"]
        if payload.get("attached_user_id") is not None:
            body["attached_user_id"] = int(payload["attached_user_id"])
    elif kind == "movement":
        if date_val is not None:
            body["date"] = int(date_val)
        if payload.get("stock_sender_id") is not None:
            body["stock_sender_id"] = int(payload["stock_sender_id"])
        if payload.get("stock_receiver_id") is not None:
            body["stock_receiver_id"] = int(payload["stock_receiver_id"])
        if payload.get("attached_user_id") is not None:
            body["attached_user_id"] = int(payload["attached_user_id"])
    elif kind == "inout":
        if date_val is not None:
            body["date"] = int(date_val)
        if payload.get("stock_id") is not None:
            body["stock_id"] = int(payload["stock_id"])
        if "inout_type" in payload and payload["inout_type"] is not None:
            regos_type = _regos_inout_type(payload.get("inout_type"))
            if regos_type is None:
                raise bad_request("inout_type is required.", "INOUT_TYPE_REQUIRED")
            body["inout_type"] = regos_type
        if payload.get("attached_user_id") is not None:
            body["attached_user_id"] = int(payload["attached_user_id"])

    if "description" in payload and payload["description"] is not None:
        body["description"] = payload["description"]

    return body


async def update_document(
    session: AsyncSession,
    company_id: int,
    *,
    kind: StockKind,
    document_id: int,
    payload: dict[str, Any],
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    endpoints = ENDPOINTS[kind]
    if not endpoints.doc_edit:
        raise bad_request("Editing this document type is not supported.", "EDIT_NOT_SUPPORTED")

    doc = existing
    if doc is None:
        doc = await get_document(session, company_id, kind=kind, document_id=document_id)

    is_done = bool(doc.get("closed") if kind == "inventory" else doc.get("performed"))
    if is_done:
        raise bad_request(
            "Performed or closed documents cannot be edited.",
            "DOCUMENT_ALREADY_PERFORMED",
        )

    body = _build_update_body(kind, document_id, payload)
    editable_keys = {k for k in body if k != "id"}
    if not editable_keys:
        raise bad_request("No editable fields provided.", "NO_EDIT_FIELDS")

    locked_here = False
    try:
        if not doc.get("blocked"):
            await lock_document(session, company_id, kind=kind, document_id=document_id)
            locked_here = True
        response = await _regos_call(session, company_id, endpoints.doc_edit, body)
    finally:
        if locked_here:
            try:
                await unlock_document(session, company_id, kind=kind, document_id=document_id)
            except Exception:
                pass

    return {"ok": True, "row_affected": _row_affected(response)}


async def perform_document(
    session: AsyncSession,
    company_id: int,
    *,
    kind: StockKind,
    document_id: int,
) -> dict[str, Any]:
    endpoints = ENDPOINTS[kind]
    response = await _regos_call(
        session, company_id, endpoints.doc_perform, {"id": document_id}
    )
    return {"ok": True, "row_affected": _row_affected(response)}


async def perform_cancel_document(
    session: AsyncSession,
    company_id: int,
    *,
    kind: StockKind,
    document_id: int,
) -> dict[str, Any]:
    endpoints = ENDPOINTS[kind]
    response = await _regos_call(
        session, company_id, endpoints.doc_perform_cancel, {"id": document_id}
    )
    return {"ok": True, "row_affected": _row_affected(response)}


async def lock_document(
    session: AsyncSession,
    company_id: int,
    *,
    kind: StockKind,
    document_id: int,
) -> dict[str, Any]:
    endpoints = ENDPOINTS[kind]
    response = await _regos_call(
        session, company_id, endpoints.doc_lock, {"ids": [document_id]}
    )
    return {"ok": True, "row_affected": _row_affected(response)}


async def unlock_document(
    session: AsyncSession,
    company_id: int,
    *,
    kind: StockKind,
    document_id: int,
) -> dict[str, Any]:
    endpoints = ENDPOINTS[kind]
    response = await _regos_call(
        session, company_id, endpoints.doc_unlock, {"ids": [document_id]}
    )
    return {"ok": True, "row_affected": _row_affected(response)}


def _build_add_operations(kind: StockKind, operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    built: list[dict[str, Any]] = []
    for op in operations:
        document_id = int(op["document_id"])
        item_id = int(op["item_id"])
        if kind == "inventory":
            qty = op.get("actual_quantity")
            if qty is None:
                qty = op.get("quantity")
            if qty is None:
                raise bad_request("actual_quantity is required for inventory.", "QTY_REQUIRED")
            entry: dict[str, Any] = {
                "document_id": document_id,
                "item_id": item_id,
                "actual_quantity": float(qty),
                "datetime": int(op.get("datetime") or time.time()),
                "update_actual_quantity": bool(op.get("update_actual_quantity", False)),
            }
            if op.get("price") is not None:
                entry["price"] = float(op["price"])
            built.append(entry)
            continue

        qty = op.get("quantity")
        if qty is None:
            raise bad_request("quantity is required.", "QTY_REQUIRED")
        entry = {
            "document_id": document_id,
            "item_id": item_id,
            "quantity": float(qty),
        }
        if kind == "purchase" or kind == "return_to_partner":
            if op.get("cost") is not None:
                entry["cost"] = float(op["cost"])
            else:
                entry["cost"] = 0
            entry["vat_value"] = float(op.get("vat_value") or 0)
            if kind == "purchase" and op.get("price") is not None:
                entry["price"] = float(op["price"])
        elif kind == "wholesale":
            entry["vat_value"] = float(op.get("vat_value") or 0)
            if op.get("price") is not None:
                entry["price"] = float(op["price"])
            if op.get("price2") is not None:
                entry["price2"] = float(op["price2"])
        if op.get("description"):
            entry["description"] = op["description"]
        built.append(entry)
    return built


def _build_edit_operations(kind: StockKind, operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    built: list[dict[str, Any]] = []
    for op in operations:
        entry: dict[str, Any] = {"id": int(op["id"])}
        if kind == "inventory":
            qty = op.get("actual_quantity")
            if qty is None:
                qty = op.get("quantity")
            if qty is not None:
                entry["actual_quantity"] = float(qty)
            entry["update_actual_quantity"] = bool(op.get("update_actual_quantity", True))
            if op.get("price") is not None:
                entry["price"] = float(op["price"])
        else:
            if op.get("quantity") is not None:
                entry["quantity"] = float(op["quantity"])
            if kind in {"purchase", "return_to_partner"} and op.get("cost") is not None:
                entry["cost"] = float(op["cost"])
            if kind != "return_to_partner" and op.get("price") is not None:
                entry["price"] = float(op["price"])
            if op.get("description") is not None:
                entry["description"] = op["description"]
        built.append(entry)
    return built


async def add_operations(
    session: AsyncSession,
    company_id: int,
    *,
    kind: StockKind,
    operations: list[dict[str, Any]],
) -> dict[str, Any]:
    endpoints = ENDPOINTS[kind]
    payload = _build_add_operations(kind, operations)
    response = await _regos_call(session, company_id, endpoints.ops_add, payload)
    return {"ok": True, "row_affected": _row_affected(response)}


async def edit_operations(
    session: AsyncSession,
    company_id: int,
    *,
    kind: StockKind,
    operations: list[dict[str, Any]],
) -> dict[str, Any]:
    endpoints = ENDPOINTS[kind]
    payload = _build_edit_operations(kind, operations)
    response = await _regos_call(session, company_id, endpoints.ops_edit, payload)
    return {"ok": True, "row_affected": _row_affected(response)}


async def delete_operations(
    session: AsyncSession,
    company_id: int,
    *,
    kind: StockKind,
    ids: list[int],
) -> dict[str, Any]:
    endpoints = ENDPOINTS[kind]
    payload = [{"id": int(i)} for i in ids if i > 0]
    if not payload:
        raise bad_request("No operation ids provided.", "EMPTY_IDS")
    response = await _regos_call(session, company_id, endpoints.ops_delete, payload)
    return {"ok": True, "row_affected": _row_affected(response)}


def _map_item_ext(ext: dict[str, Any]) -> dict[str, Any]:
    core = ext.get("item") if isinstance(ext.get("item"), dict) else ext
    unit = core.get("unit") if isinstance(core.get("unit"), dict) else {}
    vat = core.get("vat") if isinstance(core.get("vat"), dict) else {}
    qty_obj = ext.get("quantity") if isinstance(ext.get("quantity"), dict) else {}

    barcode_list = core.get("barcode_list") or ""
    first_barcode = core.get("base_barcode")
    if not first_barcode and isinstance(barcode_list, str):
        parts = [p.strip() for p in barcode_list.split(",") if p.strip()]
        first_barcode = parts[0] if parts else None

    unit_type = unit.get("type")
    vat_value = vat.get("value")
    if vat_value is None:
        vat_value = vat.get("rate")

    return {
        "id": int(core.get("id") or 0),
        "name": str(core.get("name") or "—"),
        "barcode": str(first_barcode) if first_barcode else None,
        "code": str(core["code"]) if core.get("code") is not None else None,
        "articul": core.get("articul") if isinstance(core.get("articul"), str) else None,
        "unit": unit.get("name") if isinstance(unit.get("name"), str) else None,
        "unit_piece": unit_type == "pcs" or unit_type == 1,
        "vat_value": float(vat_value) if vat_value is not None else None,
        "last_purchase_cost": (
            float(ext["last_purchase_cost"]) if ext.get("last_purchase_cost") is not None else None
        ),
        "price": float(ext["price"]) if ext.get("price") is not None else None,
        "price2": float(ext["price2"]) if ext.get("price2") is not None else None,
        "quantity_common": (
            float(qty_obj["common"]) if qty_obj.get("common") is not None else None
        ),
    }


async def search_items(
    session: AsyncSession,
    company_id: int,
    *,
    search: str,
    stock_id: int | None = None,
    price_type_id: int | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    if not search.strip():
        return {"items": []}
    payload: dict[str, Any] = {
        "search": search.strip(),
        "deleted_mark": False,
        "limit": limit,
    }
    if stock_id is not None:
        payload["stock_id"] = stock_id
    if price_type_id is not None:
        payload["price_type_id"] = price_type_id
    response = await _regos_call(session, company_id, "item/getext", payload)
    raw = response.get("result") or []
    items = [_map_item_ext(item) for item in raw if isinstance(item, dict) and item]
    return {"items": [i for i in items if i.get("id")]}


async def get_item_info(
    session: AsyncSession,
    company_id: int,
    *,
    item_id: int,
    stock_id: int | None = None,
    price_type_id: int | None = None,
    operation_limit: int = 20,
) -> dict[str, Any]:
    if item_id <= 0:
        raise bad_request("Invalid item id.", "INVALID_ITEM_ID")

    ext_payload: dict[str, Any] = {
        "ids": [item_id],
        "deleted_mark": False,
        "limit": 1,
    }
    if stock_id is not None:
        ext_payload["stock_id"] = stock_id
    if price_type_id is not None:
        ext_payload["price_type_id"] = price_type_id

    steps = [
        {"key": "item", "path": "Item/GetExt", "payload": ext_payload},
        {
            "key": "qty",
            "path": "Item/GetQuantity",
            "payload": {"item_ids": [item_id]},
        },
        {
            "key": "prices",
            "path": "ItemPrice/Get",
            "payload": {"item_ids": [item_id]},
        },
        {
            "key": "ops",
            "path": "ItemOperation/Get",
            "payload": {
                "item_ids": [item_id],
                "limit": max(1, min(operation_limit, 1000)),
                "sort_orders": [{"column": "Date", "direction": "desc"}],
            },
        },
    ]
    responses = await regos_batch_request_for_company(session, company_id, steps)

    item_raw = responses.get("item", {}).get("result") or []
    first_ext: dict[str, Any] | None = None
    if isinstance(item_raw, list) and item_raw and isinstance(item_raw[0], dict):
        first_ext = item_raw[0]
    elif isinstance(item_raw, dict):
        first_ext = item_raw
    if not first_ext:
        raise not_found(f"Item {item_id} was not found.", "ITEM_NOT_FOUND")

    mapped_item = _map_item_ext(first_ext)

    quantities: list[dict[str, Any]] = []
    qty_raw = responses.get("qty", {}).get("result") or []
    if isinstance(qty_raw, list):
        for row in qty_raw:
            if not isinstance(row, dict):
                continue
            stock = row.get("stock") if isinstance(row.get("stock"), dict) else {}
            sid = stock.get("id") if isinstance(stock.get("id"), int) else row.get("stock_id")
            if not isinstance(sid, int):
                continue
            q = row.get("quantity", row.get("common", 0))
            quantities.append(
                {
                    "stock_id": sid,
                    "stock_name": stock.get("name") if isinstance(stock.get("name"), str) else None,
                    "quantity": float(q or 0),
                }
            )

    prices: list[dict[str, Any]] = []
    price_raw = responses.get("prices", {}).get("result") or []
    if isinstance(price_raw, list):
        for row in price_raw:
            if not isinstance(row, dict):
                continue
            pt = row.get("price_type") if isinstance(row.get("price_type"), dict) else {}
            ptid = pt.get("id") if isinstance(pt.get("id"), int) else row.get("price_type_id")
            if not isinstance(ptid, int):
                continue
            currency = pt.get("currency") if isinstance(pt.get("currency"), dict) else {}
            prices.append(
                {
                    "price_type_id": ptid,
                    "price_type_name": pt.get("name") if isinstance(pt.get("name"), str) else None,
                    "price": float(row.get("price") or 0),
                    "currency_code": (
                        currency.get("code_chr")
                        if isinstance(currency.get("code_chr"), str)
                        else currency.get("code")
                        if isinstance(currency.get("code"), str)
                        else None
                    ),
                }
            )

    operations: list[dict[str, Any]] = []
    ops_raw = responses.get("ops", {}).get("result") or []
    if isinstance(ops_raw, list):
        for row in ops_raw:
            if not isinstance(row, dict):
                continue
            stock = row.get("stock") if isinstance(row.get("stock"), dict) else {}
            operations.append(
                {
                    "id": int(row["id"]) if row.get("id") is not None else None,
                    "datetime": int(row["datetime"]) if row.get("datetime") is not None else (
                        int(row["date"]) if row.get("date") is not None else None
                    ),
                    "document_code": (
                        str(row.get("document_code") or row.get("code") or "")
                        or None
                    ),
                    "document_type": (
                        row.get("document_type")
                        if isinstance(row.get("document_type"), str)
                        else None
                    ),
                    "stock_id": stock.get("id") if isinstance(stock.get("id"), int) else None,
                    "stock_name": stock.get("name") if isinstance(stock.get("name"), str) else None,
                    "quantity": float(row["quantity"]) if row.get("quantity") is not None else None,
                    "price": float(row["price"]) if row.get("price") is not None else None,
                }
            )

    similar: list[dict[str, Any]] = []
    articul = mapped_item.get("articul")
    name = mapped_item.get("name")
    similar_query = articul or name
    if similar_query:
        try:
            similar_resp = await search_items(
                session,
                company_id,
                search=str(similar_query),
                stock_id=stock_id,
                price_type_id=price_type_id,
                limit=10,
            )
            similar = [
                s for s in similar_resp.get("items", []) if s.get("id") != item_id
            ][:8]
        except Exception:
            similar = []

    return {
        "item": mapped_item,
        "quantities": quantities,
        "prices": prices,
        "operations": operations,
        "similar": similar,
        "raw": None,
    }
