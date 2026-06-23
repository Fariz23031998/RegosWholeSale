export type ReceiptFormat = "80mm" | "a4";

export type ReceiptTemplateHeader = {
  company_name: string;
  address: string;
  phone: string;
  tax_id: string;
};

export type ReceiptTemplateSections = {
  header: boolean;
  meta: boolean;
  partner: boolean;
  items: boolean;
  subtotal: boolean;
  discount: boolean;
  total: boolean;
  payments: boolean;
  tendered_change: boolean;
  balance_due: boolean;
  closed_without_payment: boolean;
  footer: boolean;
};

export type ReceiptTemplate = {
  id: string;
  name: string;
  format: ReceiptFormat;
  is_default: boolean;
  header: ReceiptTemplateHeader;
  invoice_title: string;
  footer_text: string;
  sections: ReceiptTemplateSections;
};

export type ReceiptTemplatesSettings = {
  templates: ReceiptTemplate[];
  default_template_id: string | null;
};

export type ReceiptTemplatesResponse = {
  settings: ReceiptTemplatesSettings;
};

export type ReceiptTemplatesPatchRequest = {
  templates?: ReceiptTemplate[];
  default_template_id?: string | null;
};

export const RECEIPT_SECTION_LABELS: Record<keyof ReceiptTemplateSections, string> = {
  header: "Header (company name & contact)",
  meta: "Date, document #, cashier",
  partner: "Buyer / partner",
  items: "Line items",
  subtotal: "Subtotal",
  discount: "Discount",
  total: "Total",
  payments: "Payment method",
  tendered_change: "Tendered & change",
  balance_due: "Paid & balance due",
  closed_without_payment: "Closed without payment notice",
  footer: "Footer message",
};
