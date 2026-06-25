import { describe, expect, it } from "vitest";
import {
  expandOperationTemplateFields,
  normalizeReceiptOperationItem,
  receiptOperationItemFromCatalogProduct,
} from "@/lib/receipt-operation-item";

describe("receipt operation item", () => {
  it("maps catalog product fields into item", () => {
    const item = receiptOperationItemFromCatalogProduct({
      name: "Widget",
      sku: "WDG-1",
      barcode: "123",
      category: "Parts",
    });
    expect(item.fullname).toBe("Widget");
    expect(item.articul).toBe("WDG-1");
    expect(item.base_barcode).toBe("123");
    expect(item.department.name).toBe("Parts");
  });

  it("normalizes nested item fields", () => {
    const item = normalizeReceiptOperationItem({
      articul: "A-1",
      color: { name: "Blue" },
      vat: { name: "VAT", value: 12 },
    });
    expect(item.articul).toBe("A-1");
    expect(item.color.name).toBe("Blue");
    expect(item.vat.value).toBe(12);
  });

  it("flattens item fields for template variables", () => {
    const line = expandOperationTemplateFields({
      id: 1,
      document_id: 10,
      item_id: 99,
      item_code: "99",
      item_name: "Widget",
      quantity: 2,
      price: 5,
      price2: 5,
      amount: 10,
      item: {
        articul: "A-1",
        color: { name: "Blue" },
        vat: { name: "VAT", value: 12 },
      },
    });
    expect(line.item_articul).toBe("A-1");
    expect(line.item_color_name).toBe("Blue");
    expect(line.item_vat_name).toBe("VAT");
    expect(line.item_vat_value).toBe(12);
  });
});
