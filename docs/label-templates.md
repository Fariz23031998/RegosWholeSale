# Label Template Guide

This document describes how to create, edit, import, and maintain **product label templates** in **Regos Optom**. It is written for AI assistants (and developers) that need to produce working HTML/CSS label designs.

---

## Table of contents

1. [Overview](#overview)
2. [Where to edit](#where-to-edit)
3. [Template fields](#template-fields)
4. [Import / export file format](#import--export-file-format)
5. [HTML structure](#html-structure)
6. [CSS rules](#css-rules)
7. [Placeholders](#placeholders)
8. [Helpers](#helpers)
9. [Barcode, QR, and product images](#barcode-qr-and-product-images)
10. [Company logos](#company-logos)
11. [Rendering pipeline notes](#rendering-pipeline-notes)
12. [Security and validation rules](#security-and-validation-rules)
13. [Common mistakes](#common-mistakes)
14. [Complete examples](#complete-examples)

---

## Overview

Label templates control how a **single product sticker** is rendered for preview and printing (browser print or Windows Print Service).

Each template stores:

| Field | Meaning |
|-------|---------|
| `name` | Display name in Settings |
| `paper.width_mm` / `paper.height_mm` | Physical label size in millimeters |
| `html` | Full HTML document (or body markup) with `{{ placeholders }}` |
| `css` | Separate stylesheet injected into `<head>` at render time |
| `logos` | Uploaded company logos (`data:image/...`) for `{{logoImg}}` |
| `is_default` | Company default template |
| `version` | Auto-bumped when paper/html/css/logos change |

Templates live under **Settings → Label templates**. Default seed size is **58×40 mm**.

Rendering fills one label per product row. Placeholders use Handlebars-style double braces. Values are HTML-escaped (triple-stash / `{{& }}` are forced to escaped output).

---

## Where to edit

1. Open **Settings → Label templates**
2. Click **New template**, **Edit**, or **Import**
3. In the editor set **Name**, **Width (mm)**, **Height (mm)**
4. Optionally upload **Logos** (company images) and reference them with `{{logoImg "Name"}}`
5. Switch between **HTML** and **CSS** tabs
6. Use **Preview** on the right (sample product data, including a sample product photo)
7. Click **Save template**

Paper size range: **1–500 mm** on each side. Name is required (max 120 chars). HTML is required.

---

## Template fields

```ts
type LabelTemplateLogo = {
  id: string;
  name: string;
  src: string; // data:image/... only
  max_width: number | null;
};

type LabelTemplate = {
  id: string;
  name: string;
  is_default: boolean;
  paper: { width_mm: number; height_mm: number };
  html: string;
  css: string;
  logos: LabelTemplateLogo[];
  version: number;
};
```

When designing a label:

1. Set `paper` to the real sticker size (e.g. `58×30`, `58×40`, `63×30`).
2. Make `.label` (or the root layout box) use the **same** `width` / `height` in `mm` as `paper`.
3. Prefer `box-sizing: border-box` and small `mm` paddings so content fits thermal printers.
4. Keep text black and high-contrast; browser print forces black ink on sheets.

---

## Import / export file format

### Export

Settings → Label templates → **Export** downloads:

```json
{
  "version": 1,
  "template": {
    "id": "...",
    "name": "58x30 mm label",
    "is_default": false,
    "paper": { "width_mm": 58, "height_mm": 30 },
    "html": "<!DOCTYPE html>...",
    "css": "html, body { ... }",
    "logos": [],
    "version": 1
  }
}
```

### Import

**Import** expects the same shape. Required on `template`: `name` (string) and `html` (string). Missing `css` becomes `""`. Missing `logos` becomes `[]`. Missing paper falls back to **58×40**. Import always creates a **new** id (`is_default: false`).

**AI agents producing a deliverable file should emit this JSON**, not a bare HTML file.

---

## HTML structure

Recommended shape (matches the built-in default):

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
</head>
<body>
  <div class="label">
    <div class="name">{{ name }}</div>
    <div class="price">{{ price }} {{ currency }}</div>
    <div class="row">
      <img class="barcode" src="{{ barcode_src }}" alt="" />
      <div class="code">{{ barcode }}</div>
    </div>
  </div>
</body>
</html>
```

Rules for agents:

- Put layout markup in **HTML**; put styling in the **CSS** field (preferred), not only inline `<style>` tags.
- Use a single root container (e.g. `.label`) sized to the paper.
- Use `{{ barcode_src }}` / `{{ qr_src }}` / `{{ image_src }}` only as `img` `src` values.
- Use `{{logoImg "Name"}}` for uploaded company logos (do not paste remote logo URLs into the template).
- Do not add `<script>`, forms, iframes, or event handlers (rejected on save).
- Keep HTML under **50 KB** UTF-8 (logos are stored separately and do not count toward this limit).

At print time the engine takes the `<body>` contents (or the whole string if there is no `<body>`), substitutes placeholders, and wraps each product in `<section class="label-sheet">…</section>` with `@page` size from `paper`.

---

## CSS rules

Put styles in the template `css` field. They are inserted before `</head>` (or prepended if there is no `</head>`).

Guidelines:

- Size with **`mm`**, not `px`, for the outer label box.
- Match paper: if `paper` is `63×30`, set `.label { width: 63mm; height: 30mm; }`.
- Use `overflow: hidden` on the root so long names do not spill onto the next sticker.
- Prefer simple flex/column layouts; avoid absolute positioning unless necessary.
- Do not close a `</style>` tag inside the CSS string (validation error).
- CSS also has a **50 KB** limit.

Default CSS pattern:

```css
html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
.label {
  box-sizing: border-box;
  width: 58mm;
  height: 40mm;
  padding: 2mm;
  display: flex;
  flex-direction: column;
}
.name { font-size: 11px; font-weight: 700; line-height: 1.2; max-height: 2.4em; overflow: hidden; }
.price { font-size: 16px; font-weight: 700; margin-top: 1mm; }
.row { display: flex; align-items: center; gap: 2mm; margin-top: auto; }
.code { font-size: 9px; }
img.barcode { height: 12mm; width: auto; }
```

---

## Placeholders

Syntax: `{{ name }}` or `{{name}}` (spaces optional). Only these fields are filled from product data:

| Placeholder | Source | Notes |
|-------------|--------|-------|
| `{{ name }}` | Product name | Escaped text |
| `{{ price }}` | Product price | Plain number string (`12000` or `12000.50`) |
| `{{ current_price }}` | Current price from price log when available | Same format as `price` |
| `{{ old_price }}` | Previous / strikethrough price when available | Same format as `price` |
| `{{ currency }}` | Currency code/name (e.g. `UZS`) | |
| `{{ barcode }}` | First non-empty of barcode, code, sku, articul | Text under/near barcode |
| `{{ code }}` | Product code | |
| `{{ articul }}` | Article | |
| `{{ sku }}` | SKU | |
| `{{ category }}` | Category name | |
| `{{ unit_name }}` | Unit (e.g. `pcs`) | |
| `{{ barcode_src }}` | PNG data URI of barcode image | Use in `<img src="...">` |
| `{{ qr_src }}` | PNG data URI of QR image | Use in `<img src="...">` |
| `{{ image_src }}` | Product photo URL from catalog | `http(s)://` or `data:image/` only; empty if missing/unsafe |

Unknown placeholders render as empty string.

Sample preview row used by the editor:

| Field | Sample |
|-------|--------|
| name | `Sample product` |
| price / current_price | `12000` |
| old_price | `15000` |
| currency | `UZS` |
| barcode | `4006381333931` |
| code | `1001` |
| articul / sku | `ART-1` |
| category | `Grocery` |
| unit_name | `pcs` |
| image_src | small sample `data:image/svg+xml,...` |

---

## Helpers

Helpers are available in the **frontend** Handlebars engine (editor preview, browser print, and Print Service `html_pages` path).

### `formatNumber`

```handlebars
{{formatNumber price}}
```

- Groups thousands with spaces: `123456` → `123 456`
- Rounds to 2 decimals; drops `.00`: `123000.23433` → `123 000.23`
- Empty / non-numeric → `""`

Useful for display prices. Raw `{{ price }}` stays ungrouped.

### `numberPart`

```handlebars
{{numberPart price 0 3}}
{{numberPart price 3 6}}
{{numberPart price -3}}
```

- Works on the **absolute truncated whole-number digits** (decimals stripped, not rounded).
- `start` / `end` are string slice indexes (same idea as `String.slice`).
- Omitting a usable `end` (or passing only start) slices from `start` to the end of the digit string.
- Example: `123000.23` → digits `123000`  
  - `{{numberPart price 0 3}}` → `123`  
  - `{{numberPart price 3 6}}` → `000`  
  - `{{numberPart price -3}}` → `000`

Use this to split large prices across styled spans (e.g. large leading digits, small trailing zeros).

### `logoImg`

```handlebars
{{logoImg "Primary"}}
{{logoImg "Stamp" 48}}
```

- Looks up a logo uploaded on the template by **name** (case-insensitive) or `id`.
- Optional second argument overrides max width in **px** for that placement.
- Emits a safe `<img>` (or nothing if the logo is missing).
- Logo `src` values are always inline `data:image/...` stored on the template.

---

## Barcode, QR, and product images

- `barcode_src` / `qr_src` are `data:image/png;base64,...` URIs generated from the barcode text.
- `image_src` is the catalog product photo (`product.image` from Regos), sanitized to `http://`, `https://`, or `data:image/` only.

```html
<img class="barcode" src="{{ barcode_src }}" alt="" />
<img class="qr" src="{{ qr_src }}" alt="" />
<img class="product" src="{{ image_src }}" alt="" />
```

- Constrain heights in CSS (`height: 10mm–14mm; width: auto`) so symbols and photos fit the sticker.
- Prefer `img.product[src=""] { display: none; }` if you want to hide missing product photos.
- Do not invent external barcode URLs; use the provided data URIs.
- Product photos stay as remote URLs when Regos provides `https://…` (Print Service loads them with network idle). Logos should be uploaded (inline), not remote.

---

## Company logos

1. In the label editor, use **Add logo** and upload PNG/JPEG/GIF/WebP/SVG (max **200 KB** each, max **10** logos).
2. Set a unique **Logo name** (used by `{{logoImg "Name"}}`).
3. Optional **Max width (px)** per logo.
4. In HTML:

```html
<div class="brand">{{logoImg "Primary"}}</div>
```

```css
.brand img { max-height: 8mm; width: auto; }
```

Logos are included in export/import JSON under `template.logos`.

---

## Rendering pipeline notes

| Path | Behavior |
|------|----------|
| Editor preview / browser print / Print Service pages | Handlebars + helpers (`formatNumber`, `numberPart`, `logoImg`); CSS injected; logos on template context; each product → `.label-sheet` at `paper` size |
| Print Service protocol templates | Composed HTML (`html` + injected `css`); paper as `widthMm` / `heightMm` |
| Backend placeholder expand | Simple `{{ token }}` replace for some server paths — `image_src` works there; `logoImg` does not (use frontend-rendered `html_pages`) |

For agent-authored templates: stick to listed placeholders + `formatNumber` / `numberPart` / `logoImg`, and keep CSS in the `css` field.

Company limits: max **50** templates; HTML/CSS each ≤ **50 KB**; logos ≤ **200 KB** each (max **10**).

---

## Security and validation rules

Rejected on save if present in HTML (or unsafe CSS):

- `<script>`
- `javascript:` / `vbscript:` URLs
- `data:text/html`
- `<iframe>`, `<object>`, `<embed>`, `<link>`, `<base>`, `<form>`
- Inline `on*=` handlers
- CSS `expression(`
- `</style>` inside the CSS field

Product text is escaped. Do not rely on raw HTML injection from placeholders.

---

## Common mistakes

1. **Paper vs CSS mismatch** — `paper` is `58×30` but `.label` is still `58mm × 40mm`.
2. **Using `px` for the outer box** — prefer `mm` for sticker dimensions.
3. **Putting barcode text in `src`** — use `{{ barcode_src }}`, not `{{ barcode }}`.
4. **Assuming helpers on every backend path** — `logoImg` needs frontend-rendered pages; `image_src` works as a plain placeholder.
5. **Hard-coding remote logo URLs** — upload logos on the template and use `{{logoImg "Name"}}`; use `{{ image_src }}` for product photos.
6. **Overflow** — long `{{ name }}` without `overflow: hidden` / line clamp spills off the label.
7. **Exporting only HTML** — deliver `{ "version": 1, "template": { ... } }` JSON for Import (include `logos` when used).

---

## Complete examples

### 1) Default-style 58×40 mm

**JSON (importable):**

```json
{
  "version": 1,
  "template": {
    "name": "58x40 mm label",
    "is_default": false,
    "paper": { "width_mm": 58, "height_mm": 40 },
    "html": "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\" />\n</head>\n<body>\n  <div class=\"label\">\n    <div class=\"name\">{{ name }}</div>\n    <div class=\"price\">{{formatNumber price}} {{ currency }}</div>\n    <div class=\"row\">\n      <img class=\"barcode\" src=\"{{ barcode_src }}\" alt=\"\" />\n      <div class=\"code\">{{ barcode }}</div>\n    </div>\n  </div>\n</body>\n</html>",
    "css": "html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; }\n.label { box-sizing: border-box; width: 58mm; height: 40mm; padding: 2mm; display: flex; flex-direction: column; }\n.name { font-size: 11px; font-weight: 700; line-height: 1.2; max-height: 2.4em; overflow: hidden; }\n.price { font-size: 16px; font-weight: 700; margin-top: 1mm; }\n.row { display: flex; align-items: center; gap: 2mm; margin-top: auto; }\n.code { font-size: 9px; }\nimg.barcode { height: 12mm; width: auto; }",
    "logos": [],
    "version": 1
  }
}
```

### 2) Compact 58×30 mm with split price digits

**HTML:**

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
</head>
<body>
  <div class="label">
    <div class="name">{{ name }}</div>
    <div class="price">
      <span class="price-main">{{numberPart price 0 -3}}</span><span class="price-tail">{{numberPart price -3}}</span>
      <span class="currency">{{ currency }}</span>
    </div>
    <div class="meta">{{ articul }} · {{ unit_name }}</div>
    <div class="row">
      <img class="barcode" src="{{ barcode_src }}" alt="" />
      <div class="code">{{ barcode }}</div>
    </div>
  </div>
</body>
</html>
```

**CSS:**

```css
html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
.label {
  box-sizing: border-box;
  width: 58mm;
  height: 30mm;
  padding: 1.5mm;
  display: flex;
  flex-direction: column;
}
.name { font-size: 10px; font-weight: 700; line-height: 1.15; max-height: 2.3em; overflow: hidden; }
.price { margin-top: 0.5mm; font-weight: 700; line-height: 1; }
.price-main { font-size: 18px; }
.price-tail { font-size: 12px; }
.currency { font-size: 10px; margin-left: 1mm; font-weight: 600; }
.meta { font-size: 8px; margin-top: 0.5mm; }
.row { display: flex; align-items: center; gap: 1.5mm; margin-top: auto; }
.code { font-size: 8px; }
img.barcode { height: 9mm; width: auto; }
```

Set `paper` to `{ "width_mm": 58, "height_mm": 30 }` when packaging the import JSON.

### 3) Promo label with product photo, logo, old / current price + QR

```html
<div class="label">
  <div class="brand">{{logoImg "Primary"}}</div>
  <div class="media">
    <img class="product" src="{{ image_src }}" alt="" />
    <div class="info">
      <div class="name">{{ name }}</div>
      <div class="prices">
        <span class="old">{{formatNumber old_price}}</span>
        <span class="now">{{formatNumber current_price}} {{ currency }}</span>
      </div>
    </div>
  </div>
  <div class="codes">
    <img class="barcode" src="{{ barcode_src }}" alt="" />
    <img class="qr" src="{{ qr_src }}" alt="" />
  </div>
  <div class="code">{{ barcode }}</div>
</div>
```

```css
html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
.label { box-sizing: border-box; width: 58mm; height: 40mm; padding: 2mm; }
.brand img { max-height: 6mm; width: auto; }
.media { display: flex; gap: 2mm; margin-top: 1mm; }
img.product { height: 12mm; width: 12mm; object-fit: cover; }
img.product[src=""] { display: none; }
.name { font-size: 10px; font-weight: 700; max-height: 2.4em; overflow: hidden; }
.old { text-decoration: line-through; font-size: 9px; margin-right: 1mm; }
.now { font-size: 14px; font-weight: 700; }
.codes { display: flex; align-items: center; gap: 2mm; margin-top: 2mm; }
img.barcode { height: 9mm; width: auto; }
img.qr { height: 9mm; width: 9mm; }
.code { font-size: 8px; margin-top: 1mm; }
```

Upload a logo named `Primary` in the editor (or put it under `template.logos` in the import JSON).

---

## Agent checklist

When asked to create or edit a label template:

1. Confirm target size in mm → set both `paper` and CSS box to that size.
2. Use only documented placeholders and helpers (`formatNumber`, `numberPart`, `logoImg`).
3. Separate HTML and CSS; produce importable `{ "version": 1, "template": { ... } }` when delivering a file.
4. Include barcode via `{{ barcode_src }}` (QR via `{{ qr_src }}`, product photo via `{{ image_src }}` if requested).
5. For company branding, upload logos and use `{{logoImg "Name"}}` (not remote logo URLs).
6. Avoid scripts and unsafe markup.
7. Keep content clipped for small stickers; test mental layout against the stated height (30 mm is tight).
