import pytest

from app.services.regos_document_fetch import OPERATIONS_PAGE_SIZE, fetch_operations


@pytest.mark.asyncio
async def test_fetch_operations_paginates_until_short_page(monkeypatch):
    requests: list[dict] = []

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        requests.append(dict(request_data))
        offset = int(request_data["offset"])
        if offset == 0:
            return {
                "ok": True,
                "result": [{"id": index, "quantity": 1} for index in range(1, OPERATIONS_PAGE_SIZE + 1)],
            }
        if offset == OPERATIONS_PAGE_SIZE:
            return {
                "ok": True,
                "result": [{"id": OPERATIONS_PAGE_SIZE + 1, "quantity": 1}],
            }
        return {"ok": True, "result": []}

    monkeypatch.setattr(
        "app.services.regos_document_fetch.regos_async_api_request_for_company",
        fake_regos,
    )

    operations = await fetch_operations(None, 1, "PurchaseOperation/Get", 99)

    assert operations is not None
    assert len(operations) == OPERATIONS_PAGE_SIZE + 1
    assert requests == [
        {"document_ids": [99], "limit": OPERATIONS_PAGE_SIZE, "offset": 0},
        {"document_ids": [99], "limit": OPERATIONS_PAGE_SIZE, "offset": OPERATIONS_PAGE_SIZE},
    ]
