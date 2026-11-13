from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from helpers import register_owner
from app.services import regos_defaults as regos_defaults_service
from app.services import regos_defaults_seed as seed_service
from app.services import regos_tokens as regos_tokens_service

REGOS_TOKEN = "b" * 32


def _regos_router(_session, _company_id, endpoint: str, request_data: dict | list, **_kwargs):
    if endpoint == "accountoperationcategory/get":
        if isinstance(request_data, dict):
            ids = request_data.get("ids")
            if ids == [101]:
                return {
                    "ok": True,
                    "result": [{"id": 101, "name": "RegosOptomIncome", "positive": True}],
                }
            if ids == [102]:
                return {
                    "ok": True,
                    "result": [{"id": 102, "name": "RegosOptomRefund", "positive": False}],
                }
            if request_data.get("positive") is True:
                return {"ok": True, "result": [], "total": 0}
            if request_data.get("positive") is False:
                return {"ok": True, "result": [], "total": 0}
        return {"ok": True, "result": [], "total": 0}

    if endpoint == "accountoperationcategory/add":
        assert isinstance(request_data, dict)
        if request_data.get("name") == "RegosOptomIncome":
            assert request_data.get("positive") is True
            return {"ok": True, "result": {"new_id": 101}}
        if request_data.get("name") == "RegosOptomRefund":
            assert request_data.get("positive") is False
            return {"ok": True, "result": {"new_id": 102}}
        raise AssertionError(f"Unexpected category add: {request_data}")

    if endpoint == "stock/get":
        rows = [
            {
                "id": 11,
                "name": "Alpha WH",
                "firm": {"id": 55, "name": "Firm A"},
            },
            {
                "id": 12,
                "name": "Beta WH",
                "firm": {"id": 56, "name": "Firm B"},
            },
        ]
        if isinstance(request_data, dict) and request_data.get("ids"):
            wanted = set(request_data["ids"])
            rows = [row for row in rows if row["id"] in wanted]
        return {"ok": True, "result": rows, "total": len(rows)}

    if endpoint == "pricetype/get":
        rows = [
            {
                "id": 21,
                "name": "A Price",
                "currency": {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1},
            },
            {
                "id": 22,
                "name": "B Price",
                "currency": {"id": 2, "name": "USD", "code_chr": "USD", "exchange_rate": 12000},
            },
        ]
        if isinstance(request_data, dict) and request_data.get("ids"):
            wanted = set(request_data["ids"])
            rows = [row for row in rows if row["id"] in wanted]
        return {"ok": True, "result": rows, "total": len(rows)}

    if endpoint == "user/get":
        rows = [
            {"id": 71, "first_name": "Ada", "last_name": "Lovelace", "active": True},
            {"id": 72, "first_name": "Bob", "last_name": "Builder", "active": True},
        ]
        if isinstance(request_data, dict) and request_data.get("ids"):
            wanted = set(request_data["ids"])
            rows = [row for row in rows if row["id"] in wanted]
        return {"ok": True, "result": rows, "total": len(rows)}

    raise AssertionError(f"Unexpected Regos endpoint: {endpoint} {request_data}")


def _regos_router_reuse_existing(
    session, company_id, endpoint: str, request_data: dict | list, **kwargs
):
    if endpoint == "accountoperationcategory/add":
        raise AssertionError("Should reuse existing categories, not create")

    if endpoint == "accountoperationcategory/get":
        if isinstance(request_data, dict):
            ids = request_data.get("ids")
            if ids == [201]:
                return {
                    "ok": True,
                    "result": [{"id": 201, "name": "RegosOptomIncome", "positive": True}],
                }
            if ids == [202]:
                return {
                    "ok": True,
                    "result": [{"id": 202, "name": "RegosOptomRefund", "positive": False}],
                }
            if request_data.get("positive") is True:
                return {
                    "ok": True,
                    "result": [
                        {"id": 200, "name": "OtherIncome", "positive": True},
                        {"id": 201, "name": "RegosOptomIncome", "positive": True},
                    ],
                    "total": 2,
                }
            if request_data.get("positive") is False:
                return {
                    "ok": True,
                    "result": [
                        {"id": 202, "name": "RegosOptomRefund", "positive": False},
                        {"id": 203, "name": "OtherRefund", "positive": False},
                    ],
                    "total": 2,
                }
        return {"ok": True, "result": [], "total": 0}

    return _regos_router(session, company_id, endpoint, request_data, **kwargs)


async def _company_id_from_client(client: AsyncClient, headers: dict) -> int:
    me = await client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    return int(me.json()["company_id"])


async def _save_token(client: AsyncClient, headers: dict) -> None:
    upsert = await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )
    assert upsert.status_code == 200


@patch("app.services.regos_defaults_seed.regos_async_api_request_for_company", new_callable=AsyncMock)
@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_seed_creates_categories_and_applies_defaults(
    mock_defaults_regos: AsyncMock,
    mock_seed_regos: AsyncMock,
    client: AsyncClient,
    session_factory,
) -> None:
    mock_defaults_regos.side_effect = _regos_router
    mock_seed_regos.side_effect = _regos_router

    reg = await register_owner(
        client, email="seed-create@test.com", company_name="Seed Create Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    company_id = await _company_id_from_client(client, headers)
    await _save_token(client, headers)

    async with session_factory() as session:
        seeded = await seed_service.seed_company_regos_defaults_after_token(
            session, company_id
        )
        await session.commit()
        assert seeded is True
        defaults = await regos_defaults_service.get_stored_regos_defaults(
            session, company_id
        )

    assert defaults["warehouse"] == {"id": 11, "name": "Alpha WH"}
    assert defaults["price_type"] == {"id": 21, "name": "A Price"}
    assert defaults["partner"] is None
    assert defaults["payment_category"] == {"id": 101, "name": "RegosOptomIncome"}
    assert defaults["refund_payment_category"] == {
        "id": 102,
        "name": "RegosOptomRefund",
    }
    assert defaults["attached_user"] == {"id": 71, "name": "Ada Lovelace"}
    assert defaults["vat_calculation_type"] == "No"

    add_calls = [
        call
        for call in mock_seed_regos.await_args_list
        if call.args[2] == "accountoperationcategory/add"
    ]
    assert len(add_calls) == 2


@patch("app.services.regos_defaults_seed.regos_async_api_request_for_company", new_callable=AsyncMock)
@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_seed_reuses_existing_named_categories(
    mock_defaults_regos: AsyncMock,
    mock_seed_regos: AsyncMock,
    client: AsyncClient,
    session_factory,
) -> None:
    mock_defaults_regos.side_effect = _regos_router_reuse_existing
    mock_seed_regos.side_effect = _regos_router_reuse_existing

    reg = await register_owner(
        client, email="seed-reuse@test.com", company_name="Seed Reuse Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    company_id = await _company_id_from_client(client, headers)
    await _save_token(client, headers)

    async with session_factory() as session:
        seeded = await seed_service.seed_company_regos_defaults_after_token(
            session, company_id
        )
        await session.commit()
        assert seeded is True
        defaults = await regos_defaults_service.get_stored_regos_defaults(
            session, company_id
        )

    assert defaults["payment_category"] == {"id": 201, "name": "RegosOptomIncome"}
    assert defaults["refund_payment_category"] == {
        "id": 202,
        "name": "RegosOptomRefund",
    }
    assert mock_seed_regos.await_count == 0


@patch("app.services.regos_defaults_seed.regos_async_api_request_for_company", new_callable=AsyncMock)
@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_seed_is_once_only(
    mock_defaults_regos: AsyncMock,
    mock_seed_regos: AsyncMock,
    client: AsyncClient,
    session_factory,
) -> None:
    mock_defaults_regos.side_effect = _regos_router
    mock_seed_regos.side_effect = _regos_router

    reg = await register_owner(
        client, email="seed-once@test.com", company_name="Seed Once Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    company_id = await _company_id_from_client(client, headers)
    await _save_token(client, headers)

    async with session_factory() as session:
        first = await seed_service.seed_company_regos_defaults_after_token(
            session, company_id
        )
        await session.commit()
        assert first is True

    mock_defaults_regos.reset_mock()
    mock_seed_regos.reset_mock()

    async with session_factory() as session:
        second = await seed_service.seed_company_regos_defaults_after_token(
            session, company_id
        )
        assert second is False
        defaults = await regos_defaults_service.get_stored_regos_defaults(
            session, company_id
        )

    assert defaults["payment_category"]["id"] == 101
    assert mock_defaults_regos.await_count == 0
    assert mock_seed_regos.await_count == 0


@pytest.mark.enable_regos_defaults_seed
@pytest.mark.asyncio
async def test_token_upsert_soft_fails_when_seed_raises(
    client: AsyncClient,
    monkeypatch,
) -> None:
    async def boom(*_args, **_kwargs):
        raise RuntimeError("seed failed")

    monkeypatch.setattr(
        "app.services.regos_tokens.seed_company_regos_defaults_after_token",
        boom,
    )

    reg = await register_owner(
        client, email="seed-softfail@test.com", company_name="Seed Softfail Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    upsert = await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )
    assert upsert.status_code == 200

    status = await client.get("/api/v1/regos/tokens/status", headers=headers)
    assert status.status_code == 200
    assert status.json()["configured"] is True


@pytest.mark.enable_regos_defaults_seed
@patch("app.services.regos_defaults_seed.regos_async_api_request_for_company", new_callable=AsyncMock)
@patch("app.services.regos_defaults.regos_async_api_request_for_company", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_upsert_token_service_runs_seed(
    mock_defaults_regos: AsyncMock,
    mock_seed_regos: AsyncMock,
    client: AsyncClient,
    session_factory,
) -> None:
    mock_defaults_regos.side_effect = _regos_router
    mock_seed_regos.side_effect = _regos_router

    reg = await register_owner(
        client, email="seed-upsert@test.com", company_name="Seed Upsert Co"
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    company_id = await _company_id_from_client(client, headers)

    async with session_factory() as session:
        await regos_tokens_service.upsert_token(
            session, company_id, REGOS_TOKEN, False
        )
        await session.commit()
        defaults = await regos_defaults_service.get_stored_regos_defaults(
            session, company_id
        )

    assert defaults["vat_calculation_type"] == "No"
    assert defaults["payment_category"]["name"] == "RegosOptomIncome"
    assert defaults["partner"] is None
