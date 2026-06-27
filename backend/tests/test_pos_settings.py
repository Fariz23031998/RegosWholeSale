import pytest
from httpx import AsyncClient

from helpers import register_owner


@pytest.mark.asyncio
async def test_patch_and_get_pos_settings(client: AsyncClient) -> None:
    reg = await register_owner(client, email="pos-settings@test.com", company_name="POS Settings Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    initial = await client.get("/api/v1/company/settings/pos", headers=headers)
    assert initial.status_code == 200
    assert initial.json()["settings"]["allow_out_of_stock"] is False
    assert initial.json()["settings"]["auto_open_qty_keypad"] is False
    assert initial.json()["settings"]["cross_currency_payment_mode"] == "payment_currency"
    assert initial.json()["settings"]["tendered_quick_amounts"] == [20.0, 50.0, 100.0]
    assert initial.json()["settings"]["internal_barcode_weight_prefix"] == "22"
    assert initial.json()["settings"]["internal_barcode_piece_prefix"] == "23"
    assert initial.json()["settings"]["postpone_document_type"] == "doc_wholesale"
    assert initial.json()["settings"]["postpone_order_booked"] is True
    assert initial.json()["settings"]["default_category"] == {
        "mode": "all",
        "group_id": None,
    }

    patched = await client.patch(
        "/api/v1/company/settings/pos",
        headers=headers,
        json={
            "allow_out_of_stock": True,
            "tendered_quick_amounts": [10000, 50000, 200000],
            "cross_currency_payment_mode": "sale_currency_transfer",
            "default_category": {"mode": "featured", "group_id": None},
        },
    )
    assert patched.status_code == 200
    assert patched.json()["settings"]["allow_out_of_stock"] is True
    assert patched.json()["settings"]["cross_currency_payment_mode"] == "sale_currency_transfer"
    assert patched.json()["settings"]["default_category"]["mode"] == "featured"
    assert patched.json()["settings"]["tendered_quick_amounts"] == [
        10000.0,
        50000.0,
        200000.0,
    ]

    fetched = await client.get("/api/v1/company/settings/pos", headers=headers)
    assert fetched.json()["settings"]["allow_out_of_stock"] is True
    assert fetched.json()["settings"]["tendered_quick_amounts"] == [
        10000.0,
        50000.0,
        200000.0,
    ]


@pytest.mark.asyncio
async def test_internal_barcode_prefix_settings(client: AsyncClient) -> None:
    reg = await register_owner(
        client,
        email="pos-barcode@test.com",
        company_name="POS Barcode Co",
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    patched = await client.patch(
        "/api/v1/company/settings/pos",
        headers=headers,
        json={
            "internal_barcode_weight_prefix": "55",
            "internal_barcode_piece_prefix": "66",
        },
    )
    assert patched.status_code == 200
    assert patched.json()["settings"]["internal_barcode_weight_prefix"] == "55"
    assert patched.json()["settings"]["internal_barcode_piece_prefix"] == "66"

    effective = await client.get("/api/v1/me/settings/pos", headers=headers)
    assert effective.status_code == 200
    assert effective.json()["settings"]["internal_barcode_weight_prefix"] == "55"
    assert effective.json()["settings"]["internal_barcode_piece_prefix"] == "66"

    sanitized = await client.patch(
        "/api/v1/company/settings/pos",
        headers=headers,
        json={"internal_barcode_weight_prefix": "abc99"},
    )
    assert sanitized.status_code == 200
    assert sanitized.json()["settings"]["internal_barcode_weight_prefix"] == "99"


@pytest.mark.asyncio
async def test_employee_can_read_but_not_update_pos_settings(client: AsyncClient) -> None:
    reg = await register_owner(client, email="pos-emp@test.com", company_name="POS Emp Co")
    owner_token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {owner_token}"}

    await client.patch(
        "/api/v1/company/settings/pos",
        headers=headers,
        json={"allow_out_of_stock": True},
    )

    await client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "login": "cashier",
            "password": "employee123",
            "display_name": "Cashier",
            "role": "employee",
        },
    )

    emp_login = await client.post(
        "/api/v1/auth/login",
        json={"login": "cashier", "password": "employee123"},
    )
    emp_token = emp_login.json()["access_token"]
    emp_headers = {"Authorization": f"Bearer {emp_token}"}

    read = await client.get("/api/v1/company/settings/pos", headers=emp_headers)
    assert read.status_code == 200
    assert read.json()["settings"]["allow_out_of_stock"] is True

    denied = await client.patch(
        "/api/v1/company/settings/pos",
        headers=emp_headers,
        json={"allow_out_of_stock": False},
    )
    assert denied.status_code == 403
