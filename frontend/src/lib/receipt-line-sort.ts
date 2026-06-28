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
import {
  normalizeReceiptOperationItem,
  receiptOperationTemplateFields,
} from "@/lib/receipt-operation-item";
import type { WholesaleOperationLine } from "@/lib/sales-api";

export const RECEIPT_LINE_SORT_COLUMNS = [
  "document_order",
  "item_code",
  "item_name",
  "item_group_name",
  "item_brand",
  "item_fullname",
  "item_description",
  "item_articul",
  "item_color_name",
  "item_size_name",
  "item_producer_name",
  "item_country_name",
  "item_unit_name",
  "quantity",
  "price",
  "amount",
] as const satisfies readonly ReceiptLineSortColumn[];

const ITEM_TEMPLATE_SORT_COLUMNS = new Set<ReceiptLineSortColumn>([
  "item_fullname",
  "item_description",
  "item_articul",
  "item_color_name",
  "item_size_name",
  "item_producer_name",
  "item_country_name",
]);

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

function readItemTemplateSortValue(
  line: WholesaleOperationLine,
  column: ReceiptLineSortColumn,
): string {
  const fields = receiptOperationTemplateFields(normalizeReceiptOperationItem(line.item));
  const value = fields[column as keyof typeof fields];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readSortValue(
  line: WholesaleOperationLine,
  column: ReceiptLineSortColumn,
): string | number {
  if (ITEM_TEMPLATE_SORT_COLUMNS.has(column)) {
    return readItemTemplateSortValue(line, column);
  }

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
