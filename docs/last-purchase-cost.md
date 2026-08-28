# Last purchase cost

How REGOS stores **last purchase cost**, and how Regos Optom converts it for dashboard totals.

---

## Summary

Regos Optom does **not** compute last purchase cost itself. It reads the `last_purchase_cost` field that REGOS returns on stock operations.

| Layer | What happens |
| --- | --- |
| REGOS | After a **purchase from partner** is performed, REGOS remembers that line’s `cost` as the item’s last purchase cost. Later sale / return / in-out lines expose it as `last_purchase_cost`. |
| Currency | Live API samples show the value is in the **current document’s currency**, not always UZS. A USD wholesale line returns a USD cost (e.g. `200`); a UZS wholesale line returns a UZS cost (e.g. `12549.705`). |
| Dashboard | **Net totals → Total cost** is `Σ (last_purchase_cost × quantity)` on sale lines, minus the same sum on refund lines. Each line is converted with the **sale/return document’s currency**, using the same `_convert_to_default` path as sales amounts. |
| Catalog (`Item/GetExt`) | The same field exists on the item, but on this integration it is often `null`. Dashboard cost does **not** use the catalog field. |

`currency_mode=native` leaves costs in the document currency (already filtered to one currency). `currency_mode=all` converts every line into the dashboard display currency.

---

## REGOS source

Integration base:

```text
POST https://integration.regos.uz/gateway/out/{token}/v1/{endpoint}
Content-Type: application/json;charset=utf-8
Authorization: Bearer {oauth_access_token}
```

### Fields

REGOS documents `last_purchase_cost` as **“last purchase cost” / «Стоимость последней закупки»** (decimal).

| Endpoint | Role of `last_purchase_cost` |
| --- | --- |
| [`PurchaseOperation`](https://docs.regos.uz/en/api/store/purchaseoperation) | Last purchase cost **and** the line’s own `cost` (purchase price in the purchase document currency). Extra landed cost is a separate field: `additional_expenses_amount`. |
| [`WholeSaleOperation`](https://docs.regos.uz/en/api/store/wholesaleoperation) | Cost REGOS attaches to a shipment-to-partner (sale) line. Returned only if the API user may view last purchase cost. This is what the dashboard uses. |
| [`WholeSaleReturnOperation`](https://docs.regos.uz/en/api/store/wholesalereturnoperation) | Same field on partner-return / refund lines. Subtracted from sold cost for **net** totals. |
| [`InOutOperation`](https://docs.regos.uz/en/api/store/inoutoperation) | Same field on receipt / write-off lines. Optom uses it as a fallback **display** cost when `cost` is missing. |
| [`Item/GetExt`](https://docs.regos.uz/en/api/references/item/getext) | Catalog-level last purchase cost on `ItemExt`. Live pulls for this company returned the key with value `null` even for items that have a cost on operations. |

[`Item/Get`](https://docs.regos.uz/en/api/references/item/get) does not include `last_purchase_cost` on the item model.

### How REGOS updates the value

1. A **DocPurchase** line stores `cost` in the **purchase document currency** (this company: usually USD, `exchange_rate` ≈ 11800–11950 vs UZS).
2. After the purchase is performed, that `cost` becomes the item’s last purchase cost.
3. Later operations (`WholesaleOperation/Get`, returns, in-out) return it as `last_purchase_cost`.
4. [`PurchaseOperation/SetCostByLastPurchase`](https://docs.regos.uz/en/api/store/purchaseoperation/setcostbylastpurchase) copies those historical costs onto lines of a **new** purchase document (document must be locked). Missing history is a business error.

Optom never calls `SetCostByLastPurchase`. It only **reads** `last_purchase_cost`.

There is no weighted-average or FIFO cost in this app. If REGOS changes how it fills the field, Optom follows whatever the API returns.

---

## Live samples (this integration)

Currencies from `currency/get`:

| id | code | exchange_rate | is_base |
| --- | --- | --- | --- |
| 1 | UZS | 1 | true |
| 2 | USD | 11801.23 | false |

### Purchase lines (`purchaseoperation/get`)

Recent performed purchases are USD documents. `cost` and `last_purchase_cost` match (first purchase of that item, or REGOS already copied the new cost):

| Purchase | Currency | Item | Qty | `cost` | `last_purchase_cost` |
| --- | --- | --- | --- | --- | --- |
| 2026-0000023 | USD @ 11853.55 | iPhone 17 Promax 256GB Silver | 1 | 1450 | 1450 |
| 2026-0000021 | USD @ 11853.55 | Protoin | 12 | 6 | 6 |
| 2026-0000019 | USD @ 11889.95 | iPhone 12 White 128GB | 1 | 200 | 200 |

`additional_expenses_amount` was `0` on these lines.

### Sale lines (`wholesaleoperation/get`)

The number tracks the **sale document currency**, not a single base unit:

| Sale | Doc currency | Item | Qty | Line price | `last_purchase_cost` |
| --- | --- | --- | --- | --- | --- |
| WSL-0000016 | UZS @ 1 | ESD Anti Static | 1 | 20 000 | **12 549.705** (UZS-scale) |
| WSL-0000017 | UZS @ 1 | Usb Foxconn | 1 | 30 000 | **16 852.461** (UZS-scale) |
| WSL-0000019 | USD @ 11889.95 | iPhone 12 White 128GB | 1 | 250 | **200** (same USD as the purchase) |
| WSL-0000020 | USD @ 11889.95 | iPhone 17 Pro Max 256GB | 1 | 1500 | **1407.318** (USD-scale) |
| WSL-0000023 | USD @ 11853.55 | 24/25 ultra oyna | 5 | 4 | **2.017** (USD-scale) |
| WSL-0000015 | USD @ 11952.10 | Adapter org | 2 | 17.5 | **13.94** (USD-scale) |

Same item on `item/getext` (`ids: […]`, `compound: false`): `last_purchase_cost` was **`null`** for every sampled id, including items purchased minutes earlier. Dashboard cost therefore cannot come from the catalog; it comes from **wholesale / return operations**.

---

## How Optom uses the field

### 1. Dashboard Net totals (the cards in Reports)

Frontend: `frontend/src/components/Dashboard/DashboardPage.tsx`  
Backend: `backend/app/services/regos_dashboard.py`

The three cards are **net of refunds**:

| Card | API field | Formula |
| --- | --- | --- |
| Total sales | `net_sales_total` | Sales document amounts − refund document amounts (converted with each **document** currency) |
| Total cost | `net_cost_total` | Sold cost − refund cost |
| Gross profit | `net_gross_profit` | `net_sales_total − net_cost_total` |

Sold / refund cost:

```text
line_cost  = last_purchase_cost × quantity     # skip the line if last_purchase_cost is null
display    = convert(line_cost, document.currency → target_currency)
cost_total = Σ display
net_cost   = cost_total − refunds_cost_total
```

Conversion (`_convert_to_default`, same helper as sales):

```text
display_amount = round(raw_cost × document.currency.exchange_rate / target.exchange_rate, 2)
```

Target currency:

- `currency_mode=all`: dashboard `summary_currency` (e.g. USD). A UZS cost of 12 600 at rate 1 becomes `12600 / 12600 = 1` USD; a USD cost of 200 stays 200.
- `currency_mode=native`: no conversion. The period already contains one currency, and `last_purchase_cost` is already in that document’s currency.

Lines with `last_purchase_cost: null` add **0** to cost (full sale amount becomes profit).

### 2. Products table on the dashboard

Per item, Optom still uses operation `last_purchase_cost`:

- `sold_purchase_cost` / `refund_purchase_cost` = Σ (`last_purchase_cost × qty`) converted with that operation’s document currency (same as Net totals)
- `purchase_cost` = unit `last_purchase_cost` from the **last operation seen** for that item (not a period average), converted the same way
- `net_purchase_cost` = sold cost − refund cost
- `net_gross_profit` = net sales − net purchase cost

### 3. Sales / stock mapping

`wholesaleoperation/get` and `wholesalereturnoperation/get` are mapped in `_map_wholesale_operation` (`backend/app/services/regos_sales.py`): the API decimal is stored as `float` or `null`. No currency conversion there.

In-out add-line UI can fill cost from `item/getext.last_purchase_cost` when the user does not type a cost (`regos_stock_docs.py`). With catalog values `null`, that fallback is empty unless REGOS starts filling `ItemExt`.

Out-of-stock reports / Telegram alerts also pass through `item/getext.last_purchase_cost` (often empty on this account).

---

## Worked example

iPhone 12 sale **WSL-0000019** (USD, rate 11889.95):

| Step | Value |
| --- | --- |
| REGOS purchase `cost` | 200 USD |
| REGOS wholesale `price` | 250 USD |
| REGOS wholesale `last_purchase_cost` | 200 |
| Optom sale total (document currency) | 250 USD |
| Optom cost (USD → USD) | **200 USD** |
| Gross profit | **50 USD** |

Older builds treated `200` as soʻm and showed `200 / ~11801 ≈ 0.02` USD cost. That is no longer how the dashboard converts cost.

---

## Implications

1. **Last purchase cost is REGOS’s last performed purchase `cost`**, not Optom math and not FIFO/average.
2. **Read it from operations**, not from `Item/GetExt`, on this integration.
3. **Do not assume UZS.** Live wholesale lines return UZS-scale numbers on UZS documents and USD-scale numbers on USD documents.
4. Dashboard **Total cost** converts each line with the sale/return **document currency**, then (in `all` mode) into the display currency. Native USD keeps a USD cost of 200 as 200.

---

## Code map

| File | Role |
| --- | --- |
| `backend/app/services/regos_sales.py` | `wholesaleoperation/get` → `last_purchase_cost` |
| `backend/app/services/regos_dashboard.py` | `_sum_operation_cost`, `_operation_line_cost`, `_convert_to_default`, net totals |
| `backend/app/utils/currency_conversion.py` | `amount × from_rate / to_rate` |
| `backend/app/services/regos_stock_docs.py` | `item/getext` mapping; in-out cost fallback |
| `frontend/src/components/Dashboard/DashboardPage.tsx` | Net totals cards bind `net_cost_total` |

REGOS references:

- https://docs.regos.uz/en/api/store/purchaseoperation
- https://docs.regos.uz/en/api/store/purchaseoperation/setcostbylastpurchase
- https://docs.regos.uz/en/api/store/wholesaleoperation
- https://docs.regos.uz/en/api/references/item/getext
