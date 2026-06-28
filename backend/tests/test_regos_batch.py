from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.core.regos_batch import chunk_batch_steps, regos_batch_request_for_company


@pytest.mark.asyncio
async def test_chunk_batch_steps() -> None:
    steps = [{"key": f"step_{index}", "path": "item/get", "payload": {}} for index in range(55)]
    chunks = chunk_batch_steps(steps, max_steps=50)
    assert len(chunks) == 2
    assert len(chunks[0]) == 50
    assert len(chunks[1]) == 5


@pytest.mark.asyncio
@patch("app.core.regos_batch.regos_async_api_request_for_company", new_callable=AsyncMock)
async def test_regos_batch_request_for_company(mock_api: AsyncMock) -> None:
    mock_api.return_value = {
        "ok": True,
        "result": [
            {
                "key": "sales",
                "status": 200,
                "response": {"ok": True, "result": [{"id": 1}], "total": 1, "next_offset": 0},
            },
            {
                "key": "payments",
                "status": 200,
                "response": {"ok": True, "result": [], "total": 0, "next_offset": 0},
            },
        ],
    }

    results = await regos_batch_request_for_company(
        AsyncMock(spec=AsyncSession),
        1,
        [
            {"key": "sales", "path": "docwholesale/get", "payload": {"limit": 10}},
            {"key": "payments", "path": "docpayment/get", "payload": {"limit": 10}},
        ],
    )

    assert results["sales"]["result"][0]["id"] == 1
    assert results["payments"]["result"] == []
    mock_api.assert_awaited_once()
    batch_payload = mock_api.await_args.args[3]
    assert batch_payload["stop_on_error"] is False
    assert len(batch_payload["requests"]) == 2


@pytest.mark.asyncio
@patch("app.core.regos_batch.regos_async_api_request_for_company", new_callable=AsyncMock)
async def test_regos_batch_request_raises_on_failed_step(mock_api: AsyncMock) -> None:
    mock_api.return_value = {
        "ok": True,
        "result": [
            {
                "key": "sales",
                "status": 200,
                "response": {"ok": False, "result": {"error": 400, "description": "Bad request"}},
            }
        ],
    }

    with pytest.raises(AppError) as exc_info:
        await regos_batch_request_for_company(
            AsyncMock(spec=AsyncSession),
            1,
            [{"key": "sales", "path": "docwholesale/get", "payload": {}}],
            stop_on_error=True,
        )

    assert exc_info.value.detail["code"] == "REGOS_BATCH_ERROR"


@pytest.mark.asyncio
@patch("app.core.regos_batch.regos_async_api_request_for_company", new_callable=AsyncMock)
async def test_regos_batch_request_tolerates_failed_step_when_stop_on_error_false(
    mock_api: AsyncMock,
) -> None:
    mock_api.return_value = {
        "ok": True,
        "result": [
            {
                "key": "sales",
                "status": 200,
                "response": {"ok": False, "result": {"error": 400, "description": "Bad request"}},
            }
        ],
    }

    results = await regos_batch_request_for_company(
        AsyncMock(spec=AsyncSession),
        1,
        [{"key": "sales", "path": "docwholesale/get", "payload": {}}],
        stop_on_error=False,
    )

    assert results["sales"]["ok"] is False
