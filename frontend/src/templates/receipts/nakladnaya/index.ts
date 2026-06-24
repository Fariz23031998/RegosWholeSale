import type { ReceiptTemplate } from "@/types/receipt-templates";
import nakladnayaCss from "./template.css?raw";
import nakladnayaHtml from "./template.html?raw";

export const NAKLADNAYA_TEMPLATE_ID = "bundled-nakladnaya-a4";

export const nakladnayaTemplateFiles = {
  html: nakladnayaHtml,
  css: nakladnayaCss,
} as const;

export function createNakladnayaReceiptTemplate(companyName: string): ReceiptTemplate {
  return {
    id: crypto.randomUUID(),
    name: "Накладная (A4)",
    format: "a4",
    engine: "html",
    is_default: false,
    header: {
      company_name: companyName,
      address: "",
      phone: "",
      tax_id: "",
    },
    invoice_title: "НАКЛАДНАЯ",
    footer_text: "",
    amount_in_words_language: "ru",
    sections: {
      header: true,
      meta: true,
      partner: true,
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
    line_sort: {
      column: "item_name",
      direction: "asc",
    },
    html: nakladnayaHtml,
    css: nakladnayaCss,
  };
}
