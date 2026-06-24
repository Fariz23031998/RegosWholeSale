import clsx from "clsx";
import { useMemo } from "react";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import { applyTemplateLineSort } from "@/lib/receipt-line-sort";
import type { ReceiptFormat, ReceiptTemplate } from "@/types/receipt-templates";
import { HtmlReceiptLayout } from "./HtmlReceiptLayout";
import { InvoiceA4Layout } from "./InvoiceA4Layout";
import { Receipt80mmLayout } from "./Receipt80mmLayout";
import printStyles from "./ReceiptPrint.module.css";

type Props = {
  template: ReceiptTemplate;
  context: DocumentPrintContext;
  className?: string;
};

export function printAreaClassName(format: ReceiptFormat): string {
  return format === "a4" ? printStyles.printAreaA4 : printStyles.printArea80mm;
}

export function TemplatedReceiptView({ template, context, className }: Props) {
  const sortedContext = useMemo(
    () => applyTemplateLineSort(context, template.line_sort),
    [context, template.line_sort],
  );

  return (
    <div className={clsx(printAreaClassName(template.format), className)}>
      {template.engine === "html" ? (
        <HtmlReceiptLayout template={template} context={sortedContext} />
      ) : template.format === "a4" ? (
        <InvoiceA4Layout template={template} context={sortedContext} />
      ) : (
        <Receipt80mmLayout template={template} context={sortedContext} />
      )}
    </div>
  );
}

export function resolveDefaultTemplate(
  templates: ReceiptTemplate[],
  defaultTemplateId: string | null,
): ReceiptTemplate | null {
  if (!templates.length) return null;
  if (defaultTemplateId) {
    const found = templates.find((t) => t.id === defaultTemplateId);
    if (found) return found;
  }
  return templates.find((t) => t.is_default) ?? templates[0];
}
