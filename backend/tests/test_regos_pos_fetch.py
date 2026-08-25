import pytest

from app.services import regos_pos_fetch as pos_fetch


@pytest.mark.asyncio
async def test_fetch_cheque_payments_uses_doc_sale_uuid(monkeypatch):
    captured_payload: dict | None = None

    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        nonlocal captured_payload
        captured_payload = request_data
        return {"ok": True, "result": []}

    monkeypatch.setattr(
        pos_fetch,
        "regos_async_api_request_for_company",
        fake_regos,
    )

    await pos_fetch.fetch_cheque_payments(None, 1, "F44289C4-6EDC-48D0-A40F-63D718F35993")

    assert captured_payload == {
        "doc_sale_uuid": "f44289c4-6edc-48d0-a40f-63d718f35993",
    }


def test_is_pos_cheque_closed():
    assert pos_fetch.is_pos_cheque_closed({"closed": True}) is True
    assert pos_fetch.is_pos_cheque_closed({"sale_status": "Closed"}) is True
    assert pos_fetch.is_pos_cheque_closed({"status": "closed"}) is True
    assert pos_fetch.is_pos_cheque_closed({"sale_status": "Open"}) is False
    assert pos_fetch.is_pos_cheque_closed({}) is False


@pytest.mark.asyncio
async def test_resolve_cheque_session_code_fetches_session_code(monkeypatch):
    async def fake_regos(session, company_id, endpoint, request_data, timeout_seconds=30):
        if endpoint == "doccashsession/get":
            return {"ok": True, "result": [{"code": "17-0000004"}]}
        raise AssertionError(endpoint)

    monkeypatch.setattr(
        pos_fetch,
        "regos_async_api_request_for_company",
        fake_regos,
    )

    code = await pos_fetch.resolve_cheque_session_code(
        None,
        1,
        {
            "session": "18c5b099-970c-4ab1-881a-02e1a919b94c",
        },
    )

    assert code == "17-0000004"


@pytest.mark.asyncio
async def test_fetch_session_cheque_details_batches_ops_only(monkeypatch):
    captured_steps: list[dict] = []
    payment_calls: list[str] = []

    async def fake_batch(session, company_id, steps, **kwargs):
        captured_steps.extend(steps)
        return {
            step["key"]: {"ok": True, "result": []}
            for step in steps
        }

    async def fake_payments(session, company_id, cheque_uuid):
        payment_calls.append(cheque_uuid)
        return [{"value": 100}]

    monkeypatch.setattr(
        pos_fetch,
        "regos_batch_request_chunks_for_company",
        fake_batch,
    )
    monkeypatch.setattr(pos_fetch, "fetch_cheque_payments", fake_payments)

    cheque_uuid = "f44289c4-6edc-48d0-a40f-63d718f35993"
    operations_by_cheque, payments_by_cheque = await pos_fetch.fetch_session_cheque_details(
        None,
        1,
        [cheque_uuid],
    )

    assert captured_steps == [
        {
            "key": f"ops:{cheque_uuid}",
            "path": "chequeitemoperation/get",
            "payload": {"doc_sale_uuid": cheque_uuid},
        },
    ]
    assert payment_calls == [cheque_uuid]
    assert operations_by_cheque[cheque_uuid] == []
    assert payments_by_cheque[cheque_uuid] == [{"value": 100}]
