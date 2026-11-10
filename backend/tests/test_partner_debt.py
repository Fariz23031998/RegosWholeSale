from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import Company, User
from app.services.regos_partner_balance import (
    company_today_bounds,
    extract_partner_debt_lines,
)
from helpers import register_owner

REGOS_TOKEN = "b" * 32
TASHKENT = ZoneInfo("Asia/Tashkent")


def test_today_bounds_follow_company_timezone() -> None:
    moment = datetime(2026, 11, 9, 22, 30, tzinfo=timezone.utc)
    tashkent_start, tashkent_end = company_today_bounds("Asia/Tashkent", moment)
    utc_start, utc_end = company_today_bounds("UTC", moment)

    assert tashkent_start == int(datetime(2026, 11, 10, 0, 0, tzinfo=TASHKENT).timestamp())
    assert tashkent_end == int(datetime(2026, 11, 10, 23, 59, 59, tzinfo=TASHKENT).timestamp())
    assert utc_start == int(datetime(2026, 11, 9, 0, 0, tzinfo=timezone.utc).timestamp())
    assert utc_end == int(datetime(2026, 11, 9, 23, 59, 59, tzinfo=timezone.utc).timestamp())
    assert tashkent_start != utc_start


def test_invalid_timezone_falls_back_to_tashkent() -> None:
    moment = datetime(2026, 11, 9, 22, 30, tzinfo=timezone.utc)
    fallback = company_today_bounds("Not/AZone", moment)
    tashkent = company_today_bounds("Asia/Tashkent", moment)
    assert fallback == tashkent


def test_extract_partner_debt_lines_keeps_currency_closings() -> None:
    lines = extract_partner_debt_lines(
        [
            {
                "entity_type": "Firm",
                "end_amount": None,
                "firm": {"id": 1, "name": "Tash"},
            },
            {
                "entity_type": "Currency",
                "end_amount": 100005,
                "exchange_rate": 0,
                "currency": {
                    "id": 1,
                    "code_chr": "UZS",
                    "name": "Sum",
                    "exchange_rate": 1,
                },
                "firm": {"id": 2, "name": "Sam"},
            },
            {
                "entity_type": "PartnerBalance",
                "end_amount": 100005,
                "document_type": {"name": "Сальдо на начало периода"},
            },
            {
                "entity_type": "Currency",
                "end_amount": -198.2,
                "currency": {
                    "id": 2,
                    "code_chr": "USD",
                    "name": "Dollar",
                    "exchange_rate": 11987,
                },
                "firm": {"id": 1, "name": "Tash"},
            },
            {
                "entity_type": "Currency",
                "end_amount": 0,
                "currency": {"id": 3, "code_chr": "RUB", "exchange_rate": 152},
                "firm": {"id": 1, "name": "Tash"},
            },
        ]
    )

    assert lines == [
        {
            "firm_id": 2,
            "firm_name": "Sam",
            "currency_id": 1,
            "currency_code": "UZS",
            "currency_name": "Sum",
            "exchange_rate": 1.0,
            "amount": 100005.0,
        },
        {
            "firm_id": 1,
            "firm_name": "Tash",
            "currency_id": 2,
            "currency_code": "USD",
            "currency_name": "Dollar",
            "exchange_rate": 11987.0,
            "amount": -198.2,
        },
    ]


@pytest.mark.asyncio
@patch(
    "app.services.regos_partner_balance.regos_async_api_request_for_company",
    new_callable=AsyncMock,
)
async def test_partner_debt_endpoint_uses_grouped_today_window(
    mock_regos: AsyncMock,
    client: AsyncClient,
    session_factory,
) -> None:
    mock_regos.return_value = {
        "ok": True,
        "result": [
            {"entity_type": "Firm", "end_amount": None, "firm": {"id": 1, "name": "Tash"}},
            {
                "entity_type": "Currency",
                "end_amount": -20,
                "currency": {"id": 2, "code_chr": "USD", "name": "Dollar", "exchange_rate": 12000},
                "firm": {"id": 1, "name": "Tash"},
            },
            {
                "entity_type": "PartnerBalance",
                "end_amount": -20,
                "document_type": {"name": "Сальдо на конец периода"},
            },
        ],
    }

    reg = await register_owner(client, email="partner-debt@test.com", company_name="Debt Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    async with session_factory() as session:
        user = (
            await session.execute(select(User).where(User.email == "partner-debt@test.com"))
        ).scalar_one()
        company = await session.get(Company, user.company_id)
        assert company is not None
        company.timezone = "Asia/Tashkent"
        await session.commit()

    await client.put(
        "/api/v1/regos/tokens",
        headers=headers,
        json={"token": REGOS_TOKEN, "is_replicable": False},
    )

    response = await client.get("/api/v1/regos/partners/8/debt", headers=headers)
    assert response.status_code == 200
    assert response.json()["lines"] == [
        {
            "firm_id": 1,
            "firm_name": "Tash",
            "currency_id": 2,
            "currency_code": "USD",
            "currency_name": "Dollar",
            "exchange_rate": 12000.0,
            "amount": -20.0,
        }
    ]

    mock_regos.assert_called_once()
    endpoint = mock_regos.call_args[0][2]
    payload = mock_regos.call_args[0][3]
    assert endpoint == "partnerbalance/get"
    assert payload["partner_id"] == 8
    assert payload["grouping"] is True
    assert payload["include_balance_rows"] is True
    assert payload["start_date"] == company_today_bounds("Asia/Tashkent")[0]
    assert payload["end_date"] == company_today_bounds("Asia/Tashkent")[1]
