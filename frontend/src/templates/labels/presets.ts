import { REGOS_LOGO_DATA_URI } from "./regos-logo-data";
import { wrapLabelHtml, type LabelPreset } from "./types";

const BASE_CSS = `html, body {
  margin: 0;
  padding: 0;
  font-family: Arial, Helvetica, sans-serif;
  color: #000;
}
`;

const REGOS_LOGO = {
  id: "logo-regos",
  name: "REGOS",
  src: REGOS_LOGO_DATA_URI,
  max_width: null as number | null,
};

export const LABEL_PRESETS: LabelPreset[] = [
  {
    id: "label-30x20",
    name: "30×20 mm mini",
    paper: { width_mm: 30, height_mm: 20 },
    html: wrapLabelHtml(`  <div class="label">
    <div class="name">{{ name }}</div>
    <div class="price">{{formatNumber price}} <span class="currency">{{ currency }}</span></div>
    <div class="barcode-wrap">
      <img class="barcode" src="{{ barcode_src }}" alt="" />
      <div class="code">{{ barcode }}</div>
    </div>
  </div>`),
    css:
      BASE_CSS +
      `.label {
  position: relative;
  box-sizing: border-box;
  width: 30mm;
  height: 20mm;
  overflow: hidden;
}
.name {
  position: absolute;
  top: 1mm;
  left: 1.2mm;
  right: 1.2mm;
  font-size: 6.5px;
  font-weight: 700;
  line-height: 1.1;
  max-height: 1.1em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.price {
  position: absolute;
  top: 3.4mm;
  left: 1.2mm;
  right: 1.2mm;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}
.currency {
  font-size: 6px;
  font-weight: 700;
  margin-left: 0.4mm;
}
.barcode-wrap {
  position: absolute;
  left: 1.2mm;
  right: 1.2mm;
  bottom: 0.8mm;
  height: 10mm;
}
.code {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 6.5px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.04em;
  text-align: center;
  white-space: nowrap;
}
img.barcode {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 7.5mm;
  width: 100%;
  max-width: 100%;
  object-fit: contain;
  object-position: center bottom;
}`,
  },
  {
    id: "label-40x30",
    name: "40×30 mm compact",
    paper: { width_mm: 40, height_mm: 30 },
    html: wrapLabelHtml(`  <div class="label">
    <div class="name">{{ name }}</div>
    <div class="price">{{formatNumber price}} <span class="currency">{{ currency }}</span></div>
    <div class="barcode-wrap">
      <img class="barcode" src="{{ barcode_src }}" alt="" />
      <div class="code">{{ barcode }}</div>
    </div>
  </div>`),
    css:
      BASE_CSS +
      `.label {
  position: relative;
  box-sizing: border-box;
  width: 40mm;
  height: 30mm;
  overflow: hidden;
}
.name {
  position: absolute;
  top: 1.5mm;
  left: 1.6mm;
  right: 1.6mm;
  font-size: 8.5px;
  font-weight: 700;
  line-height: 1.15;
  max-height: 2.3em;
  overflow: hidden;
}
.price {
  position: absolute;
  top: 8.5mm;
  left: 1.6mm;
  right: 1.6mm;
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}
.currency {
  font-size: 8px;
  font-weight: 700;
  margin-left: 0.6mm;
}
.barcode-wrap {
  position: absolute;
  left: 1.6mm;
  right: 1.6mm;
  bottom: 1.2mm;
  height: 14mm;
}
.code {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 7.5px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.05em;
  text-align: center;
  white-space: nowrap;
}
img.barcode {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 11mm;
  width: 100%;
  max-width: 100%;
  object-fit: contain;
  object-position: center bottom;
}`,
  },
  {
    id: "label-50x30",
    name: "50×30 mm price tag",
    paper: { width_mm: 50, height_mm: 30 },
    html: wrapLabelHtml(`  <div class="label">
    <div class="name">{{ name }}</div>
    <div class="price">{{formatNumber price}} <span class="currency">{{ currency }}</span></div>
    <div class="meta">{{ articul }}</div>
    <div class="barcode-wrap">
      <img class="barcode" src="{{ barcode_src }}" alt="" />
      <div class="code">{{ barcode }}</div>
    </div>
  </div>`),
    css:
      BASE_CSS +
      `.label {
  position: relative;
  box-sizing: border-box;
  width: 50mm;
  height: 30mm;
  overflow: hidden;
}
.name {
  position: absolute;
  top: 1.6mm;
  left: 1.8mm;
  right: 1.8mm;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1.15;
  max-height: 2.3em;
  overflow: hidden;
}
.price {
  position: absolute;
  top: 8.2mm;
  left: 1.8mm;
  right: 1.8mm;
  font-size: 16px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}
.currency {
  font-size: 9px;
  font-weight: 700;
  margin-left: 0.8mm;
}
.meta {
  position: absolute;
  top: 13.5mm;
  left: 1.8mm;
  right: 1.8mm;
  font-size: 7px;
  font-weight: 500;
  color: #444;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.barcode-wrap {
  position: absolute;
  left: 1.8mm;
  right: 1.8mm;
  bottom: 1.2mm;
  height: 12.5mm;
}
.code {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 7.5px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.05em;
  text-align: center;
  white-space: nowrap;
}
img.barcode {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 10mm;
  width: 100%;
  max-width: 100%;
  object-fit: contain;
  object-position: center bottom;
}`,
  },
  {
    id: "label-58x30",
    name: "58×30 mm shelf label",
    paper: { width_mm: 58, height_mm: 30 },
    html: wrapLabelHtml(`  <div class="label">
    <div class="top">
      <img class="product" src="{{ image_src }}" alt="" />
      <div class="info">
        <div class="name">{{ name }}</div>
        <div class="price-row">
          <span class="price">{{formatNumber price}}</span>
          <span class="currency">{{ currency }}</span>
        </div>
        <div class="meta">{{ articul }}</div>
      </div>
    </div>
    <div class="barcode-wrap">
      <img class="barcode" src="{{ barcode_src }}" alt="" />
      <div class="code">{{ barcode }}</div>
    </div>
  </div>`),
    css:
      BASE_CSS +
      `.label {
  position: relative;
  box-sizing: border-box;
  width: 58mm;
  height: 30mm;
  overflow: hidden;
}
.top {
  position: absolute;
  top: 1.5mm;
  left: 1.8mm;
  right: 1.8mm;
  height: 12mm;
}
img.product {
  position: absolute;
  top: 0;
  left: 0;
  width: 10mm;
  height: 10mm;
  object-fit: cover;
  border: 0.2mm solid #111;
}
img.product[src=""] {
  display: none;
}
.info {
  position: absolute;
  top: 0;
  left: 11.8mm;
  right: 0;
  bottom: 0;
}
.name {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1.15;
  max-height: 2.3em;
  overflow: hidden;
  word-break: break-word;
}
.price-row {
  position: absolute;
  top: 6.2mm;
  left: 0;
  right: 0;
  height: 4mm;
}
.price {
  position: absolute;
  left: 0;
  bottom: 0;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1;
}
.currency {
  position: absolute;
  left: 22mm;
  bottom: 0.3mm;
  font-size: 9px;
  font-weight: 700;
}
.meta {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 7px;
  line-height: 1.1;
  color: #444;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.barcode-wrap {
  position: absolute;
  left: 1.8mm;
  right: 1.8mm;
  bottom: 1.2mm;
  height: 13mm;
}
img.barcode {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 9.5mm;
  width: 100%;
  max-width: 100%;
  object-fit: contain;
  object-position: center bottom;
}
.code {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
}`,
  },
  {
    id: "label-58x30-v1",
    name: "58×30 mm REGOS shelf (v1)",
    paper: { width_mm: 58, height_mm: 30 },
    logos: [REGOS_LOGO],
    html: wrapLabelHtml(`  <div class="label">
    <div class="name">{{ name }}</div>
    <div class="price-row">
      <span class="price-label">Цена за шт:</span>
      <span class="price">{{formatNumber price}}</span>
    </div>
    <div class="mid-row">
      <div class="brand">{{logoImg "REGOS"}}</div>
      <img class="barcode" src="{{ barcode_src }}" alt="" />
    </div>
    <div class="footer">Код: {{ code }} / Дата: {{ date }}</div>
  </div>`),
    css:
      BASE_CSS +
      `.label {
  position: relative;
  box-sizing: border-box;
  width: 58mm;
  height: 30mm;
  overflow: hidden;
}
.name {
  position: absolute;
  top: 0.6mm;
  left: 0.9mm;
  right: 0.9mm;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.15;
  text-align: center;
  max-height: 2.3em;
  overflow: hidden;
  word-break: break-word;
}
.price-row {
  position: absolute;
  top: 7.2mm;
  left: 0.9mm;
  right: 0.9mm;
  height: 5.5mm;
}
.price-label {
  position: absolute;
  left: 0;
  bottom: 0;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.1;
  white-space: nowrap;
}
.price {
  position: absolute;
  right: 0;
  bottom: 0;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1;
  text-align: right;
  white-space: nowrap;
}
.mid-row {
  position: absolute;
  top: 13.5mm;
  left: 0.9mm;
  right: 0.9mm;
  height: 9mm;
}
.brand {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 46%;
  overflow: hidden;
}
.brand img {
  height: 9mm;
  width: auto;
  max-width: 100%;
  object-fit: contain;
  object-position: left center;
}
img.barcode {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  height: 9mm;
  width: 52%;
  max-width: 100%;
  object-fit: fill;
  object-position: center;
}
.footer {
  position: absolute;
  left: 0.9mm;
  right: 0.9mm;
  bottom: 0.4mm;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}`,
  },
  {
    id: "label-58x40",
    name: "58×40 mm label",
    paper: { width_mm: 58, height_mm: 40 },
    html: wrapLabelHtml(`  <div class="label">
    <div class="name">{{ name }}</div>
    <div class="price">{{formatNumber price}} <span class="currency">{{ currency }}</span></div>
    <div class="barcode-wrap">
      <img class="barcode" src="{{ barcode_src }}" alt="" />
      <div class="code">{{ barcode }}</div>
    </div>
  </div>`),
    css:
      BASE_CSS +
      `.label {
  position: relative;
  box-sizing: border-box;
  width: 58mm;
  height: 40mm;
  overflow: hidden;
}
.name {
  position: absolute;
  top: 2.4mm;
  left: 2.6mm;
  right: 2.6mm;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  max-height: 2.4em;
  overflow: hidden;
}
.price {
  position: absolute;
  top: 11mm;
  left: 2.6mm;
  right: 2.6mm;
  font-size: 20px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}
.currency {
  font-size: 11px;
  font-weight: 700;
  margin-left: 1mm;
}
.barcode-wrap {
  position: absolute;
  left: 2.6mm;
  right: 2.6mm;
  bottom: 2mm;
  height: 18mm;
}
.code {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-align: center;
  white-space: nowrap;
}
img.barcode {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 15mm;
  width: 100%;
  max-width: 100%;
  object-fit: contain;
  object-position: center bottom;
}`,
  },
  {
    id: "label-58x40-super-price",
    name: "58×40 mm super price",
    paper: { width_mm: 58, height_mm: 40 },
    html: wrapLabelHtml(`  <div class="label">
    <div class="headline">супер цена!</div>
    <div class="name">{{ name }}</div>
    <div class="prices">
      <div class="old">{{formatNumber old_price}}</div>
      <div class="now">{{formatNumber current_price}}</div>
    </div>
    <div class="footer">
      <div class="barcode-wrap">
        <img class="barcode" src="{{ barcode_src }}" alt="" />
        <div class="code">{{ barcode }}</div>
      </div>
      <div class="meta">{{ currency }}</div>
    </div>
  </div>`),
    css:
      BASE_CSS +
      `.label {
  position: relative;
  box-sizing: border-box;
  width: 58mm;
  height: 40mm;
  overflow: hidden;
  background: #f0c21a;
  color: #2b1a12;
  font-family: Georgia, "Times New Roman", Times, serif;
  clip-path: polygon(
    0 0,
    100% 0,
    100% 7%,
    calc(100% - 2.4mm) 12%,
    calc(100% - 2.4mm) 88%,
    100% 93%,
    100% 100%,
    0 100%,
    0 93%,
    2.4mm 88%,
    2.4mm 12%,
    0 7%
  );
}
.headline {
  position: absolute;
  top: 1.8mm;
  left: 4mm;
  right: 4mm;
  font-size: 15px;
  font-weight: 700;
  font-style: italic;
  letter-spacing: -0.02em;
  line-height: 1;
  text-align: center;
}
.name {
  position: absolute;
  top: 7.2mm;
  left: 4mm;
  right: 4mm;
  font-size: 8px;
  font-weight: 600;
  line-height: 1.2;
  max-height: 2.4em;
  overflow: hidden;
  text-align: center;
}
.prices {
  position: absolute;
  top: 14mm;
  left: 4mm;
  right: 4mm;
  height: 12mm;
}
.old {
  position: absolute;
  top: 0;
  right: 0;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  text-decoration: line-through;
  text-decoration-thickness: 0.35mm;
  opacity: 0.9;
  min-height: 1em;
}
.old:empty {
  display: none;
}
.now {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  text-align: center;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 0.95;
}
.footer {
  position: absolute;
  left: 4mm;
  right: 4mm;
  bottom: 1.4mm;
  height: 10mm;
  padding: 0.8mm 1.2mm;
  box-sizing: border-box;
  background: #fff;
  color: #2b1a12;
  border-radius: 0.4mm;
}
.barcode-wrap {
  position: absolute;
  top: 0.8mm;
  left: 1.2mm;
  right: 10mm;
  bottom: 0.8mm;
}
img.barcode {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 6.5mm;
  width: 100%;
  max-width: 42mm;
  object-fit: contain;
  object-position: center bottom;
}
.code {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 6px;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
}
.meta {
  position: absolute;
  right: 1.2mm;
  bottom: 1.1mm;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 7px;
  font-weight: 700;
  line-height: 1;
}`,
  },
  {
    id: "label-60x40",
    name: "60×40 mm split price",
    paper: { width_mm: 60, height_mm: 40 },
    html: wrapLabelHtml(`  <div class="label">
    <div class="name">{{ name }}</div>
    <div class="price">
      <span class="price-main">{{numberPart price 0 -3}}</span><span class="price-tail">{{numberPart price -3}}</span>
      <span class="currency">{{ currency }}</span>
    </div>
    <div class="meta">{{ articul }} · {{ unit_name }}</div>
    <div class="barcode-wrap">
      <img class="barcode" src="{{ barcode_src }}" alt="" />
      <div class="code">{{ barcode }}</div>
    </div>
  </div>`),
    css:
      BASE_CSS +
      `.label {
  position: relative;
  box-sizing: border-box;
  width: 60mm;
  height: 40mm;
  overflow: hidden;
}
.name {
  position: absolute;
  top: 2.4mm;
  left: 2.6mm;
  right: 2.6mm;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.15;
  max-height: 2.3em;
  overflow: hidden;
}
.price {
  position: absolute;
  top: 10.5mm;
  left: 2.6mm;
  right: 2.6mm;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}
.price-main {
  font-size: 24px;
}
.price-tail {
  font-size: 15px;
}
.currency {
  font-size: 11px;
  margin-left: 1.2mm;
  font-weight: 700;
}
.meta {
  position: absolute;
  top: 19mm;
  left: 2.6mm;
  right: 2.6mm;
  font-size: 8px;
  color: #444;
}
.barcode-wrap {
  position: absolute;
  left: 2.6mm;
  right: 2.6mm;
  bottom: 2mm;
  height: 16mm;
}
.code {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-align: center;
  white-space: nowrap;
}
img.barcode {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 13mm;
  width: 100%;
  max-width: 100%;
  object-fit: contain;
  object-position: center bottom;
}`,
  },
  {
    id: "label-63x38",
    name: "63×38 mm with QR",
    paper: { width_mm: 63, height_mm: 38 },
    html: wrapLabelHtml(`  <div class="label">
    <div class="name">{{ name }}</div>
    <div class="price">{{formatNumber price}} <span class="currency">{{ currency }}</span></div>
    <div class="codes">
      <div class="barcode-wrap">
        <img class="barcode" src="{{ barcode_src }}" alt="" />
        <div class="code">{{ barcode }}</div>
      </div>
      <img class="qr" src="{{ qr_src }}" alt="" />
    </div>
  </div>`),
    css:
      BASE_CSS +
      `.label {
  position: relative;
  box-sizing: border-box;
  width: 63mm;
  height: 38mm;
  overflow: hidden;
}
.name {
  position: absolute;
  top: 2.2mm;
  left: 2.4mm;
  right: 2.4mm;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.15;
  max-height: 2.3em;
  overflow: hidden;
}
.price {
  position: absolute;
  top: 10mm;
  left: 2.4mm;
  right: 2.4mm;
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}
.currency {
  font-size: 10px;
  font-weight: 700;
  margin-left: 0.8mm;
}
.codes {
  position: absolute;
  left: 2.4mm;
  right: 2.4mm;
  bottom: 1.8mm;
  height: 16mm;
}
.barcode-wrap {
  position: absolute;
  top: 0;
  left: 0;
  right: 14.5mm;
  bottom: 0;
}
img.barcode {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 13mm;
  width: 100%;
  max-width: 100%;
  object-fit: contain;
  object-position: center bottom;
}
.code {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-align: center;
  white-space: nowrap;
}
img.qr {
  position: absolute;
  right: 0;
  bottom: 0;
  height: 12mm;
  width: 12mm;
}`,
  },
  {
    id: "label-70x50",
    name: "70×50 mm promo",
    paper: { width_mm: 70, height_mm: 50 },
    html: wrapLabelHtml(`  <div class="label">
    <div class="media">
      <img class="product" src="{{ image_src }}" alt="" />
      <div class="info">
        <div class="name">{{ name }}</div>
        <div class="prices">
          <span class="old">{{formatNumber old_price}}</span>
          <span class="now">{{formatNumber current_price}} <span class="currency">{{ currency }}</span></span>
        </div>
        <div class="meta">{{ category }}</div>
      </div>
    </div>
    <div class="barcode-wrap">
      <img class="barcode" src="{{ barcode_src }}" alt="" />
      <div class="code">{{ barcode }}</div>
    </div>
  </div>`),
    css:
      BASE_CSS +
      `.label {
  position: relative;
  box-sizing: border-box;
  width: 70mm;
  height: 50mm;
  overflow: hidden;
}
.media {
  position: absolute;
  top: 2.5mm;
  left: 2.8mm;
  right: 2.8mm;
  height: 22mm;
}
img.product {
  position: absolute;
  top: 0;
  left: 0;
  width: 18mm;
  height: 18mm;
  object-fit: cover;
  border: 0.2mm solid #111;
}
img.product[src=""] {
  display: none;
}
.info {
  position: absolute;
  top: 0;
  left: 20.5mm;
  right: 0;
  bottom: 0;
}
.name {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
  max-height: 2.4em;
  overflow: hidden;
}
.prices {
  position: absolute;
  top: 9.5mm;
  left: 0;
  right: 0;
  height: 6mm;
}
.old {
  position: absolute;
  left: 0;
  bottom: 0.8mm;
  text-decoration: line-through;
  font-size: 11px;
  color: #555;
}
.now {
  position: absolute;
  left: 18mm;
  bottom: 0;
  font-size: 20px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}
.currency {
  font-size: 11px;
  font-weight: 700;
}
.meta {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 9px;
  color: #444;
}
.barcode-wrap {
  position: absolute;
  left: 2.8mm;
  right: 2.8mm;
  bottom: 2mm;
  height: 18mm;
}
img.barcode {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 15mm;
  width: 100%;
  max-width: 100%;
  object-fit: contain;
  object-position: center bottom;
}
.code {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-align: center;
  white-space: nowrap;
}`,
  },
  {
    id: "label-80x50",
    name: "80×50 mm shelf",
    paper: { width_mm: 80, height_mm: 50 },
    html: wrapLabelHtml(`  <div class="label">
    <div class="name">{{ name }}</div>
    <div class="price">{{formatNumber price}} <span class="currency">{{ currency }}</span></div>
    <div class="meta">{{ code }} · {{ articul }} · {{ unit_name }}</div>
    <div class="barcode-wrap">
      <img class="barcode" src="{{ barcode_src }}" alt="" />
      <div class="code">{{ barcode }}</div>
    </div>
  </div>`),
    css:
      BASE_CSS +
      `.label {
  position: relative;
  box-sizing: border-box;
  width: 80mm;
  height: 50mm;
  overflow: hidden;
}
.name {
  position: absolute;
  top: 3mm;
  left: 3.2mm;
  right: 3.2mm;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
  max-height: 2.4em;
  overflow: hidden;
}
.price {
  position: absolute;
  top: 13mm;
  left: 3.2mm;
  right: 3.2mm;
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}
.currency {
  font-size: 14px;
  font-weight: 700;
  margin-left: 1.2mm;
}
.meta {
  position: absolute;
  top: 23mm;
  left: 3.2mm;
  right: 3.2mm;
  font-size: 10px;
  color: #444;
}
.barcode-wrap {
  position: absolute;
  left: 3.2mm;
  right: 3.2mm;
  bottom: 2.4mm;
  height: 20mm;
}
img.barcode {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 17mm;
  width: 100%;
  max-width: 100%;
  object-fit: contain;
  object-position: center bottom;
}
.code {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-align: center;
  white-space: nowrap;
}`,
  },
  {
    id: "label-100x50",
    name: "100×50 mm shelf tag",
    paper: { width_mm: 100, height_mm: 50 },
    html: wrapLabelHtml(`  <div class="label">
    <div class="header">
      <div class="name">{{ name }}</div>
      <div class="category">{{ category }}</div>
    </div>
    <div class="price">{{formatNumber price}} <span class="currency">{{ currency }}</span></div>
    <div class="meta">{{ articul }} · {{ unit_name }}</div>
    <div class="barcode-wrap">
      <img class="barcode" src="{{ barcode_src }}" alt="" />
      <div class="code">{{ barcode }}</div>
    </div>
  </div>`),
    css:
      BASE_CSS +
      `.label {
  position: relative;
  box-sizing: border-box;
  width: 100mm;
  height: 50mm;
  overflow: hidden;
}
.header {
  position: absolute;
  top: 3mm;
  left: 3.5mm;
  right: 3.5mm;
  height: 9mm;
}
.name {
  position: absolute;
  top: 0;
  left: 0;
  right: 28mm;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.2;
  max-height: 2.4em;
  overflow: hidden;
}
.category {
  position: absolute;
  top: 0;
  right: 0;
  font-size: 11px;
  font-weight: 600;
  color: #444;
  white-space: nowrap;
}
.price {
  position: absolute;
  top: 13.5mm;
  left: 3.5mm;
  right: 3.5mm;
  font-size: 30px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}
.currency {
  font-size: 14px;
  font-weight: 700;
  margin-left: 1.2mm;
}
.meta {
  position: absolute;
  top: 24mm;
  left: 3.5mm;
  right: 3.5mm;
  font-size: 10px;
  color: #444;
}
.barcode-wrap {
  position: absolute;
  left: 3.5mm;
  right: 3.5mm;
  bottom: 2.4mm;
  height: 19mm;
}
img.barcode {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 16mm;
  width: 100%;
  max-width: 100%;
  object-fit: contain;
  object-position: center bottom;
}
.code {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-align: center;
  white-space: nowrap;
}`,
  },
  {
    id: "label-100x70",
    name: "100×70 mm large shelf",
    paper: { width_mm: 100, height_mm: 70 },
    html: wrapLabelHtml(`  <div class="label">
    <div class="media">
      <img class="product" src="{{ image_src }}" alt="" />
      <div class="info">
        <div class="name">{{ name }}</div>
        <div class="category">{{ category }}</div>
        <div class="price">{{formatNumber price}} <span class="currency">{{ currency }}</span></div>
        <div class="meta">{{ articul }} · {{ unit_name }} · {{ code }}</div>
      </div>
      <img class="qr" src="{{ qr_src }}" alt="" />
    </div>
    <div class="barcode-wrap">
      <img class="barcode" src="{{ barcode_src }}" alt="" />
      <div class="code">{{ barcode }}</div>
    </div>
  </div>`),
    css:
      BASE_CSS +
      `.label {
  position: relative;
  box-sizing: border-box;
  width: 100mm;
  height: 70mm;
  overflow: hidden;
}
.media {
  position: absolute;
  top: 3.5mm;
  left: 3.8mm;
  right: 3.8mm;
  height: 36mm;
}
img.product {
  position: absolute;
  top: 0;
  left: 0;
  width: 24mm;
  height: 24mm;
  object-fit: cover;
  border: 0.25mm solid #111;
}
img.product[src=""] {
  display: none;
}
.info {
  position: absolute;
  top: 0;
  left: 27.2mm;
  right: 19.2mm;
  bottom: 0;
}
.name {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
  max-height: 2.4em;
  overflow: hidden;
}
.category {
  position: absolute;
  top: 10mm;
  left: 0;
  right: 0;
  font-size: 11px;
  color: #444;
}
.price {
  position: absolute;
  top: 15mm;
  left: 0;
  right: 0;
  font-size: 32px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}
.currency {
  font-size: 14px;
  font-weight: 700;
  margin-left: 1.2mm;
}
.meta {
  position: absolute;
  top: 28mm;
  left: 0;
  right: 0;
  font-size: 11px;
  color: #444;
}
img.qr {
  position: absolute;
  top: 0;
  right: 0;
  width: 16mm;
  height: 16mm;
}
.barcode-wrap {
  position: absolute;
  left: 3.8mm;
  right: 3.8mm;
  bottom: 2.8mm;
  height: 22mm;
}
img.barcode {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 18mm;
  width: 100%;
  max-width: 100%;
  object-fit: contain;
  object-position: center bottom;
}
.code {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-align: center;
  white-space: nowrap;
}`,
  },
];
