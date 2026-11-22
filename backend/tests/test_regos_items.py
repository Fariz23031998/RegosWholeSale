import base64
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.services.regos_items import (
    _normalize_item_image_base64,
    generate_ean13,
    save_item_image,
)


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


def test_normalize_item_image_base64_wraps_jpeg_as_data_url() -> None:
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 16
    raw = base64.b64encode(jpeg).decode("ascii")

    data_url, raw_bytes, content_type = _normalize_item_image_base64(raw)

    assert content_type == "image/jpeg"
    assert raw_bytes == jpeg
    assert data_url == f"data:image/jpeg;base64,{raw}"


def test_normalize_item_image_base64_keeps_existing_data_url() -> None:
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
    raw = base64.b64encode(png).decode("ascii")
    incoming = f"data:image/png;base64,{raw}"

    data_url, raw_bytes, content_type = _normalize_item_image_base64(incoming)

    assert content_type == "image/png"
    assert raw_bytes == png
    assert data_url == incoming


def _tiny_jpeg_base64(width: int = 32, height: int = 24) -> str:
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (width, height), (20, 40, 60)).save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("ascii")


@pytest.mark.asyncio
@patch("app.services.regos_items.regos_async_api_request_for_company", new_callable=AsyncMock)
async def test_save_item_image_sends_raw_900_square_jpeg(mock_json: AsyncMock) -> None:
    from io import BytesIO

    from PIL import Image

    session = AsyncMock(spec=AsyncSession)
    mock_json.return_value = {"ok": True, "result": {"new_id": 42}}
    raw = _tiny_jpeg_base64(120, 80)

    data = await save_item_image(session, 7, 99, raw)

    assert data == {"new_id": 42}
    mock_json.assert_awaited_once()
    payload = mock_json.await_args.args[3]
    assert payload["item_id"] == 99
    assert isinstance(payload["file"], str)
    assert not payload["file"].startswith("data:")
    out = base64.b64decode(payload["file"])
    assert out[:3] == b"\xff\xd8\xff"
    with Image.open(BytesIO(out)) as img:
        assert img.size == (900, 900)


@pytest.mark.asyncio
@patch("app.services.regos_items.regos_async_api_request_for_company", new_callable=AsyncMock)
async def test_save_item_image_strips_data_url_prefix(mock_json: AsyncMock) -> None:
    from io import BytesIO

    from PIL import Image

    session = AsyncMock(spec=AsyncSession)
    mock_json.return_value = {"ok": True, "result": {"new_id": 77}}
    raw = _tiny_jpeg_base64()

    data = await save_item_image(session, 7, 99, f"data:image/jpeg;base64,{raw}")

    assert data == {"new_id": 77}
    payload = mock_json.await_args.args[3]
    assert not payload["file"].startswith("data:")
    with Image.open(BytesIO(base64.b64decode(payload["file"]))) as img:
        assert img.size == (900, 900)
