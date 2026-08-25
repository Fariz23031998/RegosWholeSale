import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.events_log import EventsLog

logger = logging.getLogger("regos.backend")

DEFAULT_RETENTION_DAYS = 30

# Product catalog
CHANGE_PRODUCT_UPDATED = "product_updated"
CHANGE_PRODUCT_REMOVED = "product_removed"
CHANGE_GROUPS_INVALIDATED = "groups_invalidated"

# Reference options (warehouses, price types, partners)
CHANGE_REF_WAREHOUSE = "ref_warehouse"
CHANGE_REF_PRICE_TYPE = "ref_price_type"
CHANGE_REF_PARTNER = "ref_partner"

# Payment types
CHANGE_PAYMENT_TYPE_UPD = "payment_type_upd"
CHANGE_PAYMENT_TYPE_RM = "payment_type_rm"

# App settings / receipt templates / defaults
CHANGE_SETTINGS_UPDATED = "settings_updated"

REFERENCE_KIND_TO_CHANGE = {
    "warehouse": CHANGE_REF_WAREHOUSE,
    "price_type": CHANGE_REF_PRICE_TYPE,
    "partner": CHANGE_REF_PARTNER,
}

CHANGE_TO_REFERENCE_KIND = {v: k for k, v in REFERENCE_KIND_TO_CHANGE.items()}


@dataclass(frozen=True)
class ChangesSinceResult:
    updated_item_ids: list[int]
    removed_item_ids: list[int]
    groups_invalidated: bool


@dataclass(frozen=True)
class SettingsChange:
    scope: str  # "company" | "employee"
    namespace: str
    user_id: int | None = None


@dataclass(frozen=True)
class MetaChangesSinceResult:
    reference_kinds: list[str] = field(default_factory=list)
    payment_types_invalidated: bool = False
    settings: list[SettingsChange] = field(default_factory=list)


def encode_settings_source_action(
    scope: str,
    namespace: str,
    user_id: int | None = None,
) -> str:
    if scope == "employee" and user_id is not None:
        return f"employee:{namespace}:{user_id}"
    return f"{scope}:{namespace}"


def decode_settings_source_action(source_action: str) -> SettingsChange | None:
    parts = source_action.split(":")
    if len(parts) == 2 and parts[0] in ("company", "employee"):
        return SettingsChange(scope=parts[0], namespace=parts[1], user_id=None)
    if len(parts) == 3 and parts[0] == "employee":
        try:
            user_id = int(parts[2])
        except ValueError:
            return None
        return SettingsChange(scope="employee", namespace=parts[1], user_id=user_id)
    return None


async def record_product_changes(
    session: AsyncSession,
    company_id: int,
    change_type: str,
    regos_item_ids: list[int] | None,
    source_action: str,
) -> None:
    """Bulk-insert events_log rows for a product webhook event."""
    if change_type == CHANGE_GROUPS_INVALIDATED:
        entry = EventsLog(
            company_id=company_id,
            change_type=change_type,
            regos_item_id=None,
            source_action=source_action,
        )
        session.add(entry)
        return

    if not regos_item_ids:
        return

    unique_ids = list(dict.fromkeys(item_id for item_id in regos_item_ids if item_id > 0))
    for item_id in unique_ids:
        entry = EventsLog(
            company_id=company_id,
            change_type=change_type,
            regos_item_id=item_id,
            source_action=source_action,
        )
        session.add(entry)


async def record_reference_options_invalidated(
    session: AsyncSession,
    company_id: int,
    kinds: list[str],
    source_action: str,
) -> None:
    """Record that warehouses / price types / partners need a catch-up refresh."""
    seen: set[str] = set()
    for kind in kinds:
        change_type = REFERENCE_KIND_TO_CHANGE.get(kind)
        if not change_type or change_type in seen:
            continue
        seen.add(change_type)
        session.add(
            EventsLog(
                company_id=company_id,
                change_type=change_type,
                regos_item_id=None,
                source_action=source_action,
            )
        )


async def record_payment_type_changes(
    session: AsyncSession,
    company_id: int,
    change_type: str,
    payment_type_ids: list[int] | None,
    source_action: str,
) -> None:
    if not payment_type_ids:
        return
    unique_ids = list(dict.fromkeys(item_id for item_id in payment_type_ids if item_id > 0))
    for item_id in unique_ids:
        session.add(
            EventsLog(
                company_id=company_id,
                change_type=change_type,
                regos_item_id=item_id,
                source_action=source_action,
            )
        )


async def record_settings_updated(
    session: AsyncSession,
    company_id: int,
    *,
    scope: str,
    namespace: str,
    user_id: int | None = None,
) -> None:
    session.add(
        EventsLog(
            company_id=company_id,
            change_type=CHANGE_SETTINGS_UPDATED,
            regos_item_id=user_id if scope == "employee" else None,
            source_action=encode_settings_source_action(scope, namespace, user_id),
        )
    )


async def get_changes_since(
    session: AsyncSession,
    company_id: int,
    since: datetime,
) -> ChangesSinceResult:
    """Query product-related events_log rows for a company since the given timestamp."""
    stmt = select(EventsLog).where(
        EventsLog.company_id == company_id,
        EventsLog.updated_at > since,
        EventsLog.change_type.in_(
            [
                CHANGE_PRODUCT_UPDATED,
                CHANGE_PRODUCT_REMOVED,
                CHANGE_GROUPS_INVALIDATED,
            ]
        ),
    )
    result = await session.execute(stmt)
    rows = result.scalars().all()

    updated_ids: set[int] = set()
    removed_ids: set[int] = set()
    groups_invalidated = False

    for row in rows:
        if row.change_type == CHANGE_PRODUCT_UPDATED and row.regos_item_id is not None:
            updated_ids.add(row.regos_item_id)
        elif row.change_type == CHANGE_PRODUCT_REMOVED and row.regos_item_id is not None:
            removed_ids.add(row.regos_item_id)
        elif row.change_type == CHANGE_GROUPS_INVALIDATED:
            groups_invalidated = True

    # If an item was both updated and removed, only keep it as removed
    updated_ids -= removed_ids

    return ChangesSinceResult(
        updated_item_ids=sorted(updated_ids),
        removed_item_ids=sorted(removed_ids),
        groups_invalidated=groups_invalidated,
    )


async def get_meta_changes_since(
    session: AsyncSession,
    company_id: int,
    since: datetime,
) -> MetaChangesSinceResult:
    """Query non-product events (reference options, payment types, settings)."""
    stmt = select(EventsLog).where(
        EventsLog.company_id == company_id,
        EventsLog.updated_at > since,
        EventsLog.change_type.in_(
            [
                CHANGE_REF_WAREHOUSE,
                CHANGE_REF_PRICE_TYPE,
                CHANGE_REF_PARTNER,
                CHANGE_PAYMENT_TYPE_UPD,
                CHANGE_PAYMENT_TYPE_RM,
                CHANGE_SETTINGS_UPDATED,
            ]
        ),
    )
    result = await session.execute(stmt)
    rows = result.scalars().all()

    kinds: set[str] = set()
    payment_types_invalidated = False
    settings_by_key: dict[tuple[str, str, int | None], SettingsChange] = {}

    for row in rows:
        kind = CHANGE_TO_REFERENCE_KIND.get(row.change_type)
        if kind:
            kinds.add(kind)
            continue
        if row.change_type in (CHANGE_PAYMENT_TYPE_UPD, CHANGE_PAYMENT_TYPE_RM):
            payment_types_invalidated = True
            continue
        if row.change_type == CHANGE_SETTINGS_UPDATED:
            decoded = decode_settings_source_action(row.source_action)
            if decoded is None:
                continue
            key = (decoded.scope, decoded.namespace, decoded.user_id)
            settings_by_key[key] = decoded

    return MetaChangesSinceResult(
        reference_kinds=sorted(kinds),
        payment_types_invalidated=payment_types_invalidated,
        settings=list(settings_by_key.values()),
    )


async def has_history_since(
    session: AsyncSession,
    company_id: int,
    since: datetime,
    retention_days: int = DEFAULT_RETENTION_DAYS,
) -> bool:
    """
    Check whether the events log has complete history covering the requested period.
    Since we keep at least `retention_days` of history, if `since` is within this
    retention window, we are guaranteed to have all changes that occurred since then.
    """
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    return since >= cutoff


async def cleanup_old_entries(
    session: AsyncSession,
    company_id: int,
    retention_days: int = DEFAULT_RETENTION_DAYS,
) -> int:
    """Delete events_log entries older than the retention period. Returns count deleted."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    stmt = delete(EventsLog).where(
        EventsLog.company_id == company_id,
        EventsLog.updated_at < cutoff,
    )
    result = await session.execute(stmt, execution_options={"synchronize_session": False})
    deleted = result.rowcount
    if isinstance(deleted, int) and deleted > 0:
        logger.info(
            "Cleaned up %d old events_log entries for company=%s",
            deleted,
            company_id,
        )
    return deleted if isinstance(deleted, int) else 0
