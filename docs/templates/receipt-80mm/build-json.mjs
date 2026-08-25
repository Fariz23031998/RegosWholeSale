import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

const html = readFileSync(join(dir, "template.html"), "utf8").replace(/\r\n/g, "\n").trim();
const css = readFileSync(join(dir, "template.css"), "utf8").replace(/\r\n/g, "\n").trim();

const payload = {
  version: 1,
  template: {
    name: "80mm Receipt (Custom HTML)",
    format: "80mm",
    engine: "html",
    header: {
      company_name: "My Company",
      address: "",
      phone: "",
      tax_id: "",
    },
    invoice_title: "",
    footer_text: "Спасибо за покупку!",
    amount_in_words_language: "ru",
    sections: {
      header: true,
      meta: true,
      partner: false,
      items: true,
      subtotal: true,
      discount: true,
      total: true,
      payments: true,
      tendered_change: true,
      balance_due: true,
      closed_without_payment: true,
      footer: true,
    },
    line_sort: { column: "document_order", direction: "asc" },
    logos: [],
    html,
    css,
  },
};

const htmlBytes = Buffer.byteLength(html, "utf8");
const cssBytes = Buffer.byteLength(css, "utf8");
if (htmlBytes > 50000) throw new Error(`html too large: ${htmlBytes} bytes`);
if (cssBytes > 20000) throw new Error(`css too large: ${cssBytes} bytes`);

writeFileSync(join(dir, "receipt-80mm.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`OK: html=${htmlBytes} bytes, css=${cssBytes} bytes -> receipt-80mm.json`);
