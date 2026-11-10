from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import AppError
from app.services.regos_prices.price_documents.price_documents import (
    list_price_document_operations,
    list_price_documents,
)
from app.services.regos_prices.set_product_prices.set_product_prices import set_product_prices


def _line(item_id: int, base_value: float = 10, new_value: float = 12) -> dict:
    return {"item_id": item_id, "base_value": base_value, "new_value": new_value}


@pytest.fixture
def allow_price_type(monkeypatch):
    monkeypatch.setattr(
        "app.services.regos_prices.set_product_prices.set_product_prices.regos_defaults_service.assert_catalog_scope_allowed",
        AsyncMock(),
    )


async def test_set_product_prices_locks_adds_and_performs(monkeypatch, allow_price_type):
    calls: list[tuple[str, object]] = []

    async def fake_regos(_session, _company_id, endpoint, payload):
        calls.append((endpoint, payload))
        if endpoint == "docsetprice/add":
            return {"ok": True, "result": {"new_id": 6101}}
        return {"ok": True, "result": {"row_affected": 1}}

    monkeypatch.setattr(
        "app.services.regos_prices.set_product_prices.set_product_prices.regos_async_api_request_for_company",
        fake_regos,
    )

    result = await set_product_prices(
        None,
        1,
        2,
        ["prices.write"],
        price_type_id=3,
        lines=[_line(1001, 42000, 48000)],
    )

    assert result == {"document_id": 6101}
    assert [endpoint for endpoint, _payload in calls] == [
        "docsetprice/add",
        "docsetprice/lock",
        "setpriceoperation/add",
        "docsetprice/perform",
        "docsetprice/unlock",
    ]
    assert calls[0][1] == {"price_type_id": 3, "description": "Price update from products"}
    assert calls[1][1] == {"ids": [6101]}
    assert calls[2][1] == [
        {"document_id": 6101, "item_id": 1001, "base_value": 42000, "new_value": 48000}
    ]
    assert calls[3][1] == {"id": 6101}
    assert calls[4][1] == {"ids": [6101]}


async def test_set_product_prices_chunks_operations(monkeypatch, allow_price_type):
    calls: list[tuple[str, object]] = []

    async def fake_regos(_session, _company_id, endpoint, payload):
        calls.append((endpoint, payload))
        if endpoint == "docsetprice/add":
            return {"ok": True, "result": {"new_id": 7}}
        return {"ok": True, "result": {"row_affected": 1}}

    monkeypatch.setattr(
        "app.services.regos_prices.set_product_prices.set_product_prices.regos_async_api_request_for_company",
        fake_regos,
    )

    await set_product_prices(
        None,
        1,
        2,
        [],
        price_type_id=3,
        lines=[_line(index) for index in range(1, 102)],
    )

    operation_calls = [payload for endpoint, payload in calls if endpoint == "setpriceoperation/add"]
    assert [len(payload) for payload in operation_calls] == [100, 1]


async def test_set_product_prices_discards_draft_when_lines_fail(monkeypatch, allow_price_type):
    calls: list[str] = []

    async def fake_regos(_session, _company_id, endpoint, _payload):
        calls.append(endpoint)
        if endpoint == "docsetprice/add":
            return {"ok": True, "result": {"new_id": 6101}}
        if endpoint == "setpriceoperation/add":
            raise AppError(400, "REGOS API error: locked", "REGOS_API_ERROR")
        return {"ok": True, "result": {"row_affected": 1}}

    monkeypatch.setattr(
        "app.services.regos_prices.set_product_prices.set_product_prices.regos_async_api_request_for_company",
        fake_regos,
    )

    with pytest.raises(AppError):
        await set_product_prices(
            None,
            1,
            2,
            [],
            price_type_id=3,
            lines=[_line(1001)],
        )

    assert calls == [
        "docsetprice/add",
        "docsetprice/lock",
        "setpriceoperation/add",
        "docsetprice/deletemark",
        "docsetprice/delete",
        "docsetprice/unlock",
    ]


async def test_set_product_prices_rejects_a_negative_price(allow_price_type):
    with pytest.raises(AppError) as caught:
        await set_product_prices(
            None,
            1,
            2,
            [],
            price_type_id=3,
            lines=[_line(1001, -1, 5)],
        )
    assert caught.value.code == "INVALID_PRICE"


async def test_list_price_documents_sends_filters_and_maps_rows(monkeypatch):
    captured: dict = {}

    async def fake_regos(_session, _company_id, endpoint, payload):
        captured["endpoint"] = endpoint
        captured["payload"] = payload
        return {
            "ok": True,
            "result": [
                {
                    "id": 6101,
                    "date": 1767225600,
                    "code": "SP-000061",
                    "price_type": {"id": 3, "name": "Retail"},
                    "description": "January retail price update",
                    "performed": False,
                    "deleted_mark": False,
                }
            ],
            "next_offset": 0,
            "total": 1,
        }

    monkeypatch.setattr(
        "app.services.regos_prices.price_documents.price_documents.regos_async_api_request_for_company",
        fake_regos,
    )

    result = await list_price_documents(
        None,
        1,
        start_date=10,
        end_date=20,
        search=" SP ",
        price_type_id=3,
        limit=50,
        offset=0,
    )

    assert captured["endpoint"] == "docsetprice/get"
    filters = {item["field"]: item for item in captured["payload"]["filters"]}
    assert filters["deleted_mark"] == {"field": "deleted_mark", "operator": "Equal", "value": "false"}
    assert filters["start_date"]["value"] == "10"
    assert filters["end_date"]["value"] == "20"
    assert filters["price_type_id"]["value"] == "3"
    assert captured["payload"]["search"] == "SP"
    assert captured["payload"]["sort_orders"] == [{"column": "date", "direction": "DESC"}]
    assert result["documents"] == [
        {
            "id": 6101,
            "code": "SP-000061",
            "date": 1767225600,
            "price_type_id": 3,
            "price_type_name": "Retail",
            "description": "January retail price update",
            "performed": False,
        }
    ]


async def test_list_price_document_operations_maps_item_prices(monkeypatch):
    async def fake_regos(_session, _company_id, endpoint, payload):
        assert endpoint == "setpriceoperation/get"
        assert payload["document_ids"] == [6101]
        return {
            "ok": True,
            "result": [
                {
                    "id": 8101,
                    "document_id": 6101,
                    "item": {"id": 1001, "name": "Milk", "code": "A-1"},
                    "base_value": 42000,
                    "new_value": 48000,
                }
            ],
        }

    monkeypatch.setattr(
        "app.services.regos_prices.price_documents.price_documents.regos_async_api_request_for_company",
        fake_regos,
    )

    result = await list_price_document_operations(None, 1, 6101)
    assert result["operations"] == [
        {
            "id": 8101,
            "item_id": 1001,
            "item_code": "A-1",
            "item_name": "Milk",
            "base_value": 42000.0,
            "new_value": 48000.0,
        }
    ]
