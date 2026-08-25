from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from helpers import register_owner

FULL_DEFAULTS = {
    "warehouse": {"id": 11, "name": "Main warehouse"},
    "price_type": {"id": 22, "name": "Retail"},
    "partner": {"id": 33, "name": "Walk-in"},
    "payment_category": {"id": 66, "name": "Sales"},
    "firm": {"id": 55, "name": "Main firm"},
    "currency": {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1},
}

PAYMENT_TYPE_UZS = {
    "id": 5,
    "name": "Cash",
    "is_cash": True,
    "allows_debt": False,
    "image_url": "",
    "account_id": 101,
    "currency": {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1},
}

PAYMENT_TYPE_USD = {
    "id": 6,
    "name": "Dollars",
    "is_cash": True,
    "allows_debt": False,
    "image_url": "",
    "account_id": 102,
    "currency": {"id": 2, "name": "US Dollar", "code_chr": "USD", "exchange_rate": 12600},
}


@patch(
    "app.services.regos_partner_pay_debt.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_partner_pay_debt.pos_settings_service.get_pos_settings",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_partner_pay_debt.regos_defaults_service.enrich_checkout_defaults",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_partner_pay_debt.regos_defaults_service.apply_regos_session_overrides",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_partner_pay_debt._regos_call",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_partner_pay_debt._add_payment_document",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_pay_partner_debt_creates_and_performs_docpayment(
    mock_add_payment: AsyncMock,
    mock_regos_call: AsyncMock,
    mock_overrides: AsyncMock,
    mock_enrich: AsyncMock,
    mock_pos: AsyncMock,
    mock_payment_type: AsyncMock,
    client: AsyncClient,
):
    register = await register_owner(client, email="paydebt@example.com")
    assert register.status_code == 200
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    mock_overrides.return_value = dict(FULL_DEFAULTS)
    mock_enrich.return_value = dict(FULL_DEFAULTS)
    mock_pos.return_value = {"cross_currency_payment_mode": "payment_currency"}
    mock_payment_type.return_value = PAYMENT_TYPE_UZS
    mock_add_payment.return_value = {"id": 9001, "code": "PD-1"}
    mock_regos_call.return_value = {"ok": True, "result": {"row_affected": 1}}

    response = await client.post(
        "/api/v1/regos/partners/99/pay-debt",
        headers=headers,
        json={
            "firm_id": 55,
            "payments": [
                {
                    "currency_id": 44,
                    "amount": 1250000,
                    "payment_type_id": 5,
                    "exchange_rate": 1,
                    "currency_name": "UZS",
                    "currency_code": "UZS",
                }
            ],
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["payment_doc_ids"] == [9001]
    assert data["payments"][0]["payment_doc_id"] == 9001
    assert data["payments"][0]["amount"] == 1250000
    assert data["payments"][0]["currency_id"] == 44

    mock_overrides.assert_awaited()
    assert mock_overrides.await_args.kwargs["partner_id"] == 99

    add_kwargs = mock_add_payment.await_args.kwargs
    assert add_kwargs["source_document_id"] is None
    assert add_kwargs["document_type_id"] is None
    assert add_kwargs["payment_type_id"] == 5
    assert add_kwargs["amount"] == 1250000
    assert add_kwargs["category_id"] == 66
    assert "Partner debt" in add_kwargs["description"]

    defaults_arg = mock_add_payment.await_args.args[2]
    assert defaults_arg["partner"]["id"] == 99
    assert defaults_arg["firm"]["id"] == 55

    mock_regos_call.assert_awaited()
    assert mock_regos_call.await_args.args[2] == "docpayment/perform"
    assert mock_regos_call.await_args.args[3] == {"id": 9001}


@patch(
    "app.services.regos_partner_pay_debt.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_partner_pay_debt.pos_settings_service.get_pos_settings",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_partner_pay_debt.regos_defaults_service.enrich_checkout_defaults",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_partner_pay_debt.regos_defaults_service.apply_regos_session_overrides",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_partner_pay_debt._regos_call",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_partner_pay_debt._add_payment_document",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_pay_partner_debt_multi_currency_lines(
    mock_add_payment: AsyncMock,
    mock_regos_call: AsyncMock,
    mock_overrides: AsyncMock,
    mock_enrich: AsyncMock,
    mock_pos: AsyncMock,
    mock_payment_type: AsyncMock,
    client: AsyncClient,
):
    register = await register_owner(client, email="paydebt2@example.com")
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    mock_overrides.return_value = dict(FULL_DEFAULTS)
    mock_enrich.return_value = dict(FULL_DEFAULTS)
    mock_pos.return_value = {"cross_currency_payment_mode": "payment_currency"}
    mock_payment_type.side_effect = [PAYMENT_TYPE_UZS, PAYMENT_TYPE_USD]
    mock_add_payment.side_effect = [
        {"id": 9001, "code": "PD-1"},
        {"id": 9002, "code": "PD-2"},
    ]
    mock_regos_call.return_value = {"ok": True, "result": {"row_affected": 1}}

    response = await client.post(
        "/api/v1/regos/partners/42/pay-debt",
        headers=headers,
        json={
            "firm_id": 55,
            "payments": [
                {
                    "currency_id": 44,
                    "amount": 100,
                    "payment_type_id": 5,
                    "exchange_rate": 1,
                },
                {
                    "currency_id": 2,
                    "amount": 50,
                    "payment_type_id": 6,
                    "exchange_rate": 12600,
                },
            ],
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["payment_doc_ids"] == [9001, 9002]
    assert len(data["payments"]) == 2
    assert mock_add_payment.await_count == 2
    assert mock_regos_call.await_count == 2


@pytest.mark.asyncio
async def test_pay_partner_debt_rejects_empty_payments(client: AsyncClient):
    register = await register_owner(client, email="paydebt3@example.com")
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.post(
        "/api/v1/regos/partners/42/pay-debt",
        headers=headers,
        json={"firm_id": 55, "payments": []},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_pay_partner_debt_rejects_zero_amount(client: AsyncClient):
    register = await register_owner(client, email="paydebt4@example.com")
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.post(
        "/api/v1/regos/partners/42/pay-debt",
        headers=headers,
        json={
            "firm_id": 55,
            "payments": [
                {"currency_id": 44, "amount": 0, "payment_type_id": 5},
            ],
        },
    )
    assert response.status_code == 422
