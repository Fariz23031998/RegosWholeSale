import json
from pathlib import Path
from typing import Any

_STATUSES_PATH = Path(__file__).resolve().parent.parent / "data" / "doc_order_from_partner_statuses.json"

DOC_ORDER_FROM_PARTNER_STATUS_NEW = 1
DOC_ORDER_FROM_PARTNER_STATUS_APPROVED = 2
DOC_ORDER_FROM_PARTNER_STATUS_PROCESSING = 3
DOC_ORDER_FROM_PARTNER_STATUS_FINISHED = 4
DOC_ORDER_FROM_PARTNER_STATUS_CANCELED = 5

DOC_ORDER_FROM_PARTNER_DEFAULT_STATUS_ID = DOC_ORDER_FROM_PARTNER_STATUS_NEW

DOC_ORDER_FROM_PARTNER_CONTINUABLE_STATUS_IDS = frozenset({
    DOC_ORDER_FROM_PARTNER_STATUS_NEW,
    DOC_ORDER_FROM_PARTNER_STATUS_APPROVED,
    DOC_ORDER_FROM_PARTNER_STATUS_PROCESSING,
})

_NAME_VAR_TO_ID: dict[str, int] = {
    "CTLG_ORDER_STATUS_NEW": DOC_ORDER_FROM_PARTNER_STATUS_NEW,
    "CTLG_ORDER_STATUS_APPROVED": DOC_ORDER_FROM_PARTNER_STATUS_APPROVED,
    "CTLG_ORDER_STATUS_PROCESSING": DOC_ORDER_FROM_PARTNER_STATUS_PROCESSING,
    "CTLG_ORDER_STATUS_FINISHED": DOC_ORDER_FROM_PARTNER_STATUS_FINISHED,
    "CTLG_ORDER_STATUS_CANCELED": DOC_ORDER_FROM_PARTNER_STATUS_CANCELED,
}


def _load_statuses() -> list[dict[str, Any]]:
    with _STATUSES_PATH.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError("doc_order_from_partner_statuses.json must contain a JSON array")
    return data


def _validate_statuses_against_json() -> None:
    for item in _load_statuses():
        if not isinstance(item, dict):
            continue
        name_var = item.get("name_var")
        status_id = item.get("id")
        if not isinstance(name_var, str) or not isinstance(status_id, int):
            continue
        expected = _NAME_VAR_TO_ID.get(name_var)
        if expected is not None and expected != status_id:
            raise ValueError(
                f"DocOrderFromPartner status constant for {name_var} "
                f"({expected}) does not match JSON id {status_id}"
            )


_validate_statuses_against_json()
