import type { Sale } from "@/data/seed";
import {
  buildOperationGroups,
  buildOperationTotals,
  type ReceiptOperationGroup,
} from "@/lib/receipt-operation-groups";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import type {
  ReceiptLineSortColumn,
  ReceiptLineSortDirection,
  ReceiptTemplateLineSort,
} from "@/types/receipt-templates";
import type { WholesaleOperationLine } from "@/lib/sales-api";

export const RECEIPT_LINE_SORT_COLUMNS = [
  "document_order",
  "item_code",
  "item_name",
  "item_group_name",
  "item_brand",
  "item_unit_name",
  "quantity",
  "price",
  "amount",
] as const satisfies readonly ReceiptLineSortColumn[];

export const DEFAULT_RECEIPT_TEMPLATE_LINE_SORT: ReceiptTemplateLineSort = {
  column: "document_order",
  direction: "asc",
};

export function normalizeReceiptTemplateLineSort(
  value: Partial<ReceiptTemplateLineSort> | null | undefined,
): ReceiptTemplateLineSort {
  const column = RECEIPT_LINE_SORT_COLUMNS.includes(value?.column as ReceiptLineSortColumn)
    ? (value!.column as ReceiptLineSortColumn)
    : DEFAULT_RECEIPT_TEMPLATE_LINE_SORT.column;
  const direction: ReceiptLineSortDirection =
    value?.direction === "desc" ? "desc" : "asc";
  return { column, direction };
}

function lineAmount(line: WholesaleOperationLine): number {
  if (line.amount != null) return line.amount;
  return +(line.quantity * line.price).toFixed(2);
}

function readSortValue(
  line: WholesaleOperationLine,
  column: ReceiptLineSortColumn,
): string | number {
  switch (column) {
    case "item_code":
      return line.item_code?.trim().toLowerCase() ?? "";
    case "item_name":
      return line.item_name?.trim().toLowerCase() ?? "";
    case "item_group_name":
      return line.item_group_name?.trim().toLowerCase() ?? "";
    case "item_brand":
      return line.item_brand?.trim().toLowerCase() ?? "";
    case "item_unit_name":
      return line.item_unit_name?.trim().toLowerCase() ?? "";
    case "quantity":
      return line.quantity;
    case "price":
      return line.price;
    case "amount":
      return lineAmount(line);
    case "document_order":
    default:
      return line.id;
  }
}

function compareSortValues(
  left: string | number,
  right: string | number,
  direction: ReceiptLineSortDirection,
): number {
  let result = 0;
  if (typeof left === "number" && typeof right === "number") {
    result = left - right;
  } else {
    result = String(left).localeCompare(String(right), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }
  return direction === "desc" ? -result : result;
}

export function sortOperationLines(
  lines: WholesaleOperationLine[],
  sort: ReceiptTemplateLineSort,
): WholesaleOperationLine[] {
  if (sort.column === "document_order") {
    return [...lines];
  }

  return [...lines].sort((left, right) => {
    const primary = compareSortValues(
      readSortValue(left, sort.column),
      readSortValue(right, sort.column),
      sort.direction,
    );
    if (primary !== 0) return primary;
    return left.id - right.id;
  });
}

function sortOperationGroups(
  groups: ReceiptOperationGroup[],
  sort: ReceiptTemplateLineSort,
): ReceiptOperationGroup[] {
  if (sort.column !== "item_group_name") {
    return groups;
  }

  return [...groups].sort((left, right) =>
    compareSortValues(
      left.name.trim().toLowerCase(),
      right.name.trim().toLowerCase(),
      sort.direction,
    ),
  );
}

function saleItemsFromOperations(operations: WholesaleOperationLine[], sale: Sale): Sale["items"] {
  return operations.map((operation) => ({
    productId: String(operation.item_id),
    name: operation.item_name ?? `Item #${operation.item_id}`,
    price: operation.price,
    qty: operation.quantity,
  }));
}

export function applyTemplateLineSort(
  context: DocumentPrintContext,
  sortInput?: ReceiptTemplateLineSort | null,
): DocumentPrintContext {
  const sort = normalizeReceiptTemplateLineSort(sortInput);
  if (sort.column === "document_order") {
    return context;
  }

  const operations = sortOperationLines(context.operations, sort);
  const operation_groups = sortOperationGroups(
    buildOperationGroups(operations, sort),
    sort,
  );

  return {
    ...context,
    operations,
    operation_groups,
    totals: buildOperationTotals(operations),
    sale: {
      ...context.sale,
      items: saleItemsFromOperations(operations, context.sale),
    },
  };
}
