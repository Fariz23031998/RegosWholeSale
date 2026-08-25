import asyncio
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any, Literal

logger = logging.getLogger("regos.backend")

_catalog_event_hub: "CatalogEventHub | None" = None


class CatalogEventHub:
    def __init__(self) -> None:
        self._subscribers: dict[int, set[asyncio.Queue[dict[str, Any]]]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, company_id: int) -> AsyncIterator[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._subscribers.setdefault(company_id, set()).add(queue)
        try:
            while True:
                event = await queue.get()
                yield event
        finally:
            async with self._lock:
                subscribers = self._subscribers.get(company_id)
                if not subscribers:
                    return
                subscribers.discard(queue)
                if not subscribers:
                    del self._subscribers[company_id]

    def publish(self, company_id: int, event: dict[str, Any]) -> None:
        subscribers = self._subscribers.get(company_id)
        if not subscribers:
            return
        for queue in list(subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning(
                    "Catalog event queue full for company=%s; dropping event %s",
                    company_id,
                    event.get("type"),
                )


def get_catalog_event_hub() -> CatalogEventHub:
    global _catalog_event_hub
    if _catalog_event_hub is None:
        _catalog_event_hub = CatalogEventHub()
    return _catalog_event_hub


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def publish_products_updated(
    company_id: int,
    *,
    regos_item_ids: list[int],
    source_action: str,
    stock_id: int | None = None,
    occurred_at: str | None = None,
) -> None:
    unique_ids = [item_id for item_id in dict.fromkeys(regos_item_ids) if item_id > 0]
    if not unique_ids:
        return
    event: dict[str, Any] = {
        "type": "products_updated",
        "regos_item_ids": unique_ids,
        "source_action": source_action,
        "occurred_at": occurred_at or _utc_now_iso(),
    }
    if stock_id is not None and stock_id > 0:
        event["stock_id"] = stock_id
    get_catalog_event_hub().publish(company_id, event)


def publish_products_removed(
    company_id: int,
    *,
    regos_item_ids: list[int],
    source_action: str,
    occurred_at: str | None = None,
) -> None:
    unique_ids = [item_id for item_id in dict.fromkeys(regos_item_ids) if item_id > 0]
    if not unique_ids:
        return
    get_catalog_event_hub().publish(
        company_id,
        {
            "type": "products_removed",
            "regos_item_ids": unique_ids,
            "source_action": source_action,
            "occurred_at": occurred_at or _utc_now_iso(),
        },
    )


def publish_groups_invalidated(
    company_id: int,
    *,
    source_action: str,
    occurred_at: str | None = None,
) -> None:
    get_catalog_event_hub().publish(
        company_id,
        {
            "type": "groups_invalidated",
            "source_action": source_action,
            "occurred_at": occurred_at or _utc_now_iso(),
        },
    )


def publish_payment_types_updated(
    company_id: int,
    *,
    payment_type_ids: list[int],
    source_action: str,
    occurred_at: str | None = None,
) -> None:
    unique_ids = [type_id for type_id in dict.fromkeys(payment_type_ids) if type_id > 0]
    if not unique_ids:
        return
    get_catalog_event_hub().publish(
        company_id,
        {
            "type": "payment_types_updated",
            "payment_type_ids": unique_ids,
            "source_action": source_action,
            "occurred_at": occurred_at or _utc_now_iso(),
        },
    )


def publish_payment_types_removed(
    company_id: int,
    *,
    payment_type_ids: list[int],
    source_action: str,
    occurred_at: str | None = None,
) -> None:
    unique_ids = [type_id for type_id in dict.fromkeys(payment_type_ids) if type_id > 0]
    if not unique_ids:
        return
    get_catalog_event_hub().publish(
        company_id,
        {
            "type": "payment_types_removed",
            "payment_type_ids": unique_ids,
            "source_action": source_action,
            "occurred_at": occurred_at or _utc_now_iso(),
        },
    )


ReferenceOptionKind = Literal["warehouse", "price_type", "partner"]


def publish_reference_options_invalidated(
    company_id: int,
    *,
    kinds: list[ReferenceOptionKind],
    source_action: str,
    occurred_at: str | None = None,
) -> None:
    unique_kinds = [
        kind
        for kind in dict.fromkeys(kinds)
        if kind in ("warehouse", "price_type", "partner")
    ]
    if not unique_kinds:
        return
    get_catalog_event_hub().publish(
        company_id,
        {
            "type": "reference_options_invalidated",
            "kinds": unique_kinds,
            "source_action": source_action,
            "occurred_at": occurred_at or _utc_now_iso(),
        },
    )
