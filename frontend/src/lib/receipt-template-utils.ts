import type {
  ReceiptFormat,
  ReceiptTemplate,
  ReceiptTemplateEngine,
  ReceiptTemplateImportPackage,
  ReceiptTemplateSections,
} from "@/types/receipt-templates";
import {
  createNakladnayaReceiptTemplate,
  nakladnayaTemplateFiles,
} from "@/templates/receipts/nakladnaya";
import { normalizeAmountInWordsLanguage, amountToWordsText, formatAmountWithWordsText } from "@/lib/amount-in-words";
import { DEFAULT_RECEIPT_TEMPLATE_LINE_SORT, normalizeReceiptTemplateLineSort } from "@/lib/receipt-line-sort";

export function normalizeReceiptTemplate(template: ReceiptTemplate): ReceiptTemplate {
  return {
    ...template,
    engine: template.engine === "html" ? "html" : "builtin",
    html: template.html ?? "",
    css: template.css ?? "",
    amount_in_words_language: normalizeAmountInWordsLanguage(template.amount_in_words_language),
    line_sort: normalizeReceiptTemplateLineSort(template.line_sort),
  };
}

export function normalizeReceiptTemplates(templates: ReceiptTemplate[]): ReceiptTemplate[] {
  return templates.map(normalizeReceiptTemplate);
}

export function defaultSectionsForFormat(format: ReceiptFormat): ReceiptTemplateSections {
  return {
    header: true,
    meta: true,
    partner: format === "a4",
    items: true,
    subtotal: true,
    discount: true,
    total: true,
    payments: true,
    tendered_change: true,
    balance_due: true,
    closed_without_payment: true,
    footer: true,
  };
}

export function createReceiptTemplate(
  format: ReceiptFormat,
  companyName: string,
  engine: ReceiptTemplateEngine = "builtin",
): ReceiptTemplate {
  return {
    id: crypto.randomUUID(),
    name:
      engine === "html"
        ? format === "a4"
          ? "New HTML Invoice"
          : "New HTML Receipt"
        : format === "a4"
          ? "New A4 Invoice"
          : "New 80mm Receipt",
    format,
    engine,
    is_default: false,
    header: {
      company_name: companyName,
      address: "",
      phone: "",
      tax_id: "",
    },
    invoice_title: format === "a4" ? "INVOICE" : "",
    footer_text:
      format === "a4" ? "Thank you for your business." : "Thank you for your purchase!",
    amount_in_words_language: null,
    sections: defaultSectionsForFormat(format),
    line_sort: { ...DEFAULT_RECEIPT_TEMPLATE_LINE_SORT },
    html: engine === "html" ? defaultHtmlTemplate(format) : "",
    css: engine === "html" ? defaultCssTemplate(format) : "",
  };
}

export function loadNakladnayaStarterMarkup(format: ReceiptFormat): { html: string; css: string } {
  if (format === "a4") {
    return {
      html: nakladnayaTemplateFiles.html,
      css: nakladnayaTemplateFiles.css,
    };
  }
  return {
    html: defaultHtmlTemplate(format),
    css: defaultCssTemplate(format),
  };
}

export function createNakladnayaTemplate(companyName: string): ReceiptTemplate {
  return createNakladnayaReceiptTemplate(companyName);
}

export function defaultHtmlTemplate(format: ReceiptFormat): string {
  if (format === "a4") {
    return nakladnayaTemplateFiles.html;
  }

  return `<div class="receipt">
  <div class="center"><strong>{{header.company_name}}</strong></div>
  <div class="center">{{header.address}} {{header.phone}}</div>
  <div class="center">#{{document.code}}</div>
  <div class="center">{{formatDateTime sale.createdAt}}</div>
  <hr />
  {{#each operations}}
  <div class="line">
    <div>{{item_name}}</div>
    <div>{{quantity}} x {{formatCurrency price}} = {{formatCurrency amount}}</div>
  </div>
  {{/each}}
  <hr />
  <div>Total: {{formatCurrency sale.total}}</div>
  {{#each payments}}
  <div>{{payment_type_name}}: {{formatCurrency amount}}</div>
  {{/each}}
  <div class="center">{{footer_text}}</div>
</div>`;
}

export function defaultCssTemplate(format: ReceiptFormat): string {
  if (format === "a4") {
    return nakladnayaTemplateFiles.css;
  }

  return `@page { size: 80mm auto; margin: 4mm; }
.receipt { font-family: monospace; font-size: 11px; width: 72mm; }
.center { text-align: center; }
.line { margin: 4px 0; }
hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }`;
}

export function cloneReceiptTemplate(template: ReceiptTemplate): ReceiptTemplate {
  return structuredClone(template);
}

export function normalizeDefaultFlag(
  templates: ReceiptTemplate[],
  defaultTemplateId: string | null,
): ReceiptTemplate[] {
  if (!templates.length) return templates;
  const resolvedId =
    defaultTemplateId && templates.some((template) => template.id === defaultTemplateId)
      ? defaultTemplateId
      : (templates.find((template) => template.is_default)?.id ?? templates[0].id);

  return templates.map((template) => ({
    ...template,
    is_default: template.id === resolvedId,
  }));
}

const SCRIPT_TAG_MARKERS = ["<script", "</script>"];

const DANGEROUS_MARKUP_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /<\s*script\b/i,
    message: "Template markup cannot contain script tags.",
  },
  {
    pattern: /<\s*\/\s*script\b/i,
    message: "Template markup cannot contain script tags.",
  },
  {
    pattern: /javascript\s*:/i,
    message: "Template markup cannot contain javascript: URLs.",
  },
  {
    pattern: /vbscript\s*:/i,
    message: "Template markup cannot contain vbscript: URLs.",
  },
  {
    pattern: /data\s*:\s*text\/html/i,
    message: "Template markup cannot contain data:text/html URLs.",
  },
  {
    pattern: /<\s*(iframe|object|embed|link|base|form|meta)\b/i,
    message: "Template markup cannot contain embedded documents or metadata tags.",
  },
  {
    pattern: /\bon[a-z]+\s*=/i,
    message: "Template markup cannot contain inline event handlers.",
  },
  {
    pattern: /expression\s*\(/i,
    message: "Template markup cannot contain CSS expression().",
  },
];

const DANGEROUS_CSS_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /@import\b/i,
    message: "Template CSS cannot use @import.",
  },
  {
    pattern: /javascript\s*:/i,
    message: "Template CSS cannot contain javascript: URLs.",
  },
  {
    pattern: /expression\s*\(/i,
    message: "Template CSS cannot contain expression().",
  },
  {
    pattern: /behavior\s*:/i,
    message: "Template CSS cannot contain behavior.",
  },
];

function findDangerousMarkup(text: string, patterns: Array<{ pattern: RegExp; message: string }>) {
  for (const entry of patterns) {
    if (entry.pattern.test(text)) {
      return entry.message;
    }
  }
  return null;
}

export function sanitizeTemplateMarkup(text: string): string {
  const message = findDangerousMarkup(text, DANGEROUS_MARKUP_PATTERNS);
  if (message) {
    throw new Error(message);
  }
  return text;
}

export function sanitizeReceiptCss(text: string): string {
  const message = findDangerousMarkup(text, DANGEROUS_CSS_PATTERNS);
  if (message) {
    throw new Error(message);
  }
  return text;
}

export function prepareReceiptTemplateForSave(template: ReceiptTemplate): ReceiptTemplate {
  if (template.engine !== "html") {
    return {
      ...template,
      html: "",
      css: "",
    };
  }

  return {
    ...template,
    html: sanitizeTemplateMarkup(template.html),
    css: sanitizeReceiptCss(template.css),
  };
}

export function exportReceiptTemplate(template: ReceiptTemplate): ReceiptTemplateImportPackage {
  const { id: _id, is_default: _isDefault, ...rest } = template;
  return {
    version: 1,
    template: rest,
  };
}

export function parseImportedReceiptTemplate(
  raw: unknown,
  companyName: string,
): ReceiptTemplate {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid template file.");
  }
  const payload = raw as Partial<ReceiptTemplateImportPackage> & Partial<ReceiptTemplate>;
  const version = "version" in payload ? payload.version : 1;
  if (version !== 1) {
    throw new Error("Unsupported template file version.");
  }

  const source =
    "template" in payload && payload.template && typeof payload.template === "object"
      ? payload.template
      : payload;

  const format = source.format === "a4" ? "a4" : source.format === "80mm" ? "80mm" : null;
  if (!format) {
    throw new Error("Template format must be 80mm or a4.");
  }

  const engine = source.engine === "html" ? "html" : "builtin";
  const name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : "Imported template";
  const html = engine === "html" ? sanitizeTemplateMarkup(String(source.html ?? "")) : "";
  const css = engine === "html" ? sanitizeReceiptCss(String(source.css ?? "")) : "";

  if (engine === "html" && !html.trim()) {
    throw new Error("HTML templates require a non-empty html body.");
  }

  const base = createReceiptTemplate(format, companyName, engine);
  return {
    ...base,
    id: crypto.randomUUID(),
    name,
    engine,
    header: {
      company_name: source.header?.company_name ?? base.header.company_name,
      address: source.header?.address ?? "",
      phone: source.header?.phone ?? "",
      tax_id: source.header?.tax_id ?? "",
    },
    invoice_title: typeof source.invoice_title === "string" ? source.invoice_title : base.invoice_title,
    footer_text: typeof source.footer_text === "string" ? source.footer_text : base.footer_text,
    amount_in_words_language: normalizeAmountInWordsLanguage(source.amount_in_words_language),
    sections: source.sections ?? base.sections,
    line_sort: normalizeReceiptTemplateLineSort(
      source.line_sort as ReceiptTemplate["line_sort"] | undefined,
    ),
    html: engine === "html" ? html : "",
    css: engine === "html" ? css : "",
    is_default: false,
  };
}

export function downloadReceiptTemplateExport(template: ReceiptTemplate): void {
  const payload = exportReceiptTemplate(template);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${template.name.replace(/[^\w.-]+/g, "_") || "receipt-template"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const RECEIPT_TEMPLATE_VARIABLE_GROUPS = [
  {
    label: "Root",
    variables: ["kind", "document_code", "partner_name", "stock_name", "total_in_words", "total_with_words"],
  },
  {
    label: "document",
    variables: [
      "id",
      "code",
      "date",
      "partner_id",
      "partner_name",
      "partner_phone",
      "stock_id",
      "stock_name",
      "attached_user_id",
      "attached_user_name",
      "amount",
      "performed",
      "currency.id",
      "currency.name",
      "currency.code_chr",
      "currency.exchange_rate",
      "description",
      "wholesale_doc_id",
      "reason",
    ],
  },
  {
    label: "operations[]",
    variables: [
      "id",
      "document_id",
      "item_id",
      "item_code",
      "item_name",
      "item_group_id",
      "item_group_name",
      "item_unit_name",
      "item_brand",
      "quantity",
      "price",
      "price2",
      "amount",
    ],
  },
  {
    label: "operation_groups[]",
    variables: [
      "name",
      "total_quantity",
      "total_amount",
      "lines",
    ],
  },
  {
    label: "totals",
    variables: ["quantity", "amount", "total_in_words", "total_with_words"],
  },
  {
    label: "payments[]",
    variables: [
      "id",
      "code",
      "date",
      "amount",
      "category_id",
      "category_name",
      "payment_type_name",
      "partner_id",
      "partner_name",
      "attached_user_id",
      "attached_user_name",
      "exchange_rate",
      "currency.code_chr",
    ],
  },
  {
    label: "sale",
    variables: [
      "id",
      "createdAt",
      "cashierName",
      "subtotal",
      "discount",
      "total",
      "amountPaid",
      "balanceDue",
      "total_in_words",
      "total_with_words",
      "tendered",
      "change",
      "type",
      "reason",
      "refundOf",
    ],
  },
  {
    label: "template",
    variables: [
      "header.company_name",
      "header.address",
      "header.phone",
      "header.tax_id",
      "invoice_title",
      "footer_text",
    ],
  },
] as const;
