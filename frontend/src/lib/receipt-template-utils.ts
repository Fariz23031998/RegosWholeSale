import type { ReceiptFormat, ReceiptTemplate, ReceiptTemplateSections } from "@/types/receipt-templates";

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
): ReceiptTemplate {
  return {
    id: crypto.randomUUID(),
    name: format === "a4" ? "New A4 Invoice" : "New 80mm Receipt",
    format,
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
    sections: defaultSectionsForFormat(format),
  };
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
