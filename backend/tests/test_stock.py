from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from helpers import register_owner


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


def _purchase_doc(doc_id: int = 101, stock_id: int = 11) -> dict:
    return {
        "id": doc_id,
        "code": f"P-{doc_id}",
        "date": 1_700_000_000,
        "partner": {"id": 1, "name": "Supplier"},
        "stock": {"id": stock_id, "name": "Main"},
        "performed": False,
        "amount": 1500,
    }


@pytest.mark.asyncio
async def test_list_purchase_documents_requires_permission(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-perm@test.com", company_name="Stock Co")
    token = reg.json()["access_token"]

    with patch(
        "app.services.regos_stock_docs.regos_async_api_request_for_company",
        new_callable=AsyncMock,
    ) as mock_regos:
        mock_regos.return_value = {
            "ok": True,
            "result": [_purchase_doc()],
            "next_offset": 0,
            "total": 1,
        }
        with patch(
            "app.services.regos_defaults.get_regos_defaults",
            new_callable=AsyncMock,
            return_value={"warehouse": {"id": 11, "name": "Main"}},
        ):
            response = await client.get(
                "/api/v1/stock/purchase/documents",
                headers={"Authorization": f"Bearer {token}"},
            )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["documents"][0]["code"] == "P-101"
    assert body["documents"][0]["stock_name"] == "Main"


@pytest.mark.asyncio
async def test_create_inventory_document(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-inv@test.com", company_name="Inv Co")
    token = reg.json()["access_token"]

    with patch(
        "app.services.regos_defaults.get_regos_defaults",
        new_callable=AsyncMock,
        return_value={
            "warehouse": {"id": 11, "name": "Main"},
            "price_type": {"id": 3, "name": "Retail"},
            "attached_user": {"id": 9, "name": "Cashier"},
        },
    ):
        with patch(
            "app.services.regos_stock_docs.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            return_value={"ok": True, "result": {"new_id": 55, "code": "I-55"}},
        ) as mock_regos:
            created = await client.post(
                "/api/v1/stock/inventory/documents",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "stock_id": 11,
                    "date": 1_700_000_000,
                    "price_type_id": 3,
                },
            )

    assert created.status_code == 200, created.text
    body = created.json()
    assert body["id"] == 55
    assert body["code"] == "I-55"
    assert mock_regos.await_args.args[2] == "docinventory/add"
    payload = mock_regos.await_args.args[3]
    assert payload["open_date"] == 1_700_000_000
    assert "date" not in payload
    assert payload["compare_type"] == "open_date"
    assert payload["stock_id"] == 11
    assert payload["price_type_id"] == 3
    assert payload["attached_user_id"] == 9
    assert payload["full"] is False
    assert payload["create_docinout"] is True


@pytest.mark.asyncio
async def test_create_inventory_document_with_compare_type(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-inv-cmp@test.com", company_name="Inv Cmp Co")
    token = reg.json()["access_token"]

    with patch(
        "app.services.regos_defaults.get_regos_defaults",
        new_callable=AsyncMock,
        return_value={
            "warehouse": {"id": 11, "name": "Main"},
            "price_type": {"id": 3, "name": "Retail"},
            "attached_user": {"id": 9, "name": "Cashier"},
        },
    ):
        with patch(
            "app.services.regos_stock_docs.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            return_value={"ok": True, "result": {"new_id": 56, "code": "I-56"}},
        ) as mock_regos:
            created = await client.post(
                "/api/v1/stock/inventory/documents",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "stock_id": 11,
                    "date": 1_700_000_000,
                    "price_type_id": 3,
                    "compare_type": "close_date",
                },
            )

    assert created.status_code == 200, created.text
    payload = mock_regos.await_args.args[3]
    assert payload["compare_type"] == "close_date"


async def test_create_inventory_document_with_flags(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-inv-flags@test.com", company_name="Inv Flags Co")
    token = reg.json()["access_token"]

    with patch(
        "app.services.regos_defaults.get_regos_defaults",
        new_callable=AsyncMock,
        return_value={
            "warehouse": {"id": 11, "name": "Main"},
            "price_type": {"id": 3, "name": "Retail"},
            "attached_user": {"id": 9, "name": "Cashier"},
        },
    ):
        with patch(
            "app.services.regos_stock_docs.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            return_value={"ok": True, "result": {"new_id": 57, "code": "I-57"}},
        ) as mock_regos:
            created = await client.post(
                "/api/v1/stock/inventory/documents",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "stock_id": 11,
                    "date": 1_700_000_000,
                    "price_type_id": 3,
                    "full": True,
                    "create_docinout": False,
                },
            )

    assert created.status_code == 200, created.text
    payload = mock_regos.await_args.args[3]
    assert payload["full"] is True
    assert payload["create_docinout"] is False


@pytest.mark.asyncio
async def test_create_purchase_document_with_price_type_and_vat(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-pur@test.com", company_name="Pur Co")
    token = reg.json()["access_token"]

    with patch(
        "app.services.regos_defaults.get_regos_defaults",
        new_callable=AsyncMock,
        return_value={
            "warehouse": {"id": 11, "name": "Main"},
            "partner": {"id": 1, "name": "Supplier"},
            "currency": {"id": 7, "name": "USD"},
            "price_type": {"id": 3, "name": "Retail"},
        },
    ):
        with patch(
            "app.services.regos_stock_docs.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            return_value={"ok": True, "result": {"new_id": 101, "code": "P-101"}},
        ) as mock_regos:
            created = await client.post(
                "/api/v1/stock/purchase/documents",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "partner_id": 1,
                    "stock_id": 11,
                    "date": 1_700_000_000,
                    "price_type_id": 5,
                    "currency_id": 9,
                    "vat_calculation_type": "Exclude",
                },
            )

    assert created.status_code == 200, created.text
    assert mock_regos.await_args.args[2] == "docpurchase/add"
    payload = mock_regos.await_args.args[3]
    assert payload["price_type_id"] == 5
    assert payload["currency_id"] == 9
    assert payload["vat_calculation_type"] == "Exclude"
    assert payload["date"] == 1_700_000_000


@pytest.mark.asyncio
async def test_create_return_to_partner_document(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-rtp@test.com", company_name="Rtp Co")
    token = reg.json()["access_token"]

    with patch(
        "app.services.regos_defaults.get_regos_defaults",
        new_callable=AsyncMock,
        return_value={
            "warehouse": {"id": 11, "name": "Main"},
            "partner": {"id": 1, "name": "Supplier"},
            "currency": {"id": 7, "name": "USD"},
        },
    ):
        with patch(
            "app.services.regos_stock_docs.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            return_value={"ok": True, "result": {"new_id": 4401, "code": "R-4401"}},
        ) as mock_regos:
            created = await client.post(
                "/api/v1/stock/return_to_partner/documents",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "partner_id": 1,
                    "stock_id": 11,
                    "date": 1_700_000_000,
                    "currency_id": 9,
                    "vat_calculation_type": "Exclude",
                    "price_type_id": 5,
                },
            )

    assert created.status_code == 200, created.text
    assert mock_regos.await_args.args[2] == "docreturnstopartner/add"
    payload = mock_regos.await_args.args[3]
    assert payload["partner_id"] == 1
    assert payload["stock_id"] == 11
    assert payload["currency_id"] == 9
    assert payload["vat_calculation_type"] == "Exclude"
    assert payload["date"] == 1_700_000_000
    assert "price_type_id" not in payload


@pytest.mark.asyncio
async def test_update_purchase_document(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-edit@test.com", company_name="Edit Co")
    token = reg.json()["access_token"]

    calls: list[tuple[str, dict]] = []

    async def _regos(_session, _company_id, endpoint, payload):
        calls.append((endpoint, payload))
        if endpoint == "docpurchase/get":
            return {"ok": True, "result": [_purchase_doc()]}
        if endpoint in {"docpurchase/lock", "docpurchase/unlock", "docpurchase/edit"}:
            return {"ok": True, "result": {"row_affected": 1}}
        raise AssertionError(f"Unexpected endpoint {endpoint}")

    with patch(
        "app.services.regos_defaults.get_regos_defaults",
        new_callable=AsyncMock,
        return_value={"warehouse": {"id": 11, "name": "Main"}},
    ):
        with patch(
            "app.services.regos_stock_docs.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            side_effect=_regos,
        ):
            response = await client.patch(
                "/api/v1/stock/purchase/documents/101",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "date": 1_700_000_100,
                    "price_type_id": 5,
                    "currency_id": 9,
                    "vat_calculation_type": "Include",
                },
            )

    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True
    endpoints = [c[0] for c in calls]
    assert "docpurchase/lock" in endpoints
    assert "docpurchase/edit" in endpoints
    assert "docpurchase/unlock" in endpoints
    edit_payload = next(p for e, p in calls if e == "docpurchase/edit")
    assert edit_payload["id"] == 101
    assert edit_payload["date"] == 1_700_000_100
    assert edit_payload["price_type_id"] == 5
    assert edit_payload["currency_id"] == 9
    assert edit_payload["vat_calculation_type"] == "Include"


@pytest.mark.asyncio
async def test_item_info_search(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-item@test.com", company_name="Item Co")
    token = reg.json()["access_token"]

    with patch(
        "app.services.regos_stock_docs.regos_async_api_request_for_company",
        new_callable=AsyncMock,
    ) as mock_regos:
        mock_regos.return_value = {
            "ok": True,
            "result": [
                {
                    "item": {
                        "id": 55,
                        "name": "Milk",
                        "code": "M1",
                        "base_barcode": "460000",
                        "unit": {"name": "pcs", "type": "pcs"},
                        "vat": {"value": 12},
                    },
                    "quantity": {"common": 3},
                    "price": 100,
                    "last_purchase_cost": 80,
                }
            ],
        }
        response = await client.get(
            "/api/v1/stock/item-info",
            params={"search": "460000"},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == 55
    assert items[0]["barcode"] == "460000"


@pytest.mark.asyncio
async def test_add_purchase_operation(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-add-op@test.com", company_name="Add Op Co")
    token = reg.json()["access_token"]

    async def _regos(_session, _company_id, endpoint, payload):
        if endpoint == "docpurchase/get":
            return {"ok": True, "result": [_purchase_doc()]}
        if endpoint == "purchaseoperation/add":
            return {"ok": True, "result": {"row_affected": 1}}
        raise AssertionError(f"Unexpected endpoint: {endpoint}")

    with patch(
        "app.services.regos_stock_docs.regos_async_api_request_for_company",
        new_callable=AsyncMock,
        side_effect=_regos,
    ) as mock_regos:
        response = await client.post(
            "/api/v1/stock/purchase/operations",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "operations": [
                    {
                        "document_id": 101,
                        "item_id": 55,
                        "quantity": 2,
                        "cost": 80,
                        "price": 100,
                        "vat_value": 12,
                    }
                ]
            },
        )

    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True
    add_calls = [c for c in mock_regos.await_args_list if c.args[2] == "purchaseoperation/add"]
    assert len(add_calls) == 1
    payload = add_calls[0].args[3]
    assert isinstance(payload, list) and len(payload) == 1
    assert payload[0]["document_id"] == 101
    assert payload[0]["item_id"] == 55
    assert payload[0]["quantity"] == 2.0
    assert payload[0]["cost"] == 80.0
    assert payload[0]["vat_value"] == 12.0
    assert payload[0]["price"] == 100.0


@pytest.mark.asyncio
async def test_edit_and_delete_operations(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-edit-op@test.com", company_name="Edit Op Co")
    token = reg.json()["access_token"]

    async def _regos(_session, _company_id, endpoint, payload):
        if endpoint == "purchaseoperation/edit":
            return {"ok": True, "result": {"row_affected": 1}}
        if endpoint == "purchaseoperation/delete":
            return {"ok": True, "result": {"row_affected": 1}}
        raise AssertionError(f"Unexpected endpoint: {endpoint}")

    with patch(
        "app.services.regos_stock_docs.regos_async_api_request_for_company",
        new_callable=AsyncMock,
        side_effect=_regos,
    ) as mock_regos:
        edit = await client.patch(
            "/api/v1/stock/purchase/operations",
            headers={"Authorization": f"Bearer {token}"},
            json={"operations": [{"id": 9, "quantity": 3}]},
        )
        delete = await client.request(
            "DELETE",
            "/api/v1/stock/purchase/operations",
            headers={"Authorization": f"Bearer {token}"},
            json={"ids": [9]},
        )

    assert edit.status_code == 200, edit.text
    assert delete.status_code == 200, delete.text
    endpoints = [c.args[2] for c in mock_regos.await_args_list]
    assert endpoints == ["purchaseoperation/edit", "purchaseoperation/delete"]
    assert mock_regos.await_args_list[0].args[3] == [{"id": 9, "quantity": 3.0}]
    assert mock_regos.await_args_list[1].args[3] == [{"id": 9}]


@pytest.mark.asyncio
async def test_perform_and_perform_cancel(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-perform@test.com", company_name="Perform Co")
    token = reg.json()["access_token"]

    async def _regos(_session, _company_id, endpoint, payload):
        if endpoint == "docpurchase/get":
            return {"ok": True, "result": [_purchase_doc()]}
        if endpoint == "docpurchase/perform":
            assert payload == {"id": 101}
            return {"ok": True, "result": {"row_affected": 1}}
        if endpoint == "docpurchase/performcancel":
            assert payload == {"id": 101}
            return {"ok": True, "result": {"row_affected": 1}}
        raise AssertionError(f"Unexpected endpoint: {endpoint}")

    with patch(
        "app.services.regos_stock_docs.regos_async_api_request_for_company",
        new_callable=AsyncMock,
        side_effect=_regos,
    ):
        perform = await client.post(
            "/api/v1/stock/purchase/documents/101/perform",
            headers={"Authorization": f"Bearer {token}"},
        )
        cancel = await client.post(
            "/api/v1/stock/purchase/documents/101/perform-cancel",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert perform.status_code == 200, perform.text
    assert cancel.status_code == 200, cancel.text
    assert perform.json()["ok"] is True
    assert cancel.json()["ok"] is True


@pytest.mark.asyncio
async def test_create_movement_document(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-move-create@test.com", company_name="Move Co")
    token = reg.json()["access_token"]

    with patch(
        "app.services.regos_defaults.get_regos_defaults",
        new_callable=AsyncMock,
        return_value={"warehouse": {"id": 11, "name": "Main"}},
    ):
        # Missing receiver → 400
        missing = await client.post(
            "/api/v1/stock/movement/documents",
            headers={"Authorization": f"Bearer {token}"},
            json={"stock_sender_id": 11},
        )
        assert missing.status_code == 400
        assert missing.json()["code"] == "STOCKS_REQUIRED"

        with patch(
            "app.services.regos_stock_docs.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            return_value={"ok": True, "result": {"new_id": 77, "code": "M-77"}},
        ) as mock_regos:
            created = await client.post(
                "/api/v1/stock/movement/documents",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "stock_sender_id": 11,
                    "stock_receiver_id": 12,
                    "date": 1_700_000_000,
                },
            )

    assert created.status_code == 200, created.text
    body = created.json()
    assert body["id"] == 77
    assert body["code"] == "M-77"
    assert mock_regos.await_args.args[2] == "docmovement/add"
    assert mock_regos.await_args.args[3]["stock_sender_id"] == 11
    assert mock_regos.await_args.args[3]["stock_receiver_id"] == 12


@pytest.mark.asyncio
async def test_wholesale_requires_sales_write(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-ws-auth@test.com", company_name="WS Auth Co")
    owner_token = reg.json()["access_token"]
    await _create_employee(
        client,
        owner_token,
        login="no-sales-write",
        permission_rules=[{"code": "sales.write", "effect": "deny"}],
    )
    token = await _login_employee(client, "no-sales-write")

    response = await client.post(
        "/api/v1/stock/wholesale/documents",
        headers={"Authorization": f"Bearer {token}"},
        json={"partner_id": 1, "stock_id": 11},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_purchase_write_forbidden(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-pw-auth@test.com", company_name="PW Auth Co")
    owner_token = reg.json()["access_token"]
    await _create_employee(
        client,
        owner_token,
        login="no-purchase-write",
        permission_rules=[{"code": "purchase.write", "effect": "deny"}],
    )
    token = await _login_employee(client, "no-purchase-write")

    response = await client.post(
        "/api/v1/stock/purchase/documents",
        headers={"Authorization": f"Bearer {token}"},
        json={"partner_id": 1, "stock_id": 11},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_list_movement_documents(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-move-list@test.com", company_name="Move List Co")
    token = reg.json()["access_token"]

    with patch(
        "app.services.regos_stock_docs.regos_async_api_request_for_company",
        new_callable=AsyncMock,
    ) as mock_regos:
        mock_regos.return_value = {
            "ok": True,
            "result": [
                {
                    "id": 201,
                    "code": "MV-201",
                    "date": 1_700_000_100,
                    "stock_sender": {"id": 11, "name": "Main"},
                    "stock_receiver": {"id": 12, "name": "Shop"},
                    "performed": False,
                    "amount": 0,
                }
            ],
            "next_offset": 0,
            "total": 1,
        }
        with patch(
            "app.services.regos_defaults.get_regos_defaults",
            new_callable=AsyncMock,
            return_value={"warehouse": {"id": 11, "name": "Main"}},
        ):
            response = await client.get(
                "/api/v1/stock/movement/documents",
                headers={"Authorization": f"Bearer {token}"},
            )

    assert response.status_code == 200, response.text
    doc = response.json()["documents"][0]
    assert doc["code"] == "MV-201"
    assert doc["stock_sender_id"] == 11
    assert doc["stock_sender_name"] == "Main"
    assert doc["stock_receiver_id"] == 12
    assert doc["stock_receiver_name"] == "Shop"


def _inout_doc(doc_id: int = 301, stock_id: int = 11, inout_type: int = 1) -> dict:
    return {
        "id": doc_id,
        "code": f"IO-{doc_id}",
        "date": 1_700_000_200,
        "stock": {"id": stock_id, "name": "Main"},
        "inout_type": inout_type,
        "performed": False,
        "amount": 0,
    }


@pytest.mark.asyncio
async def test_list_inout_documents(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-inout-list@test.com", company_name="InOut List Co")
    token = reg.json()["access_token"]

    with patch(
        "app.services.regos_stock_docs.regos_async_api_request_for_company",
        new_callable=AsyncMock,
    ) as mock_regos:
        mock_regos.return_value = {
            "ok": True,
            "result": [_inout_doc(), _inout_doc(302, inout_type=2)],
            "next_offset": 0,
            "total": 2,
        }
        with patch(
            "app.services.regos_defaults.get_regos_defaults",
            new_callable=AsyncMock,
            return_value={"warehouse": {"id": 11, "name": "Main"}},
        ):
            response = await client.get(
                "/api/v1/stock/inout/documents",
                headers={"Authorization": f"Bearer {token}"},
                params={"inout_type": "income"},
            )

    assert response.status_code == 200, response.text
    assert mock_regos.await_args.args[2] == "docinout/get"
    assert mock_regos.await_args.args[3]["inout_type"] == "Income"
    docs = response.json()["documents"]
    assert docs[0]["code"] == "IO-301"
    assert docs[0]["inout_type"] == "income"
    assert docs[1]["inout_type"] == "outcome"


@pytest.mark.asyncio
async def test_create_inout_document(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-inout-create@test.com", company_name="InOut Create Co")
    token = reg.json()["access_token"]

    with patch(
        "app.services.regos_defaults.get_regos_defaults",
        new_callable=AsyncMock,
        return_value={
            "warehouse": {"id": 11, "name": "Main"},
            "attached_user": {"id": 9, "name": "Cashier"},
        },
    ):
        with patch(
            "app.services.regos_stock_docs.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            return_value={"ok": True, "result": {"new_id": 77, "code": "IO-77"}},
        ) as mock_regos:
            created = await client.post(
                "/api/v1/stock/inout/documents",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "stock_id": 11,
                    "inout_type": "outcome",
                    "date": 1_700_000_200,
                    "description": "write-off",
                },
            )

    assert created.status_code == 200, created.text
    body = created.json()
    assert body["id"] == 77
    assert body["code"] == "IO-77"
    assert mock_regos.await_args.args[2] == "docinout/add"
    payload = mock_regos.await_args.args[3]
    assert payload["date"] == 1_700_000_200
    assert payload["stock_id"] == 11
    assert payload["inout_type"] == "Outcome"
    assert payload["attached_user_id"] == 9
    assert payload["description"] == "write-off"


@pytest.mark.asyncio
async def test_inout_operations_and_perform(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-inout-ops@test.com", company_name="InOut Ops Co")
    token = reg.json()["access_token"]

    async def fake_regos(_session, _company_id, endpoint, payload):
        if endpoint == "docinout/get":
            return {"ok": True, "result": [_inout_doc()]}
        if endpoint == "inoutoperation/add":
            return {"ok": True, "result": {"row_affected": 1}}
        if endpoint == "inoutoperation/edit":
            return {"ok": True, "result": {"row_affected": 1}}
        if endpoint == "inoutoperation/delete":
            return {"ok": True, "result": {"row_affected": 1}}
        if endpoint == "docinout/perform":
            return {"ok": True, "result": {"row_affected": 1}}
        return {"ok": True, "result": []}

    with patch(
        "app.services.regos_stock_docs.regos_async_api_request_for_company",
        new_callable=AsyncMock,
        side_effect=fake_regos,
    ):
        with patch(
            "app.services.regos_defaults.get_regos_defaults",
            new_callable=AsyncMock,
            return_value={"warehouse": {"id": 11, "name": "Main"}},
        ):
            added = await client.post(
                "/api/v1/stock/inout/operations",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "operations": [
                        {
                            "document_id": 301,
                            "item_id": 55,
                            "quantity": 2,
                            "description": "broken",
                        }
                    ]
                },
            )
            edited = await client.patch(
                "/api/v1/stock/inout/operations",
                headers={"Authorization": f"Bearer {token}"},
                json={"operations": [{"id": 1, "quantity": 3}]},
            )
            deleted = await client.request(
                "DELETE",
                "/api/v1/stock/inout/operations",
                headers={"Authorization": f"Bearer {token}"},
                json={"ids": [1]},
            )
            performed = await client.post(
                "/api/v1/stock/inout/documents/301/perform",
                headers={"Authorization": f"Bearer {token}"},
            )

    assert added.status_code == 200, added.text
    assert edited.status_code == 200, edited.text
    assert deleted.status_code == 200, deleted.text
    assert performed.status_code == 200, performed.text


@pytest.mark.asyncio
async def test_inout_write_forbidden(client: AsyncClient) -> None:
    reg = await register_owner(client, email="stock-inout-auth@test.com", company_name="InOut Auth Co")
    owner_token = reg.json()["access_token"]
    await _create_employee(
        client,
        owner_token,
        login="no-inout-write",
        permission_rules=[{"code": "inout.write", "effect": "deny"}],
    )
    token = await _login_employee(client, "no-inout-write")

    response = await client.post(
        "/api/v1/stock/inout/documents",
        headers={"Authorization": f"Bearer {token}"},
        json={"stock_id": 11, "inout_type": "income"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("path", "denied_code"),
    [
        ("/api/v1/stock/purchase/documents/101/perform", "purchase.perform"),
        ("/api/v1/stock/purchase/documents/101/perform-cancel", "purchase.perform_cancel"),
        ("/api/v1/stock/purchase/documents/101/lock", "purchase.lock"),
        ("/api/v1/stock/purchase/documents/101/unlock", "purchase.unlock"),
    ],
)
async def test_purchase_action_endpoints_require_specific_permissions(
    client: AsyncClient,
    path: str,
    denied_code: str,
) -> None:
    reg = await register_owner(
        client,
        email=f"stock-deny-{denied_code.replace('.', '-')}@test.com",
        company_name=f"Deny {denied_code}",
    )
    owner_token = reg.json()["access_token"]
    login = f"deny-{denied_code.replace('.', '-')}"
    await _create_employee(
        client,
        owner_token,
        login=login,
        permission_rules=[{"code": denied_code, "effect": "deny"}],
    )
    token = await _login_employee(client, login)

    response = await client.post(path, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_employee_defaults_include_stock_action_permissions(client: AsyncClient) -> None:
    reg = await register_owner(
        client,
        email="stock-action-defaults@test.com",
        company_name="Stock Action Defaults Co",
    )
    owner_token = reg.json()["access_token"]
    employee = await _create_employee(client, owner_token, login="stock-action-defaults")
    for code in (
        "purchase.perform",
        "purchase.perform_cancel",
        "purchase.lock",
        "purchase.unlock",
        "movement.perform",
        "inventory.perform",
        "inout.perform",
    ):
        assert code in employee["permissions"]


_DEFAULTS = {
    "warehouse": {"id": 11, "name": "Main"},
    "price_type": {"id": 3, "name": "Retail"},
    "partner": {"id": 1, "name": "Supplier"},
    "currency": {"id": 7, "name": "USD"},
    "attached_user": {"id": 9, "name": "Cashier"},
}


@pytest.mark.asyncio
async def test_employee_without_change_permissions_is_forced_to_defaults(
    client: AsyncClient,
) -> None:
    reg = await register_owner(
        client, email="stock-lock-defaults@test.com", company_name="Lock Defaults Co"
    )
    owner_token = reg.json()["access_token"]
    await _create_employee(client, owner_token, login="locked-docs")
    token = await _login_employee(client, "locked-docs")

    with patch(
        "app.services.regos_defaults.get_regos_defaults",
        new_callable=AsyncMock,
        return_value=_DEFAULTS,
    ):
        with patch(
            "app.services.regos_stock_docs.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            return_value={"ok": True, "result": {"new_id": 201, "code": "P-201"}},
        ) as mock_regos:
            created = await client.post(
                "/api/v1/stock/purchase/documents",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "partner_id": 99,
                    "stock_id": 88,
                    "date": 1_700_000_000,
                    "price_type_id": 5,
                    "currency_id": 9,
                    "vat_calculation_type": "Exclude",
                },
            )

    assert created.status_code == 200, created.text
    payload = mock_regos.await_args.args[3]
    assert payload["partner_id"] == 1
    assert payload["stock_id"] == 11
    assert payload["price_type_id"] == 3
    assert payload["currency_id"] == 7


@pytest.mark.asyncio
async def test_employee_movement_requires_default_warehouse(client: AsyncClient) -> None:
    reg = await register_owner(
        client, email="stock-move-scope@test.com", company_name="Move Scope Co"
    )
    owner_token = reg.json()["access_token"]
    await _create_employee(client, owner_token, login="move-scoped")
    token = await _login_employee(client, "move-scoped")
    headers = {"Authorization": f"Bearer {token}"}

    with patch(
        "app.services.regos_defaults.get_regos_defaults",
        new_callable=AsyncMock,
        return_value=_DEFAULTS,
    ):
        denied = await client.post(
            "/api/v1/stock/movement/documents",
            headers=headers,
            json={
                "stock_sender_id": 12,
                "stock_receiver_id": 13,
                "date": 1_700_000_000,
            },
        )
        assert denied.status_code == 403, denied.text

        with patch(
            "app.services.regos_stock_docs.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            return_value={"ok": True, "result": {"new_id": 77, "code": "M-77"}},
        ) as mock_regos:
            allowed = await client.post(
                "/api/v1/stock/movement/documents",
                headers=headers,
                json={
                    "stock_sender_id": 11,
                    "stock_receiver_id": 13,
                    "date": 1_700_000_000,
                },
            )

    assert allowed.status_code == 200, allowed.text
    payload = mock_regos.await_args.args[3]
    assert payload["stock_sender_id"] == 11
    assert payload["stock_receiver_id"] == 13


@pytest.mark.asyncio
async def test_employee_partner_group_allowlist_on_purchase(client: AsyncClient) -> None:
    reg = await register_owner(
        client, email="stock-partner-scope@test.com", company_name="Partner Scope Co"
    )
    owner_token = reg.json()["access_token"]
    employee = await _create_employee(
        client,
        owner_token,
        login="partner-scoped",
        permission_rules=[{"code": "pos.change_partner", "effect": "allow"}],
    )
    scoped = await client.patch(
        f"/api/v1/users/{employee['id']}/settings/pos",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"allowed_partner_group_ids": [4]},
    )
    assert scoped.status_code == 200, scoped.text
    token = await _login_employee(client, "partner-scoped")
    headers = {"Authorization": f"Bearer {token}"}

    async def _partner_by_id(_session, _company_id, partner_id: int):
        if partner_id == 2:
            return {"id": 2, "group_id": 4, "name": "In scope"}
        return {"id": partner_id, "group_id": 9, "name": "Out of scope"}

    with patch(
        "app.services.regos_defaults.get_regos_defaults",
        new_callable=AsyncMock,
        return_value=_DEFAULTS,
    ):
        with patch(
            "app.services.regos_partners.get_partner_by_id",
            new_callable=AsyncMock,
            side_effect=_partner_by_id,
        ):
            denied = await client.post(
                "/api/v1/stock/purchase/documents",
                headers=headers,
                json={"partner_id": 3, "stock_id": 11, "date": 1_700_000_000},
            )
            assert denied.status_code == 403, denied.text

            with patch(
                "app.services.regos_stock_docs.regos_async_api_request_for_company",
                new_callable=AsyncMock,
                return_value={"ok": True, "result": {"new_id": 301, "code": "P-301"}},
            ) as mock_regos:
                allowed = await client.post(
                    "/api/v1/stock/purchase/documents",
                    headers=headers,
                    json={"partner_id": 2, "stock_id": 11, "date": 1_700_000_000},
                )

    assert allowed.status_code == 200, allowed.text
    assert mock_regos.await_args.args[3]["partner_id"] == 2


@pytest.mark.asyncio
async def test_employee_update_strips_locked_stock_and_price_type(
    client: AsyncClient,
) -> None:
    reg = await register_owner(
        client, email="stock-update-lock@test.com", company_name="Update Lock Co"
    )
    owner_token = reg.json()["access_token"]
    await _create_employee(client, owner_token, login="update-locked")
    token = await _login_employee(client, "update-locked")

    calls: list[tuple[str, dict]] = []

    async def _regos(_session, _company_id, endpoint, payload):
        calls.append((endpoint, payload))
        if endpoint == "docpurchase/get":
            return {"ok": True, "result": [_purchase_doc()]}
        if endpoint in {"docpurchase/lock", "docpurchase/unlock", "docpurchase/edit"}:
            return {"ok": True, "result": {"row_affected": 1}}
        raise AssertionError(f"Unexpected endpoint {endpoint}")

    with patch(
        "app.services.regos_defaults.get_regos_defaults",
        new_callable=AsyncMock,
        return_value=_DEFAULTS,
    ):
        with patch(
            "app.services.regos_stock_docs.regos_async_api_request_for_company",
            new_callable=AsyncMock,
            side_effect=_regos,
        ):
            response = await client.patch(
                "/api/v1/stock/purchase/documents/101",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "date": 1_700_000_100,
                    "stock_id": 88,
                    "partner_id": 99,
                    "price_type_id": 5,
                    "currency_id": 9,
                    "vat_calculation_type": "Include",
                },
            )

    assert response.status_code == 200, response.text
    edit_payload = next(p for e, p in calls if e == "docpurchase/edit")
    assert edit_payload["date"] == 1_700_000_100
    assert "stock_id" not in edit_payload
    assert "partner_id" not in edit_payload
    assert "price_type_id" not in edit_payload
    assert "currency_id" not in edit_payload
    assert edit_payload["vat_calculation_type"] == "Include"
