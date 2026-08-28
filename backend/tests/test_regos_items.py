from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.services.regos_items import generate_ean13


@pytest.mark.asyncio
@patch("app.services.regos_items.regos_async_api_request_for_company", new_callable=AsyncMock)
async def test_generate_ean13_stringifies_numeric_value(mock_api: AsyncMock) -> None:
    session = AsyncMock(spec=AsyncSession)
    mock_api.return_value = {"ok": True, "result": {"value": 4601234567890}}

    data = await generate_ean13(session, 7)

    mock_api.assert_awaited_once_with(session, 7, "barcode/generateean13", {})
    assert data == {"value": "4601234567890"}


@pytest.mark.asyncio
@patch("app.services.regos_items.regos_async_api_request_for_company", new_callable=AsyncMock)
async def test_generate_ean13_keeps_string_value(mock_api: AsyncMock) -> None:
    session = AsyncMock(spec=AsyncSession)
    mock_api.return_value = {"ok": True, "result": {"value": "4601234567890"}}

    data = await generate_ean13(session, 7)

    assert data == {"value": "4601234567890"}


@pytest.mark.asyncio
@patch("app.services.regos_items.regos_async_api_request_for_company", new_callable=AsyncMock)
async def test_generate_ean13_rejects_empty_value(mock_api: AsyncMock) -> None:
    session = AsyncMock(spec=AsyncSession)
    mock_api.return_value = {"ok": True, "result": {"value": ""}}

    with pytest.raises(AppError) as exc_info:
        await generate_ean13(session, 7)

    assert exc_info.value.code == "BARCODE_GENERATE_FAILED"
    mock_api.assert_awaited_once_with(session, 7, "barcode/generateean13", {})
