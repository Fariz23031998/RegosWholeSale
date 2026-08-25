export type ReceiptFormat = "80mm" | "a4";
export type ReceiptTemplateEngine = "builtin" | "html";

export type ReceiptTemplateHeader = {
  company_name: string;
  address: string;
  phone: string;
  tax_id: string;
};

export type ReceiptTemplateLogo = {
  id: string;
  name: string;
  src: string;
  max_width: number | null;
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

export type ReceiptLineSortColumn =
  | "document_order"
  | "item_code"
  | "item_name"
  | "item_group_name"
  | "item_brand"
  | "item_fullname"
  | "item_description"
  | "item_articul"
  | "item_color_name"
  | "item_size_name"
  | "item_producer_name"
  | "item_country_name"
  | "item_unit_name"
  | "quantity"
  | "price"
  | "amount";

export type ReceiptLineSortDirection = "asc" | "desc";

export type ReceiptTemplateLineSort = {
  column: ReceiptLineSortColumn;
  direction: ReceiptLineSortDirection;
};

export type ReceiptAmountInWordsLanguage = "ru" | "uz" | "en" | "tj";

export type ReceiptTemplate = {
  id: string;
  name: string;
  format: ReceiptFormat;
  engine: ReceiptTemplateEngine;
  is_default: boolean;
  header: ReceiptTemplateHeader;
  invoice_title: string;
  footer_text: string;
  amount_in_words_language: ReceiptAmountInWordsLanguage | null;
  sections: ReceiptTemplateSections;
  line_sort: ReceiptTemplateLineSort;
  logos: ReceiptTemplateLogo[];
  html: string;
  css: string;
};

export type ReceiptTemplateImportPackage = {
  version: 1;
  template: Omit<ReceiptTemplate, "id" | "is_default"> & {
    id?: string;
    is_default?: boolean;
  };
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

export const RECEIPT_SECTION_KEYS = [
  "header",
  "meta",
  "partner",
  "items",
  "subtotal",
  "discount",
  "total",
  "payments",
  "tendered_change",
  "balance_due",
  "closed_without_payment",
  "footer",
] as const satisfies readonly (keyof ReceiptTemplateSections)[];

type TranslateFn = (
  key: string,
  fallback?: string,
  params?: Record<string, string | number>,
) => string;

export function getReceiptSectionLabels(
  t: TranslateFn,
): Record<keyof ReceiptTemplateSections, string> {
  return {
    header: t("receipt.sections.header", "Header (company name & contact)"),
    meta: t("receipt.sections.meta", "Date, document #, cashier"),
    partner: t("receipt.sections.partner", "Buyer / partner"),
    items: t("receipt.sections.items", "Line items"),
    subtotal: t("receipt.sections.subtotal", "Subtotal"),
    discount: t("receipt.sections.discount", "Discount"),
    total: t("receipt.sections.total", "Total"),
    payments: t("receipt.sections.payments", "Payment method"),
    tendered_change: t("receipt.sections.tendered_change", "Tendered & change"),
    balance_due: t("receipt.sections.balance_due", "Paid & balance due"),
    closed_without_payment: t("receipt.sections.closed_without_payment", "Closed without payment"),
    footer: t("receipt.sections.footer", "Footer message"),
  };
}

export function getReceiptLineSortColumnLabels(
  t: TranslateFn,
): Record<ReceiptLineSortColumn, string> {
  return {
    document_order: t("settings.receiptTemplates.sort.documentOrder", "Document order"),
    item_code: t("settings.receiptTemplates.sort.itemCode", "Item code"),
    item_name: t("settings.receiptTemplates.sort.itemName", "Item name"),
    item_group_name: t("settings.receiptTemplates.sort.itemGroup", "Product group"),
    item_brand: t("settings.receiptTemplates.sort.itemBrand", "Brand"),
    item_fullname: t("settings.receiptTemplates.sort.itemFullname", "Full name"),
    item_description: t("settings.receiptTemplates.sort.itemDescription", "Description"),
    item_articul: t("settings.receiptTemplates.sort.itemArticul", "Article / SKU"),
    item_color_name: t("settings.receiptTemplates.sort.itemColorName", "Color"),
    item_size_name: t("settings.receiptTemplates.sort.itemSizeName", "Size"),
    item_producer_name: t("settings.receiptTemplates.sort.itemProducerName", "Producer"),
    item_country_name: t("settings.receiptTemplates.sort.itemCountryName", "Country"),
    item_unit_name: t("settings.receiptTemplates.sort.itemUnit", "Unit"),
    quantity: t("settings.receiptTemplates.sort.quantity", "Quantity"),
    price: t("settings.receiptTemplates.sort.price", "Price"),
    amount: t("settings.receiptTemplates.sort.amount", "Amount"),
  };
}
