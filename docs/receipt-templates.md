# Receipt & Invoice Template Guide

This document describes how to create, import, and maintain print templates in **Regos Optom**. It is written for human developers and AI assistants building templates that work with the live system.

---

## Table of contents

1. [Overview](#overview)
2. [Template types](#template-types)
3. [Import / export file format](#import--export-file-format)
4. [Template JSON schema](#template-json-schema)
5. [Custom HTML templates](#custom-html-templates)
6. [Handlebars syntax](#handlebars-syntax)
7. [Available variables](#available-variables)
8. [Formatting helpers](#formatting-helpers)
9. [Amount in words](#amount-in-words)
10. [Page size, margins, fonts, and layout](#page-size-margins-fonts-and-layout)
11. [Displaying document sections](#displaying-document-sections)
12. [Line item sorting](#line-item-sorting)
13. [Logos](#logos)
14. [Conditional blocks and loops](#conditional-blocks-and-loops)
15. [Barcode and QR codes](#barcode-and-qr-codes)
16. [Security and validation rules](#security-and-validation-rules)
17. [Common mistakes](#common-mistakes)
18. [Complete examples](#complete-examples)

---

## Overview

Receipt templates are stored per company in **Settings → Receipt templates**. Each template defines how a sale or return document is rendered for preview and printing.

Printing uses a **document print context** (`DocumentPrintContext`) that combines:

- Regos wholesale document metadata (`document`)
- Line items (`operations`, `operation_groups`, `totals`)
- Payments (`payments`)
- POS sale snapshot (`sale`) — totals, discount, tax, tendered/change, etc.
- Template configuration (`header`, `footer_text`, …)

Templates are rendered in the browser and sent to the system print dialog.

---

## Template types

| Engine | `engine` value | Description |
|--------|----------------|-------------|
| **Built-in layout** | `"builtin"` | Predefined React layout (80mm receipt or A4 invoice). Section visibility is controlled by `sections` toggles. No custom HTML. |
| **Custom HTML** | `"html"` | Handlebars HTML body + CSS. Full control over markup and styling. **Use this for importable custom designs.** |

| Format | `format` value | Typical use |
|--------|----------------|-------------|
| Thermal receipt | `"80mm"` | POS thermal printers (~80 mm roll paper) |
| Invoice / waybill | `"a4"` | A4 office printers, formal invoices, накладная |

**To create an importable file for custom layouts, always use `"engine": "html"`.**

---

## Import / export file format

### Export from UI

1. Open **Settings → Receipt templates**
2. Click **Export** on a template
3. A JSON file is downloaded

### Import into UI

1. Click **Import template**
2. Select the `.json` file
3. Review in the editor, then **Save template**

### File structure

```json
{
  "version": 1,
  "template": {
    "name": "My 80mm Receipt",
    "format": "80mm",
    "engine": "html",
    "header": {
      "company_name": "Acme LLC",
      "address": "123 Market St",
      "phone": "+998 90 000 00 00",
      "tax_id": "123456789"
    },
    "invoice_title": "",
    "footer_text": "Thank you!",
    "amount_in_words_language": "ru",
    "sections": { "...": true },
    "line_sort": { "column": "document_order", "direction": "asc" },
    "logos": [
      {
        "id": "logo-primary",
        "name": "Primary",
        "src": "data:image/png;base64,...",
        "max_width": 120
      }
    ],
    "html": "<div>...</div>",
    "css": "@page { size: 80mm auto; margin: 4mm; }"
  }
}
```

| Field | Notes |
|-------|-------|
| `version` | Must be `1`. Other versions are rejected on import. |
| `template.id` | Optional on import; a new UUID is assigned. |
| `template.is_default` | Ignored on import; always `false`. Set default in UI after import. |

Plain template objects (without `version` wrapper) are also accepted if they contain `format` and other required fields.

---

## Template JSON schema

### Top-level fields (`template`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Display name (1–120 chars). |
| `format` | `"80mm"` \| `"a4"` | yes | Paper format. |
| `engine` | `"builtin"` \| `"html"` | yes | Layout engine. |
| `header` | object | yes | Company block (see below). |
| `invoice_title` | string | no | Title for A4 invoices (e.g. `"INVOICE"`, `"НАКЛАДНАЯ"`). |
| `footer_text` | string | no | Footer message; available as `{{footer_text}}` in HTML. |
| `amount_in_words_language` | `"ru"` \| `"uz"` \| `"en"` \| `"tj"` \| `null` | no | Language for amount-in-words variables. `null` = off. |
| `sections` | object | no | Section toggles for **built-in** layouts only. |
| `line_sort` | object | no | Sort order for line items (built-in + HTML). |
| `logos` | array | no | Header images (see [Logos](#logos)). Max **10** logos, **200 KB** each. |
| `html` | string | yes for `html` engine | Handlebars HTML body. Max **50 KB**. |
| `css` | string | no | Print CSS. Max **20 KB**. |

### `header` object

| Field | HTML variable |
|-------|----------------|
| `company_name` | `{{header.company_name}}` |
| `address` | `{{header.address}}` |
| `phone` | `{{header.phone}}` |
| `tax_id` | `{{header.tax_id}}` |

### `sections` object (built-in layouts only)

| Key | Purpose |
|-----|---------|
| `header` | Company name & contact |
| `meta` | Date, document #, cashier, warehouse |
| `partner` | Buyer / partner (A4 only; forced off on 80mm) |
| `items` | Line items |
| `subtotal` | Subtotal row |
| `discount` | Discount row (hidden when discount is 0) |
| `total` | Total row |
| `payments` | Payment method(s) |
| `tendered_change` | Cash tendered & change |
| `balance_due` | Paid amount & balance due |
| `closed_without_payment` | “Closed without payment” notice |
| `footer` | `footer_text` |

### `line_sort` object

| Field | Values |
|-------|--------|
| `column` | `document_order`, `item_code`, `item_name`, `item_group_name`, `item_brand`, `item_unit_name`, `quantity`, `price`, `amount` |
| `direction` | `asc`, `desc` |

Applies to `operations` and `operation_groups` before HTML rendering.

### `logos` array

Each logo object:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (UUID). Assigned automatically in the UI. |
| `name` | string | Display name and lookup key for `{{logoImg "Name"}}`. Must be unique per template (case-insensitive). |
| `src` | string | Image as a `data:image/...` URL (PNG, JPEG, GIF, WebP, or SVG). |
| `max_width` | number \| `null` | Optional max display width in pixels (1–600). `null` = natural size. |

Logos are configured in the template editor under **Settings → Logos**. They are included in JSON import/export.

---

## Custom HTML templates

HTML templates consist of two parts edited in the template editor:

1. **HTML** — Handlebars markup (body fragment only; no `<html>`, `<head>`, or `<body>` required)
2. **CSS** — Styles injected into a `<style>` tag for preview and print

At render time the system:

1. Sorts line items per `line_sort`
2. Enriches context (`total_in_words`, `header`, etc.)
3. Compiles HTML with [Handlebars](https://handlebarsjs.com/)
4. Wraps output for print

### Minimal HTML skeleton

```html
<div class="receipt">
  <div class="center"><strong>{{header.company_name}}</strong></div>
  <div class="center">{{header.address}} · {{header.phone}}</div>
  <hr />
  <!-- content -->
  <div class="center">{{footer_text}}</div>
</div>
```

### Minimal CSS skeleton (80mm)

```css
@page { size: 80mm auto; margin: 4mm; }
.receipt { font-family: monospace; font-size: 11px; width: 72mm; }
.center { text-align: center; }
hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
```

---

## Handlebars syntax

Variables use double braces:

```handlebars
{{document.code}}
{{formatCurrency sale.total}}
```

Nested properties:

```handlebars
{{document.currency.code_chr}}
{{header.company_name}}
```

**Do not** use triple braces `{{{...}}}` unless you intentionally need unescaped HTML (generally avoid).

---

## Available variables

### Root context

| Variable | Description |
|----------|-------------|
| `kind` | `"sale"` or `"return"` |
| `document_code` | Document number string |
| `partner_name` | Partner name (shortcut) |
| `stock_name` | Warehouse name (shortcut) |
| `total_in_words` | Words for `totals.amount` (requires `amount_in_words_language`) |
| `total_with_words` | Full formatted line with number + words + currency |
| `amount_in_words_language` | Active language code or empty |

### `document` — Regos wholesale document

| Variable | Type | Description |
|----------|------|-------------|
| `document.id` | number | Internal document ID |
| `document.code` | string | Document number |
| `document.date` | number | Unix timestamp (seconds) |
| `document.partner_id` | number \| null | Partner ID |
| `document.partner_name` | string \| null | Partner / customer name |
| `document.partner_phone` | string \| null | Partner phone |
| `document.stock_id` | number \| null | Warehouse ID |
| `document.stock_name` | string \| null | Warehouse name |
| `document.attached_user_id` | number \| null | Cashier user ID |
| `document.attached_user_name` | string \| null | Cashier name |
| `document.amount` | number \| null | Document amount |
| `document.performed` | boolean | Posted flag |
| `document.currency.id` | number | Currency ID |
| `document.currency.name` | string | Currency name |
| `document.currency.code_chr` | string | Currency code (e.g. `UZS`, `USD`, `сум`) |
| `document.currency.exchange_rate` | number | Exchange rate |
| `document.description` | string | Return description (returns only) |
| `document.wholesale_doc_id` | number | Original sale ID (returns only) |
| `document.reason` | string | Return reason (returns only) |

### `operations[]` — flat line items

Loop with `{{#each operations}}…{{/each}}`.

| Variable | Description |
|----------|-------------|
| `id` | Line ID |
| `document_id` | Parent document ID |
| `item_id` | Product ID |
| `item_code` | Product code |
| `item_name` | Product name |
| `item_group_id` | Group ID |
| `item_group_name` | Product group / category |
| `item_unit_name` | Unit of measure |
| `item_brand` | Brand |
| `quantity` | Quantity |
| `price` | Unit price |
| `price2` | Price without discount |
| `amount` | Line total |
| `item_fullname` | Product full name (Regos `item.fullname`) |
| `item_description` | Product description |
| `item_articul` | Article / SKU |
| `item_color_name` | Color name |
| `item_size_name` | Size name |
| `item_producer_name` | Producer / brand name |
| `item_country_name` | Country of origin |
| `item_icps` | ICPS code |
| `item_package_code` | Package code |
| `item_department_name` | Department name |
| `item_vat_name` | VAT type name |
| `item_vat_value` | VAT rate/value |
| `item_base_barcode` | Base barcode |

Inside `{{#each operations}}`, use `{{item_name}}`, `{{item_articul}}`, `{{item_color_name}}`, etc.

### `operation_groups[]` — lines grouped by product group

Loop with `{{#each operation_groups}}`. Each group has:

| Variable | Description |
|----------|-------------|
| `name` | Group name |
| `total_quantity` | Sum of quantities in group |
| `total_amount` | Sum of amounts in group |
| `lines` | Array of operation lines — use `{{#each lines}}` |

### `totals` — document totals from operations

| Variable | Description |
|----------|-------------|
| `totals.quantity` | Total item quantity |
| `totals.amount` | Total amount after line discounts (sum of line `amount`) |
| `totals.amount_gross` | Total before line discounts (sum of `price2 × quantity`, or `price × quantity` when `price2` is absent) |
| `totals.discount` | Total line discount (sum of `price2 × quantity − amount` per row) |
| `totals.total_in_words` | Same as root `total_in_words` |
| `totals.total_with_words` | Same as root `total_with_words` |

### `payments[]` — payment lines

Loop with `{{#each payments}}…{{/each}}`.

| Variable | Description |
|----------|-------------|
| `id` | Payment ID |
| `code` | Payment document code |
| `date` | Unix timestamp |
| `amount` | Payment amount |
| `category_id` | Category ID |
| `category_name` | Category name |
| `payment_type_name` | Payment type label |
| `partner_id` | Partner ID |
| `partner_name` | Partner name |
| `attached_user_id` | User ID |
| `attached_user_name` | User name |
| `exchange_rate` | Rate used |
| `currency.code_chr` | Payment currency code |

### `sale` — POS checkout snapshot

| Variable | Description |
|----------|-------------|
| `sale.id` | Sale / receipt ID |
| `sale.createdAt` | ISO datetime string |
| `sale.cashierName` | Cashier display name |
| `sale.subtotal` | Subtotal before discount/tax |
| `sale.discount` | Discount amount |
| `sale.tax` | Tax amount |
| `sale.total` | Final total |
| `sale.amountPaid` | Amount paid |
| `sale.balanceDue` | Remaining balance |
| `sale.tendered` | Cash tendered |
| `sale.change` | Change given |
| `sale.type` | `"sale"` or `"refund"` |
| `sale.reason` | Refund reason |
| `sale.refundOf` | Original sale reference |
| `sale.total_in_words` | Words for `sale.total` |
| `sale.total_with_words` | Formatted `sale.total` with words |

> **Note:** `totals.amount` (from Regos operations) and `sale.total` (from POS) may differ slightly depending on context. For wholesale reprints use `totals.amount`; for checkout receipts `sale.total` is usually correct.

### `template` — static template settings (injected at render)

| Variable | Source field |
|----------|--------------|
| `header.company_name` | `header.company_name` |
| `header.address` | `header.address` |
| `header.phone` | `header.phone` |
| `header.tax_id` | `header.tax_id` |
| `invoice_title` | `invoice_title` |
| `footer_text` | `footer_text` |

### `logos[]` — header images

Configured in the template editor. Available in HTML templates and shown automatically in **built-in** layouts when the `header` section is enabled.

| Variable | Description |
|----------|-------------|
| `id` | Logo ID |
| `name` | Logo name (used with `{{logoImg "Name"}}`) |
| `src` | `data:image/...` URL |
| `max_width` | Max width in px, or empty when unset |

---

## Formatting helpers

Use helpers inside `{{...}}`:

| Helper | Usage | Output example |
|--------|-------|----------------|
| `formatCurrency` | `{{formatCurrency amount}}` | `1 296.38` (space thousands separator) |
| `formatAmountWithCurrency` | `{{formatAmountWithCurrency sale.total document.currency}}` | `1 296.38 сум` |
| `formatDate` | `{{formatDate sale.createdAt}}` | `Jun 22, 2026` |
| `formatDateTime` | `{{formatDateTime sale.createdAt}}` | `Jun 22, 2026, 12:00 PM` |
| `formatRegosDate` | `{{formatRegosDate document.date}}` | `22.06.2026` (from Unix seconds) |
| `formatAmountInWords` | `{{formatAmountInWords totals.amount document.currency}}` | `Одна тысяча … сум 38 тийин` |
| `formatAmountWithWords` | `{{formatAmountWithWords totals.amount document.currency}}` | `1 296.38 (…words…) сум` |
| `eq` | `{{#if (eq kind "return")}}…{{/if}}` | Boolean comparison |
| `gt` | `{{#if (gt sale.discount 0)}}…{{/if}}` | Greater than |
| `add` | `{{add @index 1}}` or `{{totals.amount + sale.discount}}` | Addition (e.g. row numbers) |
| `sub` | `{{sub (mul price2 quantity) amount}}` or `{{price2 * quantity - amount}}` | Subtraction |
| `mul` | `{{mul price2 quantity}}` or `{{price2 * quantity}}` | Multiplication |
| `div` | `{{div amount quantity}}` or `{{amount / quantity}}` | Division (divisor `0` → `0`) |
| `logoImg` | `{{logoImg "Primary"}}` or `{{logoImg "Stamp" 80}}` | Renders an `<img>` for the named logo; optional second argument overrides max width (px) |

### Arithmetic in `{{...}}`

You can write simple math directly inside tags. The engine converts it to helpers before rendering:

| Template syntax | Rendered as |
|-----------------|-------------|
| `{{price2 * quantity}}` | `{{(mul price2 quantity)}}` |
| `{{price2 * quantity - amount}}` | `{{(sub (mul price2 quantity) amount)}}` |
| `{{formatCurrency price2 * quantity}}` | `{{formatCurrency (mul price2 quantity)}}` |
| `{{totals.amount_gross}}` | `{{formatCurrency totals.amount_gross}}` |
| `{{totals.discount}}` | `{{formatCurrency totals.discount}}` |

Supported operators: `+`, `-`, `*`, `/` with normal precedence (`*` and `/` before `+` and `-`). Use parentheses when needed. Identifiers can include dots (`sale.total`, `totals.amount`). Block helpers (`{{#if}}`, `{{#each}}`) and existing helper calls like `{{add @index 1}}` are left unchanged.

---

## Amount in words

Enable in template settings: **Total amount in words (language)** → Russian, Uzbek, English, or Tajik.

| Variable | Based on | Example (RU, UZS) |
|----------|----------|-------------------|
| `{{total_in_words}}` | `totals.amount` + `document.currency` | `Одна тысяча двести девяносто шесть сум 38 тийин` |
| `{{total_with_words}}` | same | `1 296.38 (Одна тысяча …) сум` |
| `{{sale.total_in_words}}` | `sale.total` + `sale.saleCurrency` | POS total in words |

Currency unit names are resolved from `document.currency` / payment currency:

| Code | Russian major / minor |
|------|------------------------|
| UZS / сум | сум / тийин |
| USD | доллар / цент |
| EUR | евро / цент |
| RUB | рубль / копейка |
| Other | `code_chr` + generic minor unit |

Example footer:

```handlebars
<div class="footer-total">
  Итого: {{formatCurrency totals.amount}} ({{total_in_words}}){{#if document.currency.code_chr}} {{document.currency.code_chr}}{{/if}}
</div>
```

If language is **Off**, word variables render as empty strings.

---

## Page size, margins, fonts, and layout

### 80mm thermal receipt

Recommended CSS:

```css
@page {
  size: 80mm auto;   /* 80 mm width, height grows with content */
  margin: 4mm;
}

.receipt {
  font-family: "Menlo", "Courier New", monospace;
  font-size: 11px;
  width: 72mm;       /* printable area inside margins */
  color: #000;
  line-height: 1.3;
}
```

Guidelines:

- Keep content width ≤ **72 mm** inside 4 mm margins
- Use **monospace** fonts for aligned columns on thermal printers
- Prefer `px` or `mm` for predictable print
- Avoid large images; they may not print on thermal devices
- Test on target printer; browser print scaling varies

### A4 invoice

Recommended CSS:

```css
@page {
  size: A4 portrait;
  margin: 10mm 8mm;
}

.invoice {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 11px;
  color: #000;
  line-height: 1.25;
}
```

Guidelines:

- Full width tables: `width: 100%; table-layout: fixed;`
- Use `border-collapse: collapse` for grid tables
- Numeric columns: `text-align: right; white-space: nowrap;`
- Long product names: `word-break: break-word;`

### Text alignment

Standard CSS applies:

```css
.text-left   { text-align: left; }
.text-center { text-align: center; }
.text-right  { text-align: right; }
.num         { text-align: right; font-variant-numeric: tabular-nums; }
```

### Spacing

```css
.section { margin-bottom: 8px; }
.row     { display: flex; justify-content: space-between; padding: 2px 0; }
hr       { border: none; border-top: 1px dashed #999; margin: 8px 0; }
```

---

## Displaying document sections

### Company information

From template `header` (configured in settings, not from Regos API):

```handlebars
<div class="company">
  {{logoImg "Primary"}}
  <strong>{{header.company_name}}</strong><br />
  {{header.address}}<br />
  {{header.phone}}{{#if header.tax_id}} · INN {{header.tax_id}}{{/if}}
</div>
```

Built-in layouts render all configured logos above the company name automatically — no extra markup required.

### Customer / partner

```handlebars
<div class="buyer">
  <span class="label">Customer:</span> {{document.partner_name}}
  {{#if document.partner_phone}}
  <br /><span class="label">Phone:</span> {{document.partner_phone}}
  {{/if}}
</div>
```

Also available: `{{partner_name}}`, `{{document.stock_name}}` / `{{stock_name}}` for warehouse.

### Cashier and document meta

```handlebars
<div class="meta">
  #{{document.code}} · {{formatRegosDate document.date}}
  <br />Cashier: {{document.attached_user_name}}
  {{#if stock_name}}<br />Warehouse: {{stock_name}}{{/if}}
</div>
```

### Products — flat list

```handlebars
{{#each operations}}
<div class="line">
  <div>{{item_name}}</div>
  <div>{{quantity}} × {{formatCurrency price}} = {{formatCurrency amount}}</div>
</div>
{{/each}}
```

### Products — grouped table (накладная style)

See [Example: A4 grouped invoice](#example-a4-grouped-invoice-json-import) below.

### Subtotal, discount, tax, total

```handlebars
{{#if (gt sale.discount 0)}}
<div class="row">
  <span>Discount</span>
  <span>−{{formatCurrency sale.discount}}</span>
</div>
{{/if}}

{{#if (gt sale.tax 0)}}
<div class="row">
  <span>Tax</span>
  <span>{{formatCurrency sale.tax}}</span>
</div>
{{/if}}

<div class="row total">
  <span>Total</span>
  <span>{{formatCurrency totals.amount}}{{#if document.currency.code_chr}} {{document.currency.code_chr}}{{/if}}</span>
</div>
```

> `sale.tax` and `sale.discount` come from the POS sale object. Line-level tax is not available in the print context.

### Payment details

```handlebars
{{#each payments}}
<div class="row">
  <span>{{payment_type_name}}</span>
  <span>{{formatCurrency amount}}{{#if currency.code_chr}} {{currency.code_chr}}{{/if}}</span>
</div>
{{/each}}
```

Single payment from POS:

```handlebars
<div class="row">
  <span>Payment</span>
  <span>{{sale.paymentTypeName}}</span>
</div>
<div class="row">
  <span>Paid</span>
  <span>{{formatCurrency sale.amountPaid}}</span>
</div>
```

### Returns

```handlebars
{{#if (eq kind "return")}}
<h1>RETURN {{document.code}}</h1>
{{#if document.reason}}<p>Reason: {{document.reason}}</p>{{/if}}
{{/if}}
```

---

## Line item sorting

Configure in template settings (applies before render):

```json
"line_sort": {
  "column": "item_name",
  "direction": "asc"
}
```

Sorting affects `operations`, `operation_groups`, and rebuilt `sale.items`. Default is document order (`document_order`).

---

## Logos

### Setup in the UI

1. Open **Settings → Receipt templates**
2. Create or edit a template
3. In the editor **Settings** tab, scroll to **Logos**
4. Click **Add logo** and select one or more image files (PNG, JPEG, GIF, WebP, SVG)
5. For each logo, set:
   - **Logo name** — used to reference the logo in HTML (`{{logoImg "Name"}}`)
   - **Max width (px)** — optional; limits print/preview size
6. Save the template

Limits:

| Limit | Value |
|-------|-------|
| Logos per template | 10 |
| Max size per logo | 200 KB (as stored `data:` URL) |
| Allowed formats | PNG, JPEG, GIF, WebP, SVG |
| Logo names | Must be unique (case-insensitive) |

### Built-in layouts

When `sections.header` is enabled, all logos are shown above the company name:

- **80mm receipt** — centered row
- **A4 invoice** — row above seller details

### HTML templates

**By name** (recommended):

```handlebars
<div class="header-logos">
  {{logoImg "Primary"}}
  {{logoImg "Partner badge" 64}}
</div>
```

`logoImg` renders a safe `<img>` tag using the logo's `src` and `max_width`. The optional second argument sets width for that placement only.

**Loop all logos:**

```handlebars
<div class="logos">
  {{#each logos}}
  <img src="{{src}}" alt="{{name}}"{{#if max_width}} style="max-width:{{max_width}}px;height:auto;"{{/if}} />
  {{/each}}
</div>
```

### Import / export

Logos are stored inline in the template JSON under `logos`:

```json
"logos": [
  {
    "id": "a1b2c3d4-...",
    "name": "Primary",
    "src": "data:image/png;base64,iVBORw0KGgo...",
    "max_width": 120
  },
  {
    "id": "e5f6g7h8-...",
    "name": "Stamp",
    "src": "data:image/png;base64,...",
    "max_width": null
  }
]
```

Exported JSON files can be large when logos are included. Re-import on another company via **Import template**.

### Print tips

- Prefer PNG or JPEG for thermal printers; SVG may not print reliably on all devices
- Keep `max_width` modest on 80mm receipts (e.g. 80–120 px)
- Test on the target printer; browser print scaling varies

---

## Conditional blocks and loops

Standard [Handlebars block helpers](https://handlebarsjs.com/guide/block-helpers.html) are supported.

### Conditionals

```handlebars
{{#if document.partner_phone}}
  Phone: {{document.partner_phone}}
{{/if}}

{{#unless footer_text}}
  <!-- no footer -->
{{/unless}}
```

With subexpressions (requires `eq` / `gt` helpers):

```handlebars
{{#if (eq kind "return")}}
  RETURN DOCUMENT
{{else}}
  SALE DOCUMENT
{{/if}}
```

### Loops

```handlebars
{{#each operations}}
  {{@index}} — {{item_name}}
{{/each}}

{{#each operation_groups}}
  <h3>{{name}}</h3>
  {{#each lines}}
    <div>{{item_name}}</div>
  {{/each}}
{{/each}}
```

Inside nested loops, `{{@index}}` is 0-based. Use `{{add @index 1}}` for 1-based row numbers.

---

## Barcode and QR codes

**Not supported natively.** The template engine does not provide:

- Barcode or QR generation helpers
- Product barcode fields on `operations` lines
- Built-in encoding libraries

Workarounds (use with caution):

- Static images via `<img src="https://...">` may work in some browsers but are **not recommended** (external URLs, print reliability, security policy).
- For barcode printing, use a dedicated label printer integration outside this template system.

If barcode support is required in templates, it must be added as a product feature first.

---

## Security and validation rules

Templates are sanitized on save (frontend and backend).

### HTML — forbidden content

| Rule | Example |
|------|---------|
| No `<script>` tags | `<script>…</script>` |
| No `javascript:` URLs | `<a href="javascript:…">` |
| No `vbscript:` URLs | |
| No `data:text/html` URLs | |
| No `<iframe>`, `<object>`, `<embed>`, `<link>`, `<base>`, `<form>`, `<meta>` | |
| No inline event handlers | `<div onclick="…">` |
| No CSS `expression()` | IE-era XSS vector |

### CSS — forbidden content

| Rule | Example |
|------|---------|
| No `@import` | `@import url("…")` |
| No `javascript:` URLs | |
| No `expression()` | |
| No `behavior:` | |

### Size limits

| Field | Max size |
|-------|----------|
| `html` | 50 000 bytes (UTF-8) |
| `css` | 20 000 bytes (UTF-8) |
| Each logo `src` | 200 000 bytes (UTF-8) |
| Logos per template | 10 |

### Logo validation

| Rule | Example |
|------|---------|
| `src` must be `data:image/png`, `jpeg`, `gif`, `webp`, or `svg+xml` | ✓ |
| No `data:text/html` or other non-image data URLs | ✗ |
| Logo names unique within template | ✗ duplicate `"Primary"` |

### Other rules

- `engine: "html"` requires non-empty `html`
- `format` must be exactly `"80mm"` or `"a4"`
- `name` is required and must be non-empty
- Template `id` values must be unique within a company
- `amount_in_words_language` must be `ru`, `uz`, `en`, `tj`, or `null`

---

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Using `{{total_in_words}}` with language set to **Off** | Enable language in template settings |
| Expecting `{{total_in_words}}` at root before the feature existed | Use `{{total_in_words}}` (root) or `{{totals.total_in_words}}`; ensure latest app version |
| Using `sale.total` when reprinting wholesale docs | Prefer `totals.amount` + `document.currency` |
| Wrong date format | `document.date` is Unix **seconds** → use `{{formatRegosDate document.date}}`; `sale.createdAt` is ISO → use `{{formatDateTime sale.createdAt}}` |
| Missing `formatCurrency` on numbers | Raw numbers print as `1296.38` without spacing; use `{{formatCurrency amount}}` |
| Forgetting `{{#each}}` wrapper | Inside loops, reference `{{item_name}}` not `{{operations.item_name}}` |
| Setting `engine: "builtin"` in JSON import | Built-in templates ignore `html`/`css`; use `"engine": "html"` for custom markup |
| Content wider than 80mm | Keep `.receipt { width: 72mm; }` and test print |
| Including `<script>` or `@import` | Save will fail validation |
| Expecting per-line tax or barcode | Not in print context; only `sale.tax` aggregate |
| HTML over 50 KB | Split content or simplify tables/images |
| Logo over 200 KB or more than 10 logos | Resize/compress images before upload |
| Duplicate logo names | Each logo `name` must be unique (case-insensitive) |

---

## Complete examples

### Example: 80mm thermal receipt (JSON import)

Save as `my-80mm-receipt.json` and import via **Settings → Receipt templates → Import template**.

```json
{
  "version": 1,
  "template": {
    "name": "Simple 80mm Receipt",
    "format": "80mm",
    "engine": "html",
    "header": {
      "company_name": "Regos Optom",
      "address": "123 Market Street",
      "phone": "+998 90 000 00 00",
      "tax_id": ""
    },
    "invoice_title": "",
    "footer_text": "Thank you for your purchase!",
    "amount_in_words_language": null,
    "sections": {
      "header": true,
      "meta": true,
      "partner": false,
      "items": true,
      "subtotal": true,
      "discount": true,
      "total": true,
      "payments": true,
      "tendered_change": true,
      "balance_due": true,
      "closed_without_payment": true,
      "footer": true
    },
    "line_sort": { "column": "document_order", "direction": "asc" },
    "html": "<div class=\"receipt\">\n  <div class=\"center\"><strong>{{header.company_name}}</strong></div>\n  <div class=\"center muted\">{{header.address}}</div>\n  <div class=\"center muted\">{{header.phone}}</div>\n  <div class=\"center meta\">#{{document.code}} · {{formatDateTime sale.createdAt}}</div>\n  <div class=\"center meta\">Cashier: {{document.attached_user_name}}</div>\n  <hr />\n  {{#each operations}}\n  <div class=\"line\">\n    <div class=\"name\">{{item_name}}</div>\n    <div class=\"qty\">{{quantity}} × {{formatCurrency price}} = {{formatCurrency amount}}</div>\n  </div>\n  {{/each}}\n  <hr />\n  {{#if (gt sale.discount 0)}}\n  <div class=\"row\"><span>Discount</span><span>−{{formatCurrency sale.discount}}</span></div>\n  {{/if}}\n  <div class=\"row total\"><span>TOTAL</span><span>{{formatCurrency totals.amount}}</span></div>\n  {{#each payments}}\n  <div class=\"row\"><span>{{payment_type_name}}</span><span>{{formatCurrency amount}}</span></div>\n  {{/each}}\n  <div class=\"center thanks\">{{footer_text}}</div>\n</div>",
    "css": "@page { size: 80mm auto; margin: 4mm; }\n.receipt { font-family: Menlo, \"Courier New\", monospace; font-size: 11px; width: 72mm; color: #000; }\n.center { text-align: center; }\n.muted { color: #555; font-size: 10px; }\n.meta { margin: 4px 0 8px; font-size: 10px; }\n.line { margin: 4px 0; }\n.name { font-weight: 600; }\n.qty { font-size: 10px; color: #333; }\n.row { display: flex; justify-content: space-between; padding: 2px 0; }\n.total { font-weight: 700; font-size: 13px; margin-top: 4px; }\n.thanks { margin-top: 10px; }\nhr { border: none; border-top: 1px dashed #999; margin: 8px 0; }"
  }
}
```

### Example: A4 grouped invoice (JSON import)

Based on the bundled **Накладная** starter template with amount in words:

```json
{
  "version": 1,
  "template": {
    "name": "A4 Waybill with Total in Words",
    "format": "a4",
    "engine": "html",
    "header": {
      "company_name": "My Company",
      "address": "",
      "phone": "",
      "tax_id": ""
    },
    "invoice_title": "НАКЛАДНАЯ",
    "footer_text": "",
    "amount_in_words_language": "ru",
    "sections": {
      "header": true,
      "meta": true,
      "partner": true,
      "items": true,
      "subtotal": true,
      "discount": true,
      "total": true,
      "payments": true,
      "tendered_change": true,
      "balance_due": true,
      "closed_without_payment": true,
      "footer": true
    },
    "line_sort": { "column": "item_name", "direction": "asc" },
    "html": "<div class=\"nakladnaya\">\n  <h1 class=\"doc-title\">\n    {{#if (eq kind \"return\")}}\n    ВОЗВРАТНАЯ НАКЛАДНАЯ № {{document.code}} от {{formatRegosDate document.date}} г.\n    {{else}}\n    НАКЛАДНАЯ № {{document.code}} от {{formatRegosDate document.date}} г.\n    {{/if}}\n  </h1>\n  <div class=\"buyer-block\">\n    <div class=\"buyer-line\"><span class=\"label\">Покупатель:</span> {{document.partner_name}}</div>\n    {{#if document.partner_phone}}\n    <div class=\"buyer-line\"><span class=\"label\">Телефоны:</span> {{document.partner_phone}}</div>\n    {{/if}}\n  </div>\n  <table class=\"items-table\">\n    <thead>\n      <tr>\n        <th>№</th><th>Код</th><th>Наименование</th><th>Ед</th><th>Кол-во</th><th>Цена</th><th>Сумма</th>\n      </tr>\n    </thead>\n    <tbody>\n      {{#each operation_groups}}\n      <tr class=\"group-header\"><td colspan=\"7\">{{name}}</td></tr>\n      {{#each lines}}\n      <tr>\n        <td class=\"num\">{{add @index 1}}</td>\n        <td class=\"num\">{{item_code}}</td>\n        <td>{{item_name}}</td>\n        <td>{{item_unit_name}}</td>\n        <td class=\"num\">{{quantity}}</td>\n        <td class=\"num\">{{formatCurrency price}}</td>\n        <td class=\"num\">{{formatCurrency amount}}</td>\n      </tr>\n      {{/each}}\n      {{/each}}\n      <tr class=\"grand-total\">\n        <td colspan=\"4\">Всего:</td>\n        <td class=\"num\">{{totals.quantity}}</td>\n        <td></td>\n        <td class=\"num\">{{formatCurrency totals.amount}}</td>\n      </tr>\n    </tbody>\n  </table>\n  <div class=\"footer-total\">\n    Итого: {{formatCurrency totals.amount}} ({{total_in_words}}){{#if document.currency.code_chr}} {{document.currency.code_chr}}{{/if}}\n  </div>\n</div>",
    "css": "@page { size: A4 portrait; margin: 10mm 8mm; }\n.nakladnaya { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; line-height: 1.25; }\n.doc-title { text-align: center; font-size: 14px; font-weight: 700; margin: 0 0 10px; text-transform: uppercase; }\n.buyer-block { margin-bottom: 8px; }\n.buyer-line { margin: 2px 0; }\n.buyer-line .label { font-weight: 700; }\n.items-table { width: 100%; border-collapse: collapse; table-layout: fixed; }\n.items-table th, .items-table td { border: 1px solid #000; padding: 3px 4px; }\n.items-table thead th { text-align: center; font-weight: 700; }\n.group-header td { font-weight: 700; background: #f5f5f5; }\n.grand-total td { font-weight: 700; border-top-width: 2px; }\n.num { text-align: right; white-space: nowrap; }\n.footer-total { margin-top: 8px; font-weight: 700; }"
  }
}
```

### Example: HTML + CSS as separate files (developer workflow)

For local editing, keep two files and paste into the editor tabs:

**`waybill.html`**

```html
<div class="doc">
  <h1>{{invoice_title}} № {{document.code}}</h1>
  <p>Date: {{formatRegosDate document.date}}</p>
  <p>Buyer: {{document.partner_name}}</p>
  <table>
    <thead>
      <tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr>
    </thead>
    <tbody>
      {{#each operations}}
      <tr>
        <td>{{item_name}}</td>
        <td>{{quantity}}</td>
        <td>{{formatCurrency price}}</td>
        <td>{{formatCurrency amount}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>
  <p><strong>Total: {{formatAmountWithWords totals.amount document.currency}}</strong></p>
</div>
```

**`waybill.css`**

```css
@page { size: A4 portrait; margin: 12mm; }
.doc { font-family: Arial, sans-serif; font-size: 11px; }
h1 { font-size: 16px; text-align: center; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { border: 1px solid #333; padding: 4px 6px; }
th { background: #f0f0f0; }
td:nth-child(n+2) { text-align: right; }
```

Then wrap in import JSON or paste into the template editor.

---

## Workflow checklist

1. Choose format: `80mm` or `a4`
2. Set `engine` to `html` (or use built-in for standard layouts)
3. Fill `header`, `footer_text`, optional `amount_in_words_language`
4. Upload logos under **Logos** if needed (see [Logos](#logos))
5. Write Handlebars `html` using variables from [Available variables](#available-variables)
6. Add `css` with correct `@page` size
7. Validate against [Security rules](#security-and-validation-rules)
8. Preview in template editor
9. Export JSON for backup or deployment to another company
10. Import JSON on target system → Save → Set as default if needed

---

## Reference: bundled starter files

The repository includes a reference A4 накладная template:

- `frontend/src/templates/receipts/nakladnaya/template.html`
- `frontend/src/templates/receipts/nakladnaya/template.css`

Load it in the editor via **Load starter template** when creating an A4 HTML template.

---

## API endpoints (for integrators)

| Method | Path | Permission |
|--------|------|------------|
| `GET` | `/api/v1/company/settings/receipt-templates` | Authenticated user |
| `PATCH` | `/api/v1/company/settings/receipt-templates` | `settings.manage` |

PATCH body:

```json
{
  "templates": [ /* ReceiptTemplate[] */ ],
  "default_template_id": "uuid-or-null"
}
```

---

*Last updated for Regos Optom receipt template version 1.*
