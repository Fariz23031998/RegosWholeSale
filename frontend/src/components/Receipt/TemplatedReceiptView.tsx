import clsx from "clsx";
import type { ReceiptPrintContext } from "@/lib/receipt-print-context";
import type { ReceiptFormat, ReceiptTemplate } from "@/types/receipt-templates";
import { InvoiceA4Layout } from "./InvoiceA4Layout";
import { Receipt80mmLayout } from "./Receipt80mmLayout";
import printStyles from "./ReceiptPrint.module.css";

type Props = {
  template: ReceiptTemplate;
  context: ReceiptPrintContext;
  className?: string;
};

export function printAreaClassName(format: ReceiptFormat): string {
  return format === "a4" ? printStyles.printAreaA4 : printStyles.printArea80mm;
}

export function TemplatedReceiptView({ template, context, className }: Props) {
  const Layout = template.format === "a4" ? InvoiceA4Layout : Receipt80mmLayout;

  return (
    <div className={clsx(printAreaClassName(template.format), className)}>
      <Layout template={template} context={context} />
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
