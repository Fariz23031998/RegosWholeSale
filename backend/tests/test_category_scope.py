from unittest.mock import AsyncMock, patch

import pytest

from app.services.category_scope import (
    expand_product_group_ids,
    get_allowed_partner_group_id_set,
    partner_group_in_allowed,
    product_in_allowed_groups,
)
from app.services.pos_settings import _normalize_id_list

def test_expand_product_group_ids_includes_descendants() -> None:
    groups = [
        {"id": 1, "parent_id": None, "name": "Food"},
        {"id": 2, "parent_id": 1, "name": "Dairy"},
        {"id": 3, "parent_id": 2, "name": "Milk"},
        {"id": 4, "parent_id": None, "name": "Tools"},
    ]
    assert expand_product_group_ids([1], groups) == {1, 2, 3}
    assert expand_product_group_ids([2], groups) == {2, 3}
    assert expand_product_group_ids([4], groups) == {4}
    assert expand_product_group_ids([], groups) == set()


def test_product_in_allowed_groups() -> None:
    allowed = {1, 2}
    assert product_in_allowed_groups({"group_id": 2}, allowed) is True
    assert product_in_allowed_groups({"group_id": 9}, allowed) is False
    assert product_in_allowed_groups({"group_id": None}, allowed) is False


def test_normalize_id_list_strips_invalid_and_duplicates() -> None:
    assert _normalize_id_list([3, 1, 1, 0, -4, "2", "x", True, 4.0]) == [3, 1, 2, 4]
    assert _normalize_id_list(None) == []
    assert _normalize_id_list("1,2") == []


def test_partner_group_in_allowed_treats_none_as_unrestricted() -> None:
    assert partner_group_in_allowed(9, None) is True
    assert partner_group_in_allowed(9, {9, 2}) is True
    assert partner_group_in_allowed(1, {9, 2}) is False
    assert partner_group_in_allowed(None, {9}) is False


@pytest.mark.asyncio
async def test_get_allowed_partner_group_id_set_empty_is_unrestricted() -> None:
    session = AsyncMock()
    with patch(
        "app.services.category_scope._get_user_pos_overrides",
        new_callable=AsyncMock,
        return_value={},
    ):
        assert await get_allowed_partner_group_id_set(session, 1) is None

    with patch(
        "app.services.category_scope._get_user_pos_overrides",
        new_callable=AsyncMock,
        return_value={"allowed_partner_group_ids": [4, 4, 8, 0]},
    ):
        assert await get_allowed_partner_group_id_set(session, 1) == {4, 8}
