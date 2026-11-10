# Fastest way to calculate partner debt

Use one `partnerbalance/get` call with grouping and balance rows, over a period that contains no documents. Read `end_amount` on each `Currency` row. That amount is the current closing balance for that firm and currency.

Checked against integration `334bc4821db749cc9c10936eda668201` on 9 Nov 2026. Docs: [partnerbalance/get](https://docs.regos.uz/ru/api/references/partnerbalance/get).

## Request

Same URL shape as the API tester:

```
POST https://integration.regos.uz/gateway/out/{integrationToken}/v1/partnerbalance/get
Content-Type: application/json;charset=utf-8
```

In the tester, turn on **Use Vite proxy**. The browser then calls `/regos-proxy/gateway/out/{integrationToken}/v1/partnerbalance/get`.

```json
{
  "partner_id": 1,
  "start_date": 1794250799,
  "end_date": 1794250799,
  "grouping": true,
  "include_balance_rows": true
}
```

`start_date` and `end_date` are the same Unix second: 23:59:59 in the company timezone (Tashkent, UTC+5). Every document dated today is already inside the opening balance, and the response has no operations.

The documented `filters` form returns the same rows:

```json
{
  "filters": [
    { "Field": "partner_id", "Operator": "Equal", "Value": "1" },
    { "Field": "start_date", "Operator": "GreaterOrEqual", "Value": "1794250799" },
    { "Field": "end_date", "Operator": "LessOrEqual", "Value": "1794250799" }
  ],
  "grouping": true,
  "include_balance_rows": true
}
```

`partner_id` is required and accepts only `Equal`. One request is one partner. A missing partner id returns error `1002`. An unknown id returns `{ "ok": true, "result": [] }`, which means zero debt.

## What to read

The result is a flat tree. Keep rows with `entity_type: "Currency"`.

| Row | Use it? |
|---|---|
| `Currency` | Yes. `end_amount` is the closing balance for `firm` + `currency`. |
| `Firm` | No. Firms do not sum different currencies, so `end_amount` is null. |
| `PartnerBalance` named "Сальдо на начало периода" / "Сальдо на конец периода" | No. These repeat the currency total. |
| Real documents (`id` > 0) | None, when the period is a single second. |

Sign, same as the statement screen:

- **Positive** `end_amount`: the partner owes the firm.
- **Negative** `end_amount`: the firm owes the partner.
- **Zero**, or an empty `result`: no debt either way.

A partner can have several currency rows (one per firm and currency). Sum `end_amount` across firms to get one total per currency. Do not take the latest document from a flat statement: that running balance belongs to one firm only.

`exchange_rate` on these currency rows is `0`. For conversion, use [`currency/get`](https://docs.regos.uz/ru/api/references/currency/get) (`exchange_rate`, and `is_base`). Cache that catalog; it does not change per partner.

```
amount_in_base = end_amount * currency.exchange_rate / base.exchange_rate
```

Base rate is `1` for UZS on this account.

Partner debt in base currency:

1. Convert each currency closing.
2. `grossDebt` = sum of positive closings.
3. `credit` = sum of absolute values of negative closings.
4. `netDebt` = `max(0, grossDebt - credit)`.

`netDebt` is what the partner still owes after firm debt in other currencies offsets it. The signed position is `grossDebt - credit` (negative means the firm owes the partner overall).

Leave `stock_id` and `firm_id` out unless you want one stock or one firm. `stock_id` filters balances, not only movements.

## Checked on this integration

Partner `1` (169 documents from 2000-01-01 through end of today). Currency closings from the short call matched the full statement: last row `start_amount + debit - credit` per firm and currency. Flat rows come back with `end_amount: null`, so a full download has to recompute that itself.

| Firm | Currency | Closing |
|---|---|---|
| ROFEEV TECHNOLOGY SAM | UZS | +98,753,928 |
| ROFEEV TECHNOLOGY TASH | USD | −3,041 |
| ROFEEV TECHNOLOGY TASH | UZS | −3,000,794,320.257 |

Current rates from `currency/get`: UZS `1` (base), USD `11,987`, RUB `152`.

| Piece | Base (UZS) |
|---|---|
| Partner owes (SAM UZS) | +98,753,928 |
| Firm owes (TASH UZS) | −3,000,794,320.257 |
| Firm owes (TASH USD −3,041 × 11,987) | −36,452,467 |
| Signed position | −2,938,492,859.257 |
| Net partner debt | 0 |

Partner `2` matched the same way: SAM UZS `+1,275,000`, TASH UZS `−995,006,169,018.3`.

## Why this is the fast path

Measured on partner `1`. Times are one round trip to `integration.regos.uz`.

| Call | Time | Size | Rows |
|---|---|---|---|
| Short grouped call (this method) | 54–65 ms, median 56 ms over 5 calls | 9 KB | 11 (firms, currencies, opening/closing only) |
| Full flat history, `partner_id` + dates, no grouping | 107–137 ms | 153 KB | 169 documents |
| Full history with grouping | 145 ms | 166 KB | 180 |
| `getinbasecurrency` over full history | 122 ms | 105 KB | 169 |

Partner `2` has only 12 documents, and both calls landed around 50–70 ms. The short call stays at a handful of rows no matter how long the statement is. The full call grows with every sale and payment. On this account the server floor is about 50 ms; the saving shows up as soon as the partner has real history (about 2× faster and 17× smaller at 169 documents).

`include_balance_rows` has to be `true`. With `false`, an empty period returns `[]`, so the debt disappears. A flat call over the same one-second period also returns `[]`.

## Do not use `getinbasecurrency` for this

[`partnerbalance/getinbasecurrency`](https://docs.regos.uz/ru/api/references/partnerbalance/getinbasecurrency) ignores `grouping` and `include_balance_rows`. A one-second period returns `[]`. The full history converts each document at the rate stored on that document, then you still walk every row.

For partner `1`, firm TASH, that historical total was `−3,037,821,550.257` UZS. The same balances at today's USD rate (`11,987`, not the `12,000` on the last USD document) are `−3,037,246,787.257`. Use `partnerbalance/get` plus `currency/get` when the debt should follow current rates.

## Limits

Regos allows a burst of 50 requests, then refills about 2 requests per second, per integration token ([limits](https://docs.regos.uz/uz/api/intro/limits)). There is no multi-partner filter on this method, so a company-wide refresh is one short call per partner.

This integration accepted the call with no `Authorization` header. A replicable integration still needs `Authorization: Bearer {access_token}` from `https://auth.regos.uz/oauth/token` (the tester's OAuth helper).
