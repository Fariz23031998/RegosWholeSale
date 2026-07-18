from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from helpers import register_owner

FULL_DEFAULTS = {
    "warehouse": {"id": 11, "name": "Main warehouse"},
    "price_type": {"id": 22, "name": "Retail"},
    "partner": {"id": 33, "name": "Walk-in"},
    "payment_category": {"id": 66, "name": "Sales"},
    "refund_payment_category": {"id": 77, "name": "Refunds"},
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

PAYMENT_DOC = {
    "id": 9001,
    "code": "PAY-1",
    "date": 1700000000,
    "amount": 1000,
    "category": {"id": 66, "name": "Sales", "positive": True},
    "type": {"id": 5, "name": "Cash"},
    "partner": {"id": 99, "name": "Customer"},
    "firm": {"id": 55, "name": "Main firm"},
    "exchange_rate": 1,
    "description": "Test payment",
    "performed": True,
    "deleted_mark": False,
}


@patch(
    "app.services.regos_payments.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_payments.pos_settings_service.get_pos_settings",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_payments.regos_defaults_service.enrich_checkout_defaults",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_payments.regos_defaults_service.apply_regos_session_overrides",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_payments._regos_call",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_payments._add_payment_document",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_create_payment_adds_and_performs(
    mock_add_payment: AsyncMock,
    mock_regos_call: AsyncMock,
    mock_overrides: AsyncMock,
    mock_enrich: AsyncMock,
    mock_pos: AsyncMock,
    mock_payment_type: AsyncMock,
    client: AsyncClient,
):
    register = await register_owner(client, email="payments-create@example.com")
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    mock_overrides.return_value = dict(FULL_DEFAULTS)
    mock_enrich.return_value = dict(FULL_DEFAULTS)
    mock_pos.return_value = {"cross_currency_payment_mode": "payment_currency"}
    mock_payment_type.return_value = PAYMENT_TYPE_UZS
    mock_add_payment.return_value = {"id": 9001, "code": "PAY-1"}
    mock_regos_call.side_effect = [
        {"ok": True, "result": {"row_affected": 1}},
        {"ok": True, "result": [PAYMENT_DOC], "next_offset": 0, "total": 1},
    ]

    response = await client.post(
        "/api/v1/payments",
        headers=headers,
        json={
            "firm_id": 55,
            "partner_id": 99,
            "direction": "income",
            "payment_type_id": 5,
            "amount": 1000,
            "exchange_rate": 1,
            "description": "Test payment",
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["id"] == 9001
    assert data["code"] == "PAY-1"
    assert data["performed"] is True
    assert data["payment_direction"] == "income"

    add_kwargs = mock_add_payment.await_args.kwargs
    assert add_kwargs["payment_type_id"] == 5
    assert add_kwargs["amount"] == 1000
    assert add_kwargs["category_id"] == 66
    assert add_kwargs["description"] == "Test payment"

    assert mock_regos_call.await_args_list[0].args[2] == "docpayment/perform"
    assert mock_regos_call.await_args_list[0].args[3] == {"id": 9001}


@patch(
    "app.services.regos_payments.regos_payment_types_service.get_payment_type_by_id",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_payments.pos_settings_service.get_pos_settings",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_payments.regos_defaults_service.enrich_checkout_defaults",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_payments.regos_defaults_service.apply_regos_session_overrides",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_payments._regos_call",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_payments._add_payment_document",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_create_outcome_uses_refund_category(
    mock_add_payment: AsyncMock,
    mock_regos_call: AsyncMock,
    mock_overrides: AsyncMock,
    mock_enrich: AsyncMock,
    mock_pos: AsyncMock,
    mock_payment_type: AsyncMock,
    client: AsyncClient,
):
    register = await register_owner(client, email="payments-outcome@example.com")
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    mock_overrides.return_value = dict(FULL_DEFAULTS)
    mock_enrich.return_value = dict(FULL_DEFAULTS)
    mock_pos.return_value = {"cross_currency_payment_mode": "payment_currency"}
    mock_payment_type.return_value = PAYMENT_TYPE_UZS
    mock_add_payment.return_value = {"id": 9002, "code": "PAY-2"}
    outcome_doc = {
        **PAYMENT_DOC,
        "id": 9002,
        "code": "PAY-2",
        "category": {"id": 77, "name": "Refunds", "positive": False},
    }
    mock_regos_call.side_effect = [
        {"ok": True, "result": {"row_affected": 1}},
        {"ok": True, "result": [outcome_doc], "next_offset": 0, "total": 1},
    ]

    response = await client.post(
        "/api/v1/payments",
        headers=headers,
        json={
            "firm_id": 55,
            "partner_id": 99,
            "direction": "outcome",
            "payment_type_id": 5,
            "amount": 250,
        },
    )
    assert response.status_code == 200, response.text
    assert mock_add_payment.await_args.kwargs["category_id"] == 77
    assert response.json()["payment_direction"] == "outcome"


@patch(
    "app.services.regos_payments.regos_defaults_service.get_regos_defaults",
    new_callable=AsyncMock,
)
@patch(
    "app.services.regos_payments._regos_call",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_list_payments_passes_filters(
    mock_regos_call: AsyncMock,
    mock_defaults: AsyncMock,
    client: AsyncClient,
):
    register = await register_owner(client, email="payments-list@example.com")
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    mock_defaults.return_value = dict(FULL_DEFAULTS)
    mock_regos_call.return_value = {
        "ok": True,
        "result": [PAYMENT_DOC],
        "next_offset": 1,
        "total": 1,
    }

    response = await client.get(
        "/api/v1/payments",
        headers=headers,
        params={
            "start_date": 100,
            "end_date": 200,
            "partner_ids": [99],
            "all_partners": False,
            "firm_ids": [55],
            "direction": "income",
            "performed": True,
            "deleted_mark": False,
            "search": "PAY",
            "limit": 20,
            "offset": 0,
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total"] == 1
    assert data["documents"][0]["id"] == 9001

    payload = mock_regos_call.await_args.args[3]
    assert mock_regos_call.await_args.args[2] == "docpayment/get"
    assert payload["payment_direction"] == "Income"
    assert payload["partner_ids"] == [99]
    assert payload["firm_ids"] == [55]
    assert payload["performed"] is True
    assert payload["deleted_mark"] is False
    assert payload["search"] == "PAY"
    assert payload["start_date"] == 100
    assert payload["end_date"] == 200


@patch(
    "app.services.regos_payments._regos_call",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_perform_cancel_and_delete_lifecycle(
    mock_regos_call: AsyncMock,
    client: AsyncClient,
):
    register = await register_owner(client, email="payments-lifecycle@example.com")
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    mock_regos_call.return_value = {"ok": True, "result": {"row_affected": 1}}

    cancel = await client.post("/api/v1/payments/9001/perform-cancel", headers=headers)
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["row_affected"] == 1
    assert mock_regos_call.await_args.args[2] == "docpayment/performcancel"

    mark = await client.post("/api/v1/payments/9001/delete-mark", headers=headers)
    assert mark.status_code == 200, mark.text
    assert mock_regos_call.await_args.args[2] == "docpayment/deletemark"

    marked_doc = {**PAYMENT_DOC, "deleted_mark": True, "performed": False}
    mock_regos_call.side_effect = [
        {"ok": True, "result": [marked_doc], "next_offset": 0, "total": 1},
        {"ok": True, "result": {"row_affected": 1}},
    ]
    delete = await client.delete("/api/v1/payments/9001", headers=headers)
    assert delete.status_code == 200, delete.text
    assert delete.json()["row_affected"] == 1
    assert mock_regos_call.await_args_list[-1].args[2] == "docpayment/delete"


@patch(
    "app.services.regos_payments._regos_call",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_edit_rejected_when_performed(
    mock_regos_call: AsyncMock,
    client: AsyncClient,
):
    register = await register_owner(client, email="payments-edit@example.com")
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    mock_regos_call.return_value = {
        "ok": True,
        "result": [PAYMENT_DOC],
        "next_offset": 0,
        "total": 1,
    }

    response = await client.patch(
        "/api/v1/payments/9001",
        headers=headers,
        json={"amount": 1500},
    )
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Cannot edit a performed payment document."
    assert mock_regos_call.await_count == 1
    assert mock_regos_call.await_args.args[2] == "docpayment/get"


@patch(
    "app.services.regos_payments._regos_call",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_edit_allowed_when_unperformed(
    mock_regos_call: AsyncMock,
    client: AsyncClient,
):
    register = await register_owner(client, email="payments-edit-ok@example.com")
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    draft = {**PAYMENT_DOC, "performed": False}
    updated = {**draft, "amount": 1500}
    mock_regos_call.side_effect = [
        {"ok": True, "result": [draft], "next_offset": 0, "total": 1},
        {"ok": True, "result": {"row_affected": 1}},
        {"ok": True, "result": [updated], "next_offset": 0, "total": 1},
    ]

    response = await client.patch(
        "/api/v1/payments/9001",
        headers=headers,
        json={"amount": 1500, "description": "Updated"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["amount"] == 1500
    assert mock_regos_call.await_args_list[1].args[2] == "docpayment/edit"


@pytest.mark.asyncio
async def test_create_payment_rejects_invalid_amount(client: AsyncClient):
    register = await register_owner(client, email="payments-invalid@example.com")
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.post(
        "/api/v1/payments",
        headers=headers,
        json={
            "firm_id": 55,
            "partner_id": 99,
            "direction": "income",
            "payment_type_id": 5,
            "amount": 0,
        },
    )
    assert response.status_code == 422


async def _create_employee(
    client: AsyncClient,
    owner_token: str,
    *,
    login: str,
    permission_rules: list[dict] | None = None,
) -> dict:
    body: dict = {
        "login": login,
        "password": "password123",
        "display_name": f"Employee {login}",
        "role": "employee",
    }
    if permission_rules is not None:
        body["permission_rules"] = permission_rules
    response = await client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {owner_token}"},
        json=body,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _login_employee(client: AsyncClient, login: str) -> str:
    response = await client.post(
        "/api/v1/auth/login",
        json={"login": login, "password": "password123"},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest.mark.asyncio
async def test_employee_defaults_include_payment_permissions(client: AsyncClient):
    register = await register_owner(client, email="payments-defaults@example.com")
    owner_token = register.json()["access_token"]
    employee = await _create_employee(client, owner_token, login="pay-defaults")
    for code in ("payments.read", "payments.create", "payments.edit", "payments.delete"):
        assert code in employee["permissions"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "denied_code"),
    [
        ("GET", "/api/v1/payments", "payments.read"),
        ("POST", "/api/v1/payments", "payments.create"),
        ("PATCH", "/api/v1/payments/9001", "payments.edit"),
        ("POST", "/api/v1/payments/9001/perform", "payments.edit"),
        ("POST", "/api/v1/payments/9001/perform-cancel", "payments.edit"),
        ("POST", "/api/v1/payments/9001/delete-mark", "payments.delete"),
        ("DELETE", "/api/v1/payments/9001", "payments.delete"),
    ],
)
async def test_payment_endpoints_require_specific_permissions(
    client: AsyncClient,
    method: str,
    path: str,
    denied_code: str,
):
    register = await register_owner(client, email=f"payments-deny-{denied_code}@example.com")
    owner_token = register.json()["access_token"]
    await _create_employee(
        client,
        owner_token,
        login=f"deny-{denied_code.replace('.', '-')}",
        permission_rules=[{"code": denied_code, "effect": "deny"}],
    )
    token = await _login_employee(client, f"deny-{denied_code.replace('.', '-')}")
    headers = {"Authorization": f"Bearer {token}"}

    kwargs: dict = {}
    if method == "POST" and path == "/api/v1/payments":
        kwargs["json"] = {
            "firm_id": 55,
            "partner_id": 99,
            "direction": "income",
            "payment_type_id": 5,
            "amount": 100,
        }
    elif method == "PATCH":
        kwargs["json"] = {"amount": 100}

    response = await client.request(method, path, headers=headers, **kwargs)
    assert response.status_code == 403, response.text
