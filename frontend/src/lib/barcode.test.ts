import { describe, expect, it } from "vitest";
import {
  findProductByBarcode,
  findProductByCode,
  gramsToCartQty,
  internalBarcodeToQty,
  isBarcodeInput,
  normalizeProductCode,
  parseInternalBarcode,
} from "./barcode";
import type { Product } from "@/types/catalog";

const DEFAULT_PREFIXES = { weightPrefix: "22", piecePrefix: "23" };

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "1",
    regos_item_id: 1,
    name: "Test",
    price: 10,
    category: "Cat",
    stock: 100,
    image: "",
    sku: "123",
    barcode: "",
    code: "123",
    unit_name: "kg",
    unit_type: 2,
    ...overrides,
  };
}

describe("isBarcodeInput", () => {
  it("returns true for 12+ digit-only strings", () => {
    expect(isBarcodeInput("123456789012")).toBe(true);
    expect(isBarcodeInput("2202345005004")).toBe(true);
  });

  it("returns false for shorter or non-digit input", () => {
    expect(isBarcodeInput("12345678901")).toBe(false);
    expect(isBarcodeInput("cola")).toBe(false);
    expect(isBarcodeInput("123abc456789012")).toBe(false);
  });
});

describe("normalizeProductCode", () => {
  it("strips leading zeros", () => {
    expect(normalizeProductCode("02345")).toBe("2345");
    expect(normalizeProductCode("00123")).toBe("123");
    expect(normalizeProductCode("00000")).toBe("0");
  });
});

describe("parseInternalBarcode", () => {
  it("parses weight barcode example", () => {
    const parsed = parseInternalBarcode("2202345005004", DEFAULT_PREFIXES);
    expect(parsed).toEqual({
      kind: "weight",
      productCode: "2345",
      rawValue: 500,
    });
  });

  it("parses piece barcode example", () => {
    const parsed = parseInternalBarcode("2300123000249", DEFAULT_PREFIXES);
    expect(parsed).toEqual({
      kind: "piece",
      productCode: "123",
      rawValue: 24,
    });
  });

  it("returns null for wrong length or unknown prefix", () => {
    expect(parseInternalBarcode("220234500500", DEFAULT_PREFIXES)).toBeNull();
    expect(parseInternalBarcode("9900123000249", DEFAULT_PREFIXES)).toBeNull();
  });

  it("respects custom prefixes", () => {
    const parsed = parseInternalBarcode("5500123000249", {
      weightPrefix: "55",
      piecePrefix: "23",
    });
    expect(parsed?.kind).toBe("weight");
    expect(parsed?.productCode).toBe("123");
  });

  it("disables type when prefix is empty", () => {
    expect(
      parseInternalBarcode("2202345005004", {
        weightPrefix: "",
        piecePrefix: "23",
      }),
    ).toBeNull();
  });
});

describe("gramsToCartQty", () => {
  it("converts grams to kg", () => {
    expect(gramsToCartQty(500, "kg", 2)).toBe(0.5);
    expect(gramsToCartQty(500, "кг", 2)).toBe(0.5);
  });

  it("keeps grams for gram units", () => {
    expect(gramsToCartQty(500, "g", 2)).toBe(500);
    expect(gramsToCartQty(500, "г", 2)).toBe(500);
  });

  it("defaults non-piece unknown units to kg", () => {
    expect(gramsToCartQty(500, "liter", 2)).toBe(0.5);
  });

  it("returns null for piece products", () => {
    expect(gramsToCartQty(500, "шт", 1)).toBeNull();
  });
});

describe("internalBarcodeToQty", () => {
  it("maps weight barcode to cart qty", () => {
    const parsed = parseInternalBarcode("2202345005004", DEFAULT_PREFIXES)!;
    expect(internalBarcodeToQty(parsed, makeProduct({ unit_name: "kg" }))).toBe(0.5);
  });

  it("maps piece barcode to cart qty", () => {
    const parsed = parseInternalBarcode("2300123000249", DEFAULT_PREFIXES)!;
    expect(internalBarcodeToQty(parsed, makeProduct({ unit_type: 1 }))).toBe(24);
  });
});

describe("findProductByCode", () => {
  const products = [
    makeProduct({ id: "1", code: "2345" }),
    makeProduct({ id: "2", code: "999" }),
  ];

  it("finds by normalized code", () => {
    expect(findProductByCode(products, "02345")?.id).toBe("1");
    expect(findProductByCode(products, "888")).toBeUndefined();
  });
});

describe("findProductByBarcode", () => {
  const products = [
    makeProduct({ id: "1", barcode: "4870249813251" }),
    makeProduct({ id: "2", barcode: "other" }),
  ];

  it("prefers exact barcode match", () => {
    expect(findProductByBarcode(products, "4870249813251")?.id).toBe("1");
  });

  it("falls back to first product", () => {
    expect(findProductByBarcode(products, "unknown")?.id).toBe("1");
  });
});
