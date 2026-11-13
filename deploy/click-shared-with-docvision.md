# Shared Click checkout (DocVision + RegosWholeSale)

Click personal account stays unchanged:

- Prepare: `https://visiondoc.site/api/click/prepare`
- Complete: `https://visiondoc.site/api/click/complete`

## DocVision (`visiondoc.site`)

Add to backend `.env`:

```
REGOS_CLICK_FORWARD_BASE_URL=https://regosoptom.uz
```

Keep existing `CLICK_MERCHANT_ID`, `CLICK_SERVICE_ID`, `CLICK_MERCHANT_USER_ID`, `CLICK_SECRET_KEY`.

Orders with `merchant_trans_id` starting with `rw_` are forwarded to RegosWholeSale.

## RegosWholeSale (`regosoptom.uz`)

Add the **same** Click credentials plus pricing:

```
SUBSCRIPTION_MONTHLY_PRICE_UZS=100000
CLICK_MERCHANT_ID=...
CLICK_SERVICE_ID=...
CLICK_MERCHANT_USER_ID=...
CLICK_SECRET_KEY=...
CLICK_RETURN_URL=https://regosoptom.uz/billing
```

Then run migrations:

```
cd backend && alembic upgrade head
```

Tenant renewals: sign in → `/billing` → Pay with Click.
