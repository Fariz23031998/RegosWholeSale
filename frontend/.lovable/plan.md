## POS App — Build Plan

A modern, responsive Point-of-Sale web app. All data is in-memory mock data (resets on refresh). Styling uses plain CSS Modules — no Tailwind, no shadcn primitives.

### Routes (TanStack Start, file-based)

```
src/routes/
  __root.tsx          shell + global styles + auth gate
  login.tsx           /login         mock PIN screen
  _app.tsx            authenticated layout (sidebar + outlet)
  _app.index.tsx      /              POS (catalog + cart) — cashier home
  _app.sales.tsx      /sales         sales history + receipt drawer
  _app.dashboard.tsx  /dashboard     stats + charts
```

`_app.tsx` checks the in-memory auth store; if no cashier is signed in it redirects to `/login`.

### Feature breakdown

**Mock auth (`/login`)**
- Two seeded cashiers (e.g. `1234` Alice, `5678` Bob) shown as hint chips.
- PIN pad UI, sets current cashier in a Zustand store. Logout button in sidebar.

**POS screen (`/`)** — two-pane layout, collapses to tabs on mobile
- Left: search bar, category chips, product grid (image, name, price, stock badge). Click adds to cart.
- Right: cart with qty +/−, line totals, subtotal, tax (configurable %), discount field, grand total, "Charge" button.
- Charge opens a checkout modal: choose Cash (with amount-tendered + change calc) or Card (mock approval spinner). On success: create a Sale, show receipt modal with print button, clear cart.

**Sales history (`/sales`)**
- Table of sales (id, time, cashier, items count, total, payment method).
- Filters: today / week / all, payment method, cashier.
- Row click → printable receipt view (uses `window.print()` with print-only CSS).

**Dashboard (`/dashboard`)**
- KPI cards: today's revenue, transactions, avg basket, items sold.
- Charts via `recharts` (already a common dep, will install): revenue last 7 days (line), top 5 products (bar), payment mix (donut).

### State (Zustand, in-memory)
- `useAuthStore` — currentCashier, login(pin), logout().
- `useCatalogStore` — products[], categories[], search/filter helpers (seeded with ~30 products across 5 categories: Beverages, Snacks, Bakery, Produce, Household).
- `useCartStore` — items[], add/remove/updateQty/clear, subtotal/tax/total selectors, discount.
- `useSalesStore` — sales[], recordSale(sale).
- Seed data lives in `src/data/seed.ts`. Product images use `https://picsum.photos/seed/{slug}/300/200` (no asset generation needed).

### Styling — Plain CSS Modules
- Remove Tailwind from `src/styles.css`; replace with a hand-written global stylesheet:
  - CSS custom properties for theme tokens (colors, spacing, radii, shadows, fonts).
  - Light theme primary palette: deep indigo `#4f46e5` accent, slate neutrals, soft surfaces — clean SaaS look.
  - Reset, base typography (Inter via Google Fonts link in `__root.tsx` head), utility helpers kept minimal.
- Each component ships a sibling `.module.css` file. No shadcn components used.
- Responsive via CSS grid + flex + container queries / media queries. Sidebar collapses to bottom nav on ≤768px.

### Components (`src/components/`, each with its own `.module.css`)
- `Layout/Sidebar` — nav links (POS, Sales, Dashboard), cashier badge, logout.
- `POS/ProductGrid`, `POS/ProductCard`, `POS/CategoryBar`, `POS/SearchInput`.
- `Cart/CartPanel`, `Cart/CartLine`, `Cart/CartSummary`.
- `Checkout/CheckoutModal`, `Checkout/CashPad`, `Checkout/CardPay`.
- `Receipt/ReceiptView` (used in modal + print page).
- `Sales/SalesTable`, `Sales/SalesFilters`.
- `Dashboard/KpiCard`, `Dashboard/RevenueChart`, `Dashboard/TopProductsChart`, `Dashboard/PaymentMixChart`.
- `ui/Button`, `ui/Modal`, `ui/Input`, `ui/Badge` — minimal hand-rolled primitives.

### Dependencies to add
- `zustand` — state.
- `recharts` — dashboard charts.
- `clsx` — conditional class names.
- (Tailwind, shadcn, tw-animate-css packages stay installed but are no longer imported. Existing `src/components/ui/*` shadcn files are left untouched and unused.)

### Out of scope (v1)
- Real backend, persistence across reloads, multi-store, refunds/returns, barcode scanner integration, currency switcher (USD only), receipt email/SMS.

### Acceptance checks before delivery
- `/login` blocks access to other routes until a valid PIN is entered.
- Adding products to cart, adjusting qty, completing a Cash sale produces a receipt and a row in `/sales`.
- Dashboard reflects sales made in the same session.
- Layout works at 1440, 1024, 768, 390 widths.
- No Tailwind utility classes in any component file (`rg "className=\"[a-z]"` only matches CSS-module bindings).
