import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.core.exceptions import AppError
from app.services.cbu_exchange_rates import (
    clear_cbu_rates_cache,
    fetch_cbu_rates,
    parse_cbu_rates_payload,
    refresh_cbu_rates_cache,
)
from app.services.exchange_rate_formula import apply_formula, preview_formula, validate_formula
from helpers import register_owner

REGOS_TOKEN = "b" * 32
CBU_FIXTURE = json.loads(
    (
        Path(__file__).resolve().parents[2]
        / "exchanger"
        / "tests"
        / "Fixtures"
        / "Service"
        / "CentralBankOfRepublicUzbekistan"
        / "cbru_today.json"
    ).read_text(encoding="utf-8")
)


def test_parse_cbu_rates_payload_computes_rate_per_nominal() -> None:
    rates = parse_cbu_rates_payload(CBU_FIXTURE)
    assert rates["USD"].rate == pytest.approx(10919.89)
    assert rates["EUR"].rate == pytest.approx(11125.18)


def test_parse_cbu_rates_payload_invalid_payload() -> None:
    with pytest.raises(AppError) as exc:
        parse_cbu_rates_payload({"invalid": True})
    assert exc.value.code == "CBU_INVALID_RESPONSE"


@pytest.mark.parametrize(
    ("formula", "rate", "expected"),
    [
        ("exchange_rate - 100", 12650.0, 12550.0),
        ("exchange_rate + 50", 12650.0, 12700.0),
        ("exchange_rate * 1.05", 12650.0, 13282.5),
        ("exchange_rate / 1.02", 12650.0, 12401.96078431),
        ("exchange_rate", 12650.0, 12650.0),
        ("round(exchange_rate * 1.05)", 12650.0, 13283.0),
        ("round(exchange_rate * 1.05, 2)", 12650.0, 13282.5),
        ("floor(exchange_rate * 1.05)", 12650.0, 13282.0),
        ("ceil(exchange_rate * 1.05)", 12650.0, 13283.0),
        ("ceil(exchange_rate / 1000, 0) * 1000", 12650.0, 13000.0),
        ("floor(exchange_rate / 1000, 0) * 1000", 12650.0, 12000.0),
    ],
)
def test_apply_formula_examples(formula: str, rate: float, expected: float) -> None:
    assert apply_formula(formula, rate) == pytest.approx(expected, rel=1e-6)


def test_validate_formula_rejects_unknown_variable() -> None:
    with pytest.raises(AppError) as exc:
        validate_formula("usd_rate * 2")
    assert exc.value.code == "EXCHANGE_RATE_FORMULA_INVALID"


def test_validate_formula_rejects_unsupported_function_calls() -> None:
    with pytest.raises(AppError) as exc:
        validate_formula("abs(exchange_rate)")
    assert exc.value.code == "EXCHANGE_RATE_FORMULA_INVALID"


def test_validate_formula_rejects_dangerous_function_calls() -> None:
    with pytest.raises(AppError) as exc:
        validate_formula("__import__('os').system('rm -rf /')")
    assert exc.value.code == "EXCHANGE_RATE_FORMULA_INVALID"


def test_apply_formula_rejects_division_by_zero() -> None:
    with pytest.raises(AppError) as exc:
        apply_formula("exchange_rate / 0", 1000)
    assert exc.value.code == "EXCHANGE_RATE_FORMULA_INVALID"


def test_preview_formula_uses_sample_rate() -> None:
    assert preview_formula("exchange_rate * 2", sample_rate=500) == 1000.0


@pytest.mark.asyncio
async def test_get_exchange_rate_sync_settings_defaults(client: AsyncClient) -> None:
    reg = await register_owner(client, email="fx-defaults@test.com", company_name="FX Defaults")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.get("/api/v1/company/settings/exchange-rate-sync", headers=headers)
    assert response.status_code == 200
    data = response.json()["settings"]
    assert data["enabled"] is False
    assert data["rules"] == []


@patch("app.services.cbu_exchange_rates._fetch_cbu_json_from_api", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_fetch_cbu_rates_uses_project_cache(mock_fetch: AsyncMock) -> None:
    clear_cbu_rates_cache()
    mock_fetch.return_value = CBU_FIXTURE

    await refresh_cbu_rates_cache()
    first = await fetch_cbu_rates()
    second = await fetch_cbu_rates()

    assert first["USD"].rate == pytest.approx(10919.89)
    assert second["USD"].rate == pytest.approx(10919.89)
    mock_fetch.assert_awaited_once()


@pytest.mark.asyncio
async def test_patch_exchange_rate_sync_validates_formula(client: AsyncClient) -> None:
    reg = await register_owner(client, email="fx-invalid@test.com", company_name="FX Invalid")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.patch(
        "/api/v1/company/settings/exchange-rate-sync",
        headers=headers,
        json={
            "rules": [
                {
                    "currency_id": 2,
                    "currency_code": "USD",
                    "formula": "secret * 2",
                    "enabled": True,
                }
            ],
        },
    )
    assert response.status_code == 400
    assert response.json()["code"] == "EXCHANGE_RATE_FORMULA_INVALID"


@pytest.mark.asyncio
async def test_patch_exchange_rate_sync_saves_rules(client: AsyncClient) -> None:
    reg = await register_owner(client, email="fx-save@test.com", company_name="FX Save")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.patch(
        "/api/v1/company/settings/exchange-rate-sync",
        headers=headers,
        json={
            "enabled": True,
            "rules": [
                {
                    "currency_id": 2,
                    "currency_code": "USD",
                    "formula": "exchange_rate * 1.05",
                    "enabled": True,
                }
            ],
        },
    )
    assert response.status_code == 200
    settings = response.json()["settings"]
    assert settings["enabled"] is True
    assert settings["rules"][0]["formula"] == "exchange_rate * 1.05"


@pytest.mark.asyncio
async def test_preview_exchange_rate_formula_endpoint(client: AsyncClient) -> None:
    reg = await register_owner(client, email="fx-preview@test.com", company_name="FX Preview")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.post(
        "/api/v1/company/settings/exchange-rate-sync/preview",
        headers=headers,
        json={"formula": "exchange_rate + 50", "sample_rate": 1000},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["official_rate"] == 1000
    assert data["calculated_rate"] == 1050


@patch("app.services.exchange_rate_sync.regos_async_api_request_for_company", new_callable=AsyncMock)
@patch("app.services.exchange_rate_sync.fetch_currency_items_by_ids", new_callable=AsyncMock)
@patch("app.services.exchange_rate_sync._fetch_base_currency", new_callable=AsyncMock)
@patch("app.services.exchange_rate_sync.fetch_cbu_rates", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_run_exchange_rate_sync_updates_regos(
    mock_fetch_cbu: AsyncMock,
    mock_fetch_base: AsyncMock,
    mock_fetch_currencies: AsyncMock,
    mock_regos_request: AsyncMock,
    client: AsyncClient,
) -> None:
    from app.services.cbu_exchange_rates import CbuRate

    mock_fetch_cbu.return_value = {
        "USD": CbuRate(code="USD", rate=12650.0, nominal=1, rate_date=None),
    }
    mock_fetch_base.return_value = {
        "id": 44,
        "name": "UZS",
        "code_chr": "UZS",
        "exchange_rate": 1,
        "is_base": True,
    }
    mock_fetch_currencies.return_value = {
        2: {
            "id": 2,
            "name": "US Dollar",
            "code_chr": "USD",
            "exchange_rate": 12000.0,
            "is_base": False,
            "deleted": False,
        }
    }
    mock_regos_request.return_value = {"ok": True, "result": {"row_affected": 1}}

    reg = await register_owner(client, email="fx-run@test.com", company_name="FX Run")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )
    await client.patch(
        "/api/v1/company/settings/exchange-rate-sync",
        headers=headers,
        json={
            "enabled": True,
            "rules": [
                {
                    "currency_id": 2,
                    "currency_code": "USD",
                    "formula": "exchange_rate * 1.05",
                    "enabled": True,
                }
            ],
        },
    )

    response = await client.post(
        "/api/v1/company/settings/exchange-rate-sync/run",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["results"][0]["status"] == "updated"
    assert data["results"][0]["calculated_rate"] == pytest.approx(13282.5)

    edit_calls = [
        call
        for call in mock_regos_request.await_args_list
        if call.args[2] == "currency/editexchangerate"
    ]
    assert edit_calls
    payload = edit_calls[0].args[3]
    assert payload["id"] == 2
    assert payload["exchange_rate"] == pytest.approx(13282.5)


@patch("app.services.exchange_rate_sync.regos_async_api_request_for_company", new_callable=AsyncMock)
@patch("app.services.exchange_rate_sync.fetch_currency_items_by_ids", new_callable=AsyncMock)
@patch("app.services.exchange_rate_sync._fetch_base_currency", new_callable=AsyncMock)
@patch("app.services.exchange_rate_sync.fetch_cbu_rates", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_run_exchange_rate_sync_skips_base_currency(
    mock_fetch_cbu: AsyncMock,
    mock_fetch_base: AsyncMock,
    mock_fetch_currencies: AsyncMock,
    mock_regos_request: AsyncMock,
    client: AsyncClient,
) -> None:
    from app.services.cbu_exchange_rates import CbuRate

    mock_fetch_cbu.return_value = {
        "UZS": CbuRate(code="UZS", rate=1.0, nominal=1, rate_date=None),
    }
    mock_fetch_base.return_value = {
        "id": 44,
        "name": "UZS",
        "code_chr": "UZS",
        "exchange_rate": 1,
        "is_base": True,
    }
    mock_fetch_currencies.return_value = {
        44: {
            "id": 44,
            "name": "UZS",
            "code_chr": "UZS",
            "exchange_rate": 1,
            "is_base": True,
            "deleted": False,
        }
    }

    reg = await register_owner(client, email="fx-base@test.com", company_name="FX Base")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )
    await client.patch(
        "/api/v1/company/settings/exchange-rate-sync",
        headers=headers,
        json={
            "enabled": True,
            "rules": [
                {
                    "currency_id": 44,
                    "currency_code": "UZS",
                    "formula": "exchange_rate",
                    "enabled": True,
                }
            ],
        },
    )

    response = await client.post(
        "/api/v1/company/settings/exchange-rate-sync/run",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "skipped"
    edit_calls = [
        call
        for call in mock_regos_request.await_args_list
        if len(call.args) > 2 and call.args[2] == "currency/editexchangerate"
    ]
    assert not edit_calls


@patch("app.services.exchange_rate_sync.regos_async_api_request_for_company", new_callable=AsyncMock)
@patch("app.services.exchange_rate_sync.fetch_currency_items_by_ids", new_callable=AsyncMock)
@patch("app.services.exchange_rate_sync._fetch_base_currency", new_callable=AsyncMock)
@patch("app.services.exchange_rate_sync.fetch_cbu_rates", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_run_exchange_rate_sync_skips_unchanged_rate(
    mock_fetch_cbu: AsyncMock,
    mock_fetch_base: AsyncMock,
    mock_fetch_currencies: AsyncMock,
    mock_regos_request: AsyncMock,
    client: AsyncClient,
) -> None:
    from app.services.cbu_exchange_rates import CbuRate

    mock_fetch_cbu.return_value = {
        "USD": CbuRate(code="USD", rate=12650.0, nominal=1, rate_date=None),
    }
    mock_fetch_base.return_value = {
        "id": 44,
        "name": "UZS",
        "code_chr": "UZS",
        "exchange_rate": 1,
        "is_base": True,
    }
    calculated_rate = apply_formula("exchange_rate * 1.05", 12650.0)
    mock_fetch_currencies.return_value = {
        2: {
            "id": 2,
            "name": "US Dollar",
            "code_chr": "USD",
            "exchange_rate": calculated_rate,
            "is_base": False,
            "deleted": False,
        }
    }

    reg = await register_owner(client, email="fx-skip@test.com", company_name="FX Skip")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )
    await client.patch(
        "/api/v1/company/settings/exchange-rate-sync",
        headers=headers,
        json={
            "enabled": True,
            "rules": [
                {
                    "currency_id": 2,
                    "currency_code": "USD",
                    "formula": "exchange_rate * 1.05",
                    "enabled": True,
                }
            ],
        },
    )

    response = await client.post(
        "/api/v1/company/settings/exchange-rate-sync/run",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "skipped"
    edit_calls = [
        call
        for call in mock_regos_request.await_args_list
        if len(call.args) > 2 and call.args[2] == "currency/editexchangerate"
    ]
    assert not edit_calls


@patch("app.services.exchange_rate_sync.regos_async_api_request_for_company", new_callable=AsyncMock)
@patch("app.services.exchange_rate_sync.fetch_currency_items_by_ids", new_callable=AsyncMock)
@patch("app.services.exchange_rate_sync._fetch_base_currency", new_callable=AsyncMock)
@patch("app.services.exchange_rate_sync.fetch_cbu_rates", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_run_exchange_rate_sync_allows_immediate_rerun(
    mock_fetch_cbu: AsyncMock,
    mock_fetch_base: AsyncMock,
    mock_fetch_currencies: AsyncMock,
    mock_regos_request: AsyncMock,
    client: AsyncClient,
) -> None:
    from app.services.cbu_exchange_rates import CbuRate

    mock_fetch_cbu.return_value = {
        "USD": CbuRate(code="USD", rate=12650.0, nominal=1, rate_date=None),
    }
    mock_fetch_base.return_value = {
        "id": 44,
        "name": "UZS",
        "code_chr": "UZS",
        "exchange_rate": 1,
        "is_base": True,
    }
    mock_fetch_currencies.return_value = {
        2: {
            "id": 2,
            "name": "US Dollar",
            "code_chr": "USD",
            "exchange_rate": 12000.0,
            "is_base": False,
            "deleted": False,
        }
    }
    mock_regos_request.return_value = {"ok": True, "result": {"row_affected": 1}}

    reg = await register_owner(client, email="fx-rerun@test.com", company_name="FX Rerun")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )
    await client.patch(
        "/api/v1/company/settings/exchange-rate-sync",
        headers=headers,
        json={
            "enabled": True,
            "rules": [
                {
                    "currency_id": 2,
                    "currency_code": "USD",
                    "formula": "exchange_rate * 1.05",
                    "enabled": True,
                }
            ],
        },
    )

    first = await client.post(
        "/api/v1/company/settings/exchange-rate-sync/run",
        headers=headers,
    )
    assert first.status_code == 200

    second = await client.post(
        "/api/v1/company/settings/exchange-rate-sync/run",
        headers=headers,
    )
    assert second.status_code == 200


@pytest.mark.asyncio
async def test_list_sync_enabled_company_ids_skips_disabled(client: AsyncClient) -> None:
    from app import database
    from app.services.exchange_rate_sync import _list_sync_enabled_company_ids

    reg = await register_owner(client, email="fx-sched@test.com", company_name="FX Sched")
    token = reg.json()["access_token"]
    company_id = reg.json()["user"]["company_id"]
    headers = {"Authorization": f"Bearer {token}"}

    async with database.async_session_factory() as session:
        ids = await _list_sync_enabled_company_ids(session)
        assert company_id not in ids

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )
    await client.patch(
        "/api/v1/company/settings/exchange-rate-sync",
        headers=headers,
        json={"enabled": True, "rules": []},
    )

    async with database.async_session_factory() as session:
        ids_enabled = await _list_sync_enabled_company_ids(session)
        assert company_id in ids_enabled
