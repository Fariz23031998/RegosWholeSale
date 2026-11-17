import { describe, expect, it } from "vitest";
import {
  maxEnteredQty,
  productHasSecondaryUnit,
  resolveUnitPrice,
  toBaseQty,
  toDisplayUnitMoney,
  toEnteredQty,
  toMainUnitMoney,
  unitMetaForSelection,
} from "@/lib/secondary-units";
import { UNIT_TYPE_NON_PIECE, UNIT_TYPE_PIECE } from "@/lib/cart-stock";
import type { Product } from "@/types/catalog";

describe("maxEnteredQty", () => {
  it("floors piece secondary qty so conversion cannot exceed stock", () => {
    // stock 23, factor 13 → at most 1 package (not 1.77 rounded to 2)
    expect(maxEnteredQty(23, 13, UNIT_TYPE_PIECE)).toBe(1);
    expect(maxEnteredQty(26, 13, UNIT_TYPE_PIECE)).toBe(2);
    expect(maxEnteredQty(12, 13, UNIT_TYPE_PIECE)).toBe(0);
  });

  it("keeps fractional max for non-piece units", () => {
    expect(maxEnteredQty(23, 13, UNIT_TYPE_NON_PIECE)).toBe(1.769);
  });
});

describe("resolveUnitPrice", () => {
  const product: Product = {
    id: "1",
    name: "Box item",
    price: 1000,
    secondary_price: 900,
    category: "test",
    stock: 10,
    image: "",
    sku: "SKU",
    conversion_factor: 12,
    secondary_unit_id: 2,
  };

  it("uses secondary_price for secondary unit when present", () => {
    expect(resolveUnitPrice(product, "secondary")).toBe(900);
  });

  it("falls back to main price when secondary_price is missing", () => {
    expect(
      resolveUnitPrice({ ...product, secondary_price: null }, "secondary"),
    ).toBe(1000);
  });

  it("always uses main price for main unit", () => {
    expect(resolveUnitPrice(product, "main")).toBe(1000);
  });
});

describe("stock-shaped secondary unit helpers", () => {
  const stockHit = {
    unit_name: "pcs",
    unit_type: UNIT_TYPE_PIECE,
    secondary_unit_id: 2,
    secondary_unit_name: "box",
    secondary_unit_type: UNIT_TYPE_PIECE,
    conversion_factor: 12,
  };

  it("detects secondary unit on stock hit shape", () => {
    expect(productHasSecondaryUnit(stockHit)).toBe(true);
    expect(
      productHasSecondaryUnit({ ...stockHit, conversion_factor: null }),
    ).toBe(false);
  });

  it("converts entered secondary qty to base for stock submit", () => {
    const meta = unitMetaForSelection(stockHit, "secondary");
    expect(meta.conversionFactor).toBe(12);
    expect(meta.selectedUnitName).toBe("box");
    expect(toBaseQty(2, meta.conversionFactor)).toBe(24);
    expect(toEnteredQty(24, meta.conversionFactor)).toBe(2);
  });
});

describe("toDisplayUnitMoney / toMainUnitMoney", () => {
  it("scales main cost/price by conversion factor for secondary display", () => {
    expect(toDisplayUnitMoney(100, 12)).toBe(1200);
    expect(toMainUnitMoney(1200, 12)).toBe(100);
  });

  it("rounds to 4 decimal places", () => {
    expect(toDisplayUnitMoney(10.12345, 3)).toBe(30.3704);
    expect(toMainUnitMoney(30.3704, 3)).toBe(10.1235);
  });

  it("treats non-positive factor as 1", () => {
    expect(toDisplayUnitMoney(100, 0)).toBe(100);
    expect(toDisplayUnitMoney(100, -2)).toBe(100);
    expect(toMainUnitMoney(100, 0)).toBe(100);
    expect(toMainUnitMoney(100, -2)).toBe(100);
  });
});
