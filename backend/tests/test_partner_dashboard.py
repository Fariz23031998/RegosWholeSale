from datetime import UTC, datetime

from app.services.partner_telegram_webapp import (
    _amount_and_count,
    _day_key,
    _empty_day_bucket,
    _net_debt_from_lines,
    _add_to_day,
)


def test_amount_and_count_sums_rows() -> None:
    total, count = _amount_and_count(
        [
            {"amount": 10},
            {"amount": "2.5"},
            {"amount": None},
            {"amount": 7.5},
        ]
    )
    assert count == 4
    assert total == 20.0


def test_amount_and_count_empty() -> None:
    total, count = _amount_and_count([])
    assert total == 0.0
    assert count == 0


def test_day_key_from_unix_timestamp() -> None:
    stamp = int(datetime(2026, 3, 15, 12, 0, tzinfo=UTC).timestamp())
    assert _day_key(stamp) == "2026-03-15"
    assert _day_key(None) is None
    assert _day_key(0) is None


def test_add_to_day_accumulates_fields() -> None:
    buckets: dict[str, dict] = {}
    stamp = int(datetime(2026, 1, 2, 8, 0, tzinfo=UTC).timestamp())
    _add_to_day(buckets, date_value=stamp, field="shipments", amount=100)
    _add_to_day(buckets, date_value=stamp, field="shipments", amount=25)
    _add_to_day(buckets, date_value=stamp, field="payments_in", amount=40)
    assert buckets["2026-01-02"]["shipments"] == 125.0
    assert buckets["2026-01-02"]["payments_in"] == 40.0
    assert buckets["2026-01-02"]["purchases"] == 0.0


def test_empty_day_bucket_shape() -> None:
    bucket = _empty_day_bucket("2026-01-01")
    assert bucket["day"] == "2026-01-01"
    assert set(bucket) == {
        "day",
        "shipments",
        "shipment_returns",
        "purchases",
        "purchase_returns",
        "payments_in",
        "payments_out",
    }


def test_net_debt_from_lines_offsets_credits() -> None:
    net, by_currency = _net_debt_from_lines(
        [
            {"amount": 1000, "currency_code": "UZS", "currency_id": 1},
            {"amount": 200, "currency_code": "USD", "currency_id": 2},
            {"amount": -300, "currency_code": "UZS", "currency_id": 1},
            {"amount": 0, "currency_code": "EUR", "currency_id": 3},
        ]
    )
    assert net == 900.0
    codes = {row["currency_code"]: row["amount"] for row in by_currency}
    assert codes["UZS"] == 700.0
    assert codes["USD"] == 200.0
    assert "EUR" not in codes


def test_net_debt_empty_is_zero() -> None:
    net, by_currency = _net_debt_from_lines([])
    assert net == 0.0
    assert by_currency == []
