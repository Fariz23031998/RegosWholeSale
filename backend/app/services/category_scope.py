from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError, forbidden
from app.services.pos_settings import _get_user_pos_overrides, _normalize_id_list


def expand_product_group_ids(
    selected_ids: list[int],
    groups: list[dict[str, Any]],
) -> set[int]:
    if not selected_ids:
        return set()

    children_by_parent: dict[int, list[int]] = {}
    for group in groups:
        group_id = group.get("id")
        if not isinstance(group_id, int) or group_id <= 0:
            continue
        parent_id = group.get("parent_id")
        if isinstance(parent_id, int) and parent_id > 0:
            children_by_parent.setdefault(parent_id, []).append(group_id)

    expanded: set[int] = set()
    stack = list(dict.fromkeys(selected_ids))
    while stack:
        current = stack.pop()
        if current in expanded:
            continue
        expanded.add(current)
        stack.extend(children_by_parent.get(current, []))
    return expanded


def product_in_allowed_groups(product: dict[str, Any], allowed_group_ids: set[int]) -> bool:
    group_id = product.get("group_id")
    return isinstance(group_id, int) and group_id in allowed_group_ids


async def get_allowed_product_group_id_set(
    session: AsyncSession,
    user_id: int,
    company_id: int,
) -> set[int] | None:
    overrides = await _get_user_pos_overrides(session, user_id)
    selected = _normalize_id_list(overrides.get("allowed_product_group_ids"))
    if not selected:
        return None

    try:
        from app.services.regos_groups import list_groups

        groups = (await list_groups(session, company_id)).get("groups") or []
        return expand_product_group_ids(selected, groups)
    except AppError:
        return set(selected)


async def get_allowed_partner_group_id_set(
    session: AsyncSession,
    user_id: int,
) -> set[int] | None:
    overrides = await _get_user_pos_overrides(session, user_id)
    selected = _normalize_id_list(overrides.get("allowed_partner_group_ids"))
    if not selected:
        return None
    return set(selected)


def partner_group_in_allowed(group_id: Any, allowed_group_ids: set[int] | None) -> bool:
    if allowed_group_ids is None:
        return True
    return isinstance(group_id, int) and group_id in allowed_group_ids


async def assert_partner_group_allowed(
    session: AsyncSession,
    user_id: int,
    group_id: int | None,
) -> None:
    if group_id is None:
        return
    allowed = await get_allowed_partner_group_id_set(session, user_id)
    if not partner_group_in_allowed(group_id, allowed):
        raise forbidden(
            "Partner is outside your allowed partner groups.",
            "FORBIDDEN",
        )


async def assert_partner_in_allowed_groups(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    partner_id: int,
) -> None:
    allowed = await get_allowed_partner_group_id_set(session, user_id)
    if allowed is None:
        return

    from app.services.regos_partners import get_partner_by_id

    partner = await get_partner_by_id(session, company_id, partner_id)
    if not partner_group_in_allowed(partner.get("group_id"), allowed):
        raise forbidden(
            "Partner is outside your allowed partner groups.",
            "FORBIDDEN",
        )
