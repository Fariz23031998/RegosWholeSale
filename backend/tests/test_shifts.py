from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from helpers import register_owner


def _checkout_ok() -> dict:
    payment = {
        "payment_type_id": 5,
        "payment_doc_id": None,
        "amount": 10,
        "amount_paid": 10,
        "balance_due": 0,
        "is_fully_paid": True,
    }
    return {
        "wholesale_doc_id": 1,
        "wholesale_code": "WS-1",
        "payment_doc_id": None,
        "performed_at": datetime.now(timezone.utc),
        "lines": [{"regos_item_id": 1, "qty": 1, "price": 10, "price2": 10}],
        "payment": payment,
        "payments": [payment],
        "subtotal": 10,
        "discount": 0,
        "total": 10,
        "amount_paid": 10,
        "balance_due": 0,
        "is_fully_paid": True,
    }


UZS = {"id": 44, "name": "UZS", "code_chr": "UZS", "exchange_rate": 1}
USD = {"id": 55, "name": "USD", "code_chr": "USD", "exchange_rate": 12600}


async def _enable_shifts(client: AsyncClient, headers: dict) -> None:
    res = await client.patch(
        "/api/v1/company/settings/pos",
        headers=headers,
        json={"shift_management_enabled": True},
    )
    assert res.status_code == 200
    assert res.json()["settings"]["shift_management_enabled"] is True


def _currency_fetch(*_args, **_kwargs):
    return {44: UZS, 55: USD}


@pytest.mark.asyncio
async def test_shift_management_disabled_by_default(client: AsyncClient) -> None:
    register = await register_owner(client, email="shifts-off@example.com")
    assert register.status_code == 200
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = await client.get("/api/v1/shifts/current", headers=headers)
    assert res.status_code == 403
    assert res.json()["code"] == "SHIFT_MANAGEMENT_DISABLED"


@pytest.mark.asyncio
async def test_open_close_shift_expected_cash_and_ops(client: AsyncClient) -> None:
    register = await register_owner(client, email="shifts-cash@example.com")
    assert register.status_code == 200
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    await _enable_shifts(client, headers)

    defaults = {
        "firm": {"id": 55, "name": "Firm"},
        "attached_user": {"id": 9, "name": "Cashier"},
        "currency": UZS,
    }

    with (
        patch(
            "app.services.shifts.regos_defaults_service.get_regos_defaults",
            AsyncMock(return_value=defaults),
        ),
        patch(
            "app.services.shifts.regos_payment_types_service.list_payment_types",
            AsyncMock(
                return_value={
                    "payment_types": [
                        {"id": 5, "name": "Cash", "is_cash": True},
                        {"id": 6, "name": "Card", "is_cash": False},
                    ]
                }
            ),
        ),
        patch(
            "app.services.shifts.regos_payments_service.list_payments",
            AsyncMock(
                return_value={
                    "documents": [
                        {
                            "id": 1,
                            "payment_type_id": 5,
                            "attached_user_id": 9,
                            "amount": 100,
                            "payment_direction": "income",
                            "exchange_rate": 1,
                            "currency": UZS,
                        },
                        {
                            "id": 2,
                            "payment_type_id": 5,
                            "attached_user_id": 9,
                            "amount": 20,
                            "payment_direction": "outcome",
                            "exchange_rate": 1,
                            "currency": UZS,
                        },
                        {
                            "id": 3,
                            "payment_type_id": 6,
                            "attached_user_id": 9,
                            "amount": 50,
                            "payment_direction": "income",
                            "exchange_rate": 1,
                            "currency": UZS,
                        },
                    ],
                    "total": 3,
                    "next_offset": 0,
                }
            ),
        ),
        patch(
            "app.services.shifts.regos_defaults_service.fetch_currency_items_by_ids",
            AsyncMock(side_effect=_currency_fetch),
        ),
    ):
        opened = await client.post(
            "/api/v1/shifts/open",
            headers=headers,
            json={"amounts": [{"currency_id": 44, "amount": "50.00"}]},
        )
        assert opened.status_code == 200, opened.text
        shift = opened.json()
        assert shift["status"] == "open"
        assert len(shift["currency_amounts"]) == 1
        assert Decimal(str(shift["currency_amounts"][0]["start_amount"])) == Decimal("50.00")
        assert shift["currency_amounts"][0]["currency_code"] == "UZS"
        assert shift["firm_id"] == 55
        assert shift["attached_user_id"] == 9

        op = await client.post(
            f"/api/v1/shifts/{shift['id']}/operations",
            headers=headers,
            json={
                "operation_type": "cash_out",
                "amount": "10.00",
                "currency_id": 44,
                "note": "float",
            },
        )
        assert op.status_code == 200, op.text
        assert len(op.json()["operations"]) == 1
        assert op.json()["operations"][0]["currency_id"] == 44

        current = await client.get("/api/v1/shifts/current", headers=headers)
        assert current.status_code == 200
        preview = current.json()["expected_preview"]
        assert preview["docs_count"] == 2
        assert len(preview["by_currency"]) == 1
        uzs_row = preview["by_currency"][0]
        # start 50 + cash docs (100-20) + ops (-10) = 120
        assert Decimal(str(uzs_row["cash_from_docs"])) == Decimal("80")
        assert Decimal(str(uzs_row["ops_net"])) == Decimal("-10")
        assert Decimal(str(uzs_row["expected_amount"])) == Decimal("120")

        closed = await client.post(
            f"/api/v1/shifts/{shift['id']}/close",
            headers=headers,
            json={"amounts": [{"currency_id": 44, "amount": "115.00"}]},
        )
        assert closed.status_code == 200, closed.text
        body = closed.json()
        assert body["status"] == "closed"
        amount = body["currency_amounts"][0]
        assert Decimal(str(amount["expected_amount"])) == Decimal("120")
        assert Decimal(str(amount["actual_amount"])) == Decimal("115")
        assert Decimal(str(amount["difference_amount"])) == Decimal("-5")
        assert Decimal(str(amount["outstanding_debt"])) == Decimal("5")


@pytest.mark.asyncio
async def test_shift_multi_currency_native_aggregation(client: AsyncClient) -> None:
    register = await register_owner(client, email="shifts-multi@example.com")
    assert register.status_code == 200
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    await _enable_shifts(client, headers)

    defaults = {
        "firm": {"id": 1, "name": "Firm"},
        "attached_user": {"id": 9, "name": "Cashier"},
        "currency": UZS,
    }

    with (
        patch(
            "app.services.shifts.regos_defaults_service.get_regos_defaults",
            AsyncMock(return_value=defaults),
        ),
        patch(
            "app.services.shifts.regos_payment_types_service.list_payment_types",
            AsyncMock(
                return_value={
                    "payment_types": [
                        {"id": 5, "name": "Cash UZS", "is_cash": True, "currency": UZS},
                        {"id": 7, "name": "Cash USD", "is_cash": True, "currency": USD},
                    ]
                }
            ),
        ),
        patch(
            "app.services.shifts.regos_payments_service.list_payments",
            AsyncMock(
                return_value={
                    "documents": [
                        {
                            "id": 1,
                            "payment_type_id": 5,
                            "attached_user_id": 9,
                            "amount": 200,
                            "payment_direction": "income",
                            "exchange_rate": 1,
                            "currency": UZS,
                        },
                        {
                            "id": 2,
                            "payment_type_id": 7,
                            "attached_user_id": 9,
                            "amount": 10,
                            "payment_direction": "income",
                            "exchange_rate": 12600,
                            "currency": USD,
                        },
                    ],
                    "total": 2,
                    "next_offset": 0,
                }
            ),
        ),
        patch(
            "app.services.shifts.regos_defaults_service.fetch_currency_items_by_ids",
            AsyncMock(side_effect=_currency_fetch),
        ),
    ):
        opened = await client.post(
            "/api/v1/shifts/open",
            headers=headers,
            json={
                "amounts": [
                    {"currency_id": 44, "amount": "100"},
                    {"currency_id": 55, "amount": "5"},
                ]
            },
        )
        assert opened.status_code == 200, opened.text
        shift = opened.json()
        assert len(shift["currency_amounts"]) == 2

        op = await client.post(
            f"/api/v1/shifts/{shift['id']}/operations",
            headers=headers,
            json={
                "operation_type": "cash_out",
                "amount": "2",
                "currency_id": 55,
            },
        )
        assert op.status_code == 200, op.text

        current = await client.get("/api/v1/shifts/current", headers=headers)
        assert current.status_code == 200
        by_currency = {
            row["currency_id"]: row for row in current.json()["expected_preview"]["by_currency"]
        }
        # Native amounts — USD must NOT be converted into UZS.
        assert Decimal(str(by_currency[44]["expected_amount"])) == Decimal("300")
        assert Decimal(str(by_currency[55]["cash_from_docs"])) == Decimal("10")
        assert Decimal(str(by_currency[55]["ops_net"])) == Decimal("-2")
        assert Decimal(str(by_currency[55]["expected_amount"])) == Decimal("13")

        missing = await client.post(
            f"/api/v1/shifts/{shift['id']}/close",
            headers=headers,
            json={"amounts": [{"currency_id": 44, "amount": "300"}]},
        )
        assert missing.status_code == 400
        assert missing.json()["code"] == "SHIFT_MISSING_CURRENCY_AMOUNT"

        closed = await client.post(
            f"/api/v1/shifts/{shift['id']}/close",
            headers=headers,
            json={
                "amounts": [
                    {"currency_id": 44, "amount": "295"},
                    {"currency_id": 55, "amount": "13"},
                ]
            },
        )
        assert closed.status_code == 200, closed.text
        amounts = {
            row["currency_id"]: row for row in closed.json()["currency_amounts"]
        }
        assert Decimal(str(amounts[44]["difference_amount"])) == Decimal("-5")
        assert Decimal(str(amounts[44]["outstanding_debt"])) == Decimal("5")
        assert Decimal(str(amounts[55]["difference_amount"])) == Decimal("0")
        assert Decimal(str(amounts[55]["outstanding_debt"])) == Decimal("0")

        debt = await client.get(
            f"/api/v1/shifts/employees/{register.json()['user']['id']}/debt",
            headers=headers,
        )
        assert debt.status_code == 200
        debt_rows = {
            row["currency_id"]: row
            for row in debt.json()["outstanding_debt_by_currency"]
        }
        assert Decimal(str(debt_rows[44]["amount"])) == Decimal("5")
        assert 55 not in debt_rows


@pytest.mark.asyncio
async def test_checkout_requires_open_shift_when_enabled(client: AsyncClient) -> None:
    register = await register_owner(client, email="shifts-gate@example.com")
    assert register.status_code == 200
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    await _enable_shifts(client, headers)

    blocked = await client.post(
        "/api/v1/sales/checkout",
        headers=headers,
        json={
            "items": [{"regos_item_id": 1, "qty": 1, "price": 10}],
            "total": 10,
            "payment_type_id": 5,
            "amount_paid": 10,
        },
    )
    assert blocked.status_code == 403
    assert blocked.json()["code"] == "SHIFT_REQUIRED"

    with (
        patch(
            "app.services.shifts.regos_defaults_service.get_regos_defaults",
            AsyncMock(
                return_value={
                    "firm": {"id": 1},
                    "attached_user": {"id": 2},
                    "currency": UZS,
                }
            ),
        ),
        patch(
            "app.services.shifts.regos_defaults_service.fetch_currency_items_by_ids",
            AsyncMock(side_effect=_currency_fetch),
        ),
    ):
        opened = await client.post(
            "/api/v1/shifts/open",
            headers=headers,
            json={"amounts": [{"currency_id": 44, "amount": 0}]},
        )
        assert opened.status_code == 200

    with patch(
        "app.api.v1.sales.regos_sales_service.complete_checkout",
        AsyncMock(return_value=_checkout_ok()),
    ) as mocked:
        ok = await client.post(
            "/api/v1/sales/checkout",
            headers=headers,
            json={
                "items": [{"regos_item_id": 1, "qty": 1, "price": 10}],
                "total": 10,
                "payment_type_id": 5,
                "amount_paid": 10,
            },
        )
        assert ok.status_code == 200, ok.text
        mocked.assert_awaited_once()


@pytest.mark.asyncio
async def test_checkout_unrestricted_when_shifts_disabled(client: AsyncClient) -> None:
    register = await register_owner(client, email="shifts-nogate@example.com")
    assert register.status_code == 200
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    with patch(
        "app.api.v1.sales.regos_sales_service.complete_checkout",
        AsyncMock(return_value=_checkout_ok()),
    ) as mocked:
        ok = await client.post(
            "/api/v1/sales/checkout",
            headers=headers,
            json={
                "items": [{"regos_item_id": 1, "qty": 1, "price": 10}],
                "total": 10,
                "payment_type_id": 5,
                "amount_paid": 10,
            },
        )
        assert ok.status_code == 200, ok.text
        mocked.assert_awaited_once()


@pytest.mark.asyncio
async def test_employee_cannot_manage_other_shifts(client: AsyncClient) -> None:
    owner = await register_owner(client, email="shifts-owner@example.com")
    assert owner.status_code == 200
    owner_token = owner.json()["access_token"]
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    await _enable_shifts(client, owner_headers)

    create_emp = await client.post(
        "/api/v1/users",
        headers=owner_headers,
        json={
            "login": "cashier1",
            "password": "password123",
            "display_name": "Cashier One",
            "role": "employee",
        },
    )
    assert create_emp.status_code in {200, 201}, create_emp.text

    users = await client.get("/api/v1/users", headers=owner_headers)
    emp_id = next(u["id"] for u in users.json() if u["login"] == "cashier1")

    login = await client.post(
        "/api/v1/auth/login",
        json={"login": "cashier1", "password": "password123"},
    )
    assert login.status_code == 200, login.text
    emp_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    with (
        patch(
            "app.services.shifts.regos_defaults_service.get_regos_defaults",
            AsyncMock(
                return_value={
                    "firm": {"id": 1},
                    "attached_user": {"id": 2},
                    "currency": UZS,
                }
            ),
        ),
        patch(
            "app.services.shifts.regos_defaults_service.fetch_currency_items_by_ids",
            AsyncMock(side_effect=_currency_fetch),
        ),
    ):
        denied = await client.post(
            "/api/v1/shifts/open",
            headers=emp_headers,
            json={
                "amounts": [{"currency_id": 44, "amount": 0}],
                "user_id": owner.json()["user"]["id"],
            },
        )
        assert denied.status_code == 403
        assert denied.json()["code"] == "SHIFT_PERMISSION_DENIED"

        own = await client.post(
            "/api/v1/shifts/open",
            headers=emp_headers,
            json={"amounts": [{"currency_id": 44, "amount": 25}]},
        )
        assert own.status_code == 200, own.text
        assert own.json()["user_id"] == emp_id
