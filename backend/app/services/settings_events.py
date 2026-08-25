import asyncio
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any, Literal

logger = logging.getLogger("regos.backend")

SettingsScope = Literal["company", "employee"]
SettingsNamespace = Literal[
    "pos",
    "regos_defaults",
    "receipt_templates",
    "exchange_rate_sync",
    "regos_token",
    "payment_linking",
    "doc_payment_sale_id",
]

_settings_event_hub: "SettingsEventHub | None" = None


class SettingsEventHub:
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
                    "Settings event queue full for company=%s; dropping event %s",
                    company_id,
                    event.get("type"),
                )


def get_settings_event_hub() -> SettingsEventHub:
    global _settings_event_hub
    if _settings_event_hub is None:
        _settings_event_hub = SettingsEventHub()
    return _settings_event_hub


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def publish_settings_updated(
    company_id: int,
    *,
    scope: SettingsScope,
    namespace: SettingsNamespace,
    user_id: int | None = None,
    occurred_at: str | None = None,
) -> None:
    if scope == "employee" and (user_id is None or user_id <= 0):
        logger.warning(
            "Skipping employee settings event without user_id: company=%s namespace=%s",
            company_id,
            namespace,
        )
        return

    event: dict[str, Any] = {
        "type": "settings_updated",
        "scope": scope,
        "namespace": namespace,
        "occurred_at": occurred_at or _utc_now_iso(),
    }
    if scope == "employee":
        event["user_id"] = user_id
    get_settings_event_hub().publish(company_id, event)
