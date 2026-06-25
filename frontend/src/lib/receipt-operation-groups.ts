import type { WholesaleOperationLine } from "@/lib/sales-api";
import type { ReceiptTemplateLineSort } from "@/types/receipt-templates";
import { sortOperationLines } from "@/lib/receipt-line-sort";

export type ReceiptOperationGroup = {
  name: string;
  lines: WholesaleOperationLine[];
  total_quantity: number;
  total_amount: number;
};

export type ReceiptOperationTotals = {
  quantity: number;
  amount: number;
  amount_gross: number;
  discount: number;
};

export function lineGrossAmount(line: WholesaleOperationLine): number {
  const unitPrice = line.price2 != null ? line.price2 : line.price;
  return +(line.quantity * unitPrice).toFixed(2);
}

export function lineAmount(line: WholesaleOperationLine): number {
  if (line.amount != null) return line.amount;
  return +(line.quantity * line.price).toFixed(2);
}

export function lineDiscountAmount(line: WholesaleOperationLine): number {
  const discount = +(lineGrossAmount(line) - lineAmount(line)).toFixed(2);
  return discount > 0 ? discount : 0;
}

export function buildOperationGroups(
  operations: WholesaleOperationLine[],
  sort?: ReceiptTemplateLineSort,
): ReceiptOperationGroup[] {
  const order: string[] = [];
  const grouped = new Map<string, WholesaleOperationLine[]>();

  for (const operation of operations) {
    const name = operation.item_group_name?.trim() || "—";
    if (!grouped.has(name)) {
      grouped.set(name, []);
      order.push(name);
    }
    grouped.get(name)!.push(operation);
  }

  const groups = order.map((name) => {
    const rawLines = grouped.get(name) ?? [];
    const lines =
      sort && sort.column !== "document_order" && sort.column !== "item_group_name"
        ? sortOperationLines(rawLines, sort)
        : rawLines;
    const total_quantity = +lines.reduce((sum, line) => sum + line.quantity, 0).toFixed(2);
    const total_amount = +lines.reduce((sum, line) => sum + lineAmount(line), 0).toFixed(2);
    return { name, lines, total_quantity, total_amount };
  });

  if (sort?.column === "item_group_name") {
    return [...groups].sort((left, right) => {
      const primary = left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sort.direction === "desc" ? -primary : primary;
    });
  }

  return groups;
}

export function buildOperationTotals(
  operations: WholesaleOperationLine[],
): ReceiptOperationTotals {
  const quantity = +operations.reduce((sum, line) => sum + line.quantity, 0).toFixed(2);
  const amount = +operations.reduce((sum, line) => sum + lineAmount(line), 0).toFixed(2);
  const amount_gross = +operations.reduce((sum, line) => sum + lineGrossAmount(line), 0).toFixed(2);
  const discount = +operations.reduce((sum, line) => sum + lineDiscountAmount(line), 0).toFixed(2);
  return { quantity, amount, amount_gross, discount };
}
