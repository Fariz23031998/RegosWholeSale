from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User
from app.services import settings as settings_service

USER_POS_SETTINGS_KEY = "pos"


async def get_user_pos_settings(session: AsyncSession, user_id: int) -> dict[str, Any]:
    all_settings = await settings_service.get_user_settings(session, user_id)
    return _normalize_user_pos_settings(all_settings.get(USER_POS_SETTINGS_KEY))


async def patch_user_pos_settings(
    session: AsyncSession,
    user: User,
    patch: dict[str, Any],
) -> dict[str, Any]:
    all_settings = await settings_service.get_user_settings(session, user.id)
    current = _normalize_user_pos_settings(all_settings.get(USER_POS_SETTINGS_KEY))

    if patch.get("default_category") is not None:
        current["default_category"] = _normalize_default_category(patch["default_category"])

    await settings_service.patch_user_settings(
        session,
        user,
        {USER_POS_SETTINGS_KEY: current},
    )
    return current


def _normalize_user_pos_settings(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    return {
        "default_category": _normalize_default_category(data.get("default_category")),
    }


def _normalize_default_category(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    mode = data.get("mode", "all")
    if mode not in {"all", "featured", "group"}:
        mode = "all"

    group_id = data.get("group_id")
    if mode == "group":
        if not isinstance(group_id, int) or group_id <= 0:
            mode = "all"
            group_id = None
    else:
        group_id = None

    return {"mode": mode, "group_id": group_id}
