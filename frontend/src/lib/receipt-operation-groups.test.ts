import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOperationGroups, buildOperationTotals } from "@/lib/receipt-operation-groups";
import type { WholesaleOperationLine } from "@/lib/sales-api";

const nakladnayaDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../templates/receipts/nakladnaya",
);

describe("receipt operation groups", () => {
  it("groups lines by item group name preserving order", () => {
    const operations: WholesaleOperationLine[] = [
      {
        id: 1,
        document_id: 1,
        item_id: 1,
        item_code: "1",
        item_name: "A",
        item_group_name: "Group A",
        quantity: 1,
        price: 10,
        price2: 10,
        amount: 10,
      },
      {
        id: 2,
        document_id: 1,
        item_id: 2,
        item_code: "2",
        item_name: "B",
        item_group_name: "Group B",
        quantity: 2,
        price: 5,
        price2: 5,
        amount: 10,
      },
      {
        id: 3,
        document_id: 1,
        item_id: 3,
        item_code: "3",
        item_name: "C",
        item_group_name: "Group A",
        quantity: 3,
        price: 4,
        price2: 4,
        amount: 12,
      },
    ];

    const groups = buildOperationGroups(operations);
    expect(groups.map((group) => group.name)).toEqual(["Group A", "Group B"]);
    expect(groups[0]?.total_quantity).toBe(4);
    expect(groups[0]?.total_amount).toBe(22);
    expect(buildOperationTotals(operations).amount).toBe(32);
  });

  it("computes gross amount and line discount totals", () => {
    const operations: WholesaleOperationLine[] = [
      {
        id: 1,
        document_id: 1,
        item_id: 1,
        item_code: "1",
        item_name: "A",
        quantity: 5,
        price: 7.192,
        price2: 8.99,
        amount: 35.96,
      },
      {
        id: 2,
        document_id: 1,
        item_id: 2,
        item_code: "2",
        item_name: "B",
        quantity: 9,
        price: 7.192,
        price2: 8.99,
        amount: 64.728,
      },
    ];

    const totals = buildOperationTotals(operations);
    expect(totals.amount).toBeCloseTo(100.688, 2);
    expect(totals.amount_gross).toBeCloseTo(125.86, 2);
    expect(totals.discount).toBeCloseTo(25.172, 2);
  });
});

describe("nakladnaya template files", () => {
  it("ships grouped table markup and css", () => {
    const html = readFileSync(join(nakladnayaDir, "template.html"), "utf8");
    const css = readFileSync(join(nakladnayaDir, "template.css"), "utf8");
    expect(html).toContain("operation_groups");
    expect(html).toContain("Итого по складу");
    expect(css).toContain(".items-table");
  });
});
