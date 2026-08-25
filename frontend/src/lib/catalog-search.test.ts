import { describe, expect, it } from "vitest";
import {
  isShortNumericCodeSearch,
  prioritizeCatalogProductsByCode,
} from "./catalog-search";
import type { Product } from "@/types/catalog";

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

describe("isShortNumericCodeSearch", () => {
  it("returns true for 1–6 digit-only terms", () => {
    expect(isShortNumericCodeSearch("084")).toBe(true);
    expect(isShortNumericCodeSearch("1")).toBe(true);
    expect(isShortNumericCodeSearch("123456")).toBe(true);
  });

  it("returns false for longer, mixed, or empty terms", () => {
    expect(isShortNumericCodeSearch("1234567")).toBe(false);
    expect(isShortNumericCodeSearch("12abc")).toBe(false);
    expect(isShortNumericCodeSearch("")).toBe(false);
    expect(isShortNumericCodeSearch("  ")).toBe(false);
  });
});

describe("prioritizeCatalogProductsByCode", () => {
  it("moves code matches to the front with leading-zero normalization", () => {
    const products = [
      makeProduct({ id: "1", name: "Other", code: "999" }),
      makeProduct({ id: "2", name: "Match", code: "84" }),
      makeProduct({ id: "3", name: "Also other", code: "100" }),
      makeProduct({ id: "4", name: "Also match", code: "084" }),
    ];

    const result = prioritizeCatalogProductsByCode(products, "084");

    expect(result.map((p) => p.id)).toEqual(["2", "4", "1", "3"]);
  });

  it("preserves relative order within matches and non-matches", () => {
    const products = [
      makeProduct({ id: "a", code: "10" }),
      makeProduct({ id: "b", code: "20" }),
      makeProduct({ id: "c", code: "10" }),
      makeProduct({ id: "d", code: "30" }),
    ];

    const result = prioritizeCatalogProductsByCode(products, "10");

    expect(result.map((p) => p.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("returns input unchanged for non-short numeric terms", () => {
    const products = [
      makeProduct({ id: "1", code: "84" }),
      makeProduct({ id: "2", code: "99" }),
    ];

    expect(prioritizeCatalogProductsByCode(products, "cola")).toBe(products);
    expect(prioritizeCatalogProductsByCode(products, "1234567")).toBe(products);
  });
});
