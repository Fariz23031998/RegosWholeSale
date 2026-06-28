import { describe, expect, it } from "vitest";
import { applyTemplateLineSort, sortOperationLines } from "@/lib/receipt-line-sort";
import { buildOperationGroups } from "@/lib/receipt-operation-groups";
import { SAMPLE_RECEIPT_CONTEXT } from "@/lib/receipt-print-context";
import type { WholesaleOperationLine } from "@/lib/sales-api";

const itemDetails = {
  fullname: "Full product name",
  description: "Product description",
  articul: "ART-100",
  color: { name: "Blue" },
  size: { name: "L" },
  producer: { name: "Acme" },
  country: { name: "Germany" },
  icps: null,
  package_code: null,
  department: { name: null },
  vat: { name: null, value: null },
  base_barcode: null,
};

const lines: WholesaleOperationLine[] = [
  {
    id: 1,
    document_id: 1,
    item_id: 10,
    item_code: "200",
    item_name: "Zulu part",
    item_group_id: 2,
    item_group_name: "CTR/Valeo Фирма",
    item_unit_name: "шт",
    item_brand: "Spark",
    quantity: 1,
    price: 10,
    price2: 10,
    amount: 10,
    item: {
      ...itemDetails,
      articul: "ART-200",
      color: { name: "Red" },
    },
  },
  {
    id: 2,
    document_id: 1,
    item_id: 11,
    item_code: "100",
    item_name: "Alpha part",
    item_group_id: 1,
    item_group_name: "Автожон",
    item_unit_name: "шт",
    item_brand: "Nexia",
    quantity: 2,
    price: 5,
    price2: 5,
    amount: 10,
    item: {
      ...itemDetails,
      articul: "ART-100",
      color: { name: "Blue" },
    },
  },
];

describe("receipt line sort", () => {
  it("sorts flat operations by item name", () => {
    const sorted = sortOperationLines(lines, { column: "item_name", direction: "asc" });
    expect(sorted.map((line) => line.item_name)).toEqual(["Alpha part", "Zulu part"]);
  });

  it("sorts flat operations by item articul from nested item details", () => {
    const sorted = sortOperationLines(lines, { column: "item_articul", direction: "asc" });
    expect(sorted.map((line) => line.item?.articul)).toEqual(["ART-100", "ART-200"]);
  });

  it("sorts flat operations by item color name from nested item details", () => {
    const sorted = sortOperationLines(lines, { column: "item_color_name", direction: "asc" });
    expect(sorted.map((line) => line.item?.color.name)).toEqual(["Blue", "Red"]);
  });

  it("sorts lines within each operation group", () => {
    const groups = buildOperationGroups(lines, { column: "item_name", direction: "asc" });
    const ctrGroup = groups.find((group) => group.name === "CTR/Valeo Фирма");
    const autoGroup = groups.find((group) => group.name === "Автожон");
    expect(ctrGroup?.lines[0]?.item_name).toBe("Zulu part");
    expect(autoGroup?.lines[0]?.item_name).toBe("Alpha part");
  });

  it("sorts operation groups by group name", () => {
    const groupedLines: WholesaleOperationLine[] = [
      {
        ...lines[0],
        id: 3,
        item_group_name: "Zulu Group",
      },
      {
        ...lines[1],
        id: 4,
        item_group_name: "Alpha Group",
      },
    ];
    const groups = buildOperationGroups(groupedLines, {
      column: "item_group_name",
      direction: "asc",
    });
    expect(groups.map((group) => group.name)).toEqual(["Alpha Group", "Zulu Group"]);
  });

  it("applies template sort to print context", () => {
    const context = applyTemplateLineSort(
      {
        ...SAMPLE_RECEIPT_CONTEXT,
        operations: lines,
        operation_groups: buildOperationGroups(lines),
      },
      { column: "item_code", direction: "desc" },
    );

    expect(context.operations.map((line) => line.item_code)).toEqual(["200", "100"]);
    expect(context.sale.items[0]?.name).toBe("Zulu part");
  });
});
