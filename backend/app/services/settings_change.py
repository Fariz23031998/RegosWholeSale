"""Publish live settings SSE and durable events_log catch-up in one place."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import events_log as events_log_service
from app.services.settings_events import (
    SettingsNamespace,
    SettingsScope,
    publish_settings_updated,
)


async def notify_settings_updated(
    session: AsyncSession,
    company_id: int,
    *,
    scope: SettingsScope,
    namespace: SettingsNamespace,
    user_id: int | None = None,
) -> None:
    publish_settings_updated(
        company_id,
        scope=scope,
        namespace=namespace,
        user_id=user_id,
    )
    await events_log_service.record_settings_updated(
        session,
        company_id,
        scope=scope,
        namespace=namespace,
        user_id=user_id,
    )
