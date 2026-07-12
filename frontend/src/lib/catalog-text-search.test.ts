import { describe, expect, it } from "vitest";
import type { Product } from "@/types/catalog";
import {
  buildProductSearchIndex,
  expandSearchVariants,
  normalizeSearchText,
  scoreCatalogMatch,
  transliterateCyrToLat,
  transliterateLatToCyr,
} from "./catalog-text-search";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "1",
    name: "Молоко",
    price: 100,
    category: "",
    stock: 1,
    image: "",
    sku: "SKU-1",
    code: "100",
    barcode: "4600000000001",
    ...overrides,
  };
}

describe("catalog-text-search transliteration", () => {
  it("transliterates Latin to Cyrillic with digraphs", () => {
    expect(transliterateLatToCyr("moloko")).toBe("молоко");
    expect(transliterateLatToCyr("shokolad")).toBe("шоколад");
    expect(transliterateLatToCyr("chay")).toBe("чай");
  });

  it("transliterates Cyrillic to Latin with digraphs", () => {
    expect(transliterateCyrToLat("молоко")).toBe("moloko");
    expect(transliterateCyrToLat("шоколад")).toBe("shokolad");
    expect(transliterateCyrToLat("чай")).toBe("chay");
  });

  it("expands query into Latin and Cyrillic variants", () => {
    const variants = expandSearchVariants("moloko");
    expect(variants).toContain("moloko");
    expect(variants).toContain("молоко");
  });

  it("expands Cyrillic queries into Latin variants", () => {
    const variants = expandSearchVariants("молоко");
    expect(variants).toContain("молоко");
    expect(variants).toContain("moloko");
  });

  it("normalizes case and punctuation", () => {
    expect(normalizeSearchText("  Молоко!!! ")).toBe("молоко");
  });
});

describe("catalog-text-search scoring", () => {
  it("matches Latin query against Cyrillic product name", () => {
    const p = product({ name: "Молоко 3.2%" });
    const index = buildProductSearchIndex(p);
    const score = scoreCatalogMatch("moloko", index, p);
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(0);
  });

  it("matches Cyrillic query against Latin product name", () => {
    const p = product({ name: "Moloko Fresh" });
    const index = buildProductSearchIndex(p);
    const score = scoreCatalogMatch("молоко", index, p);
    expect(score).not.toBeNull();
  });

  it("ranks prefix matches higher than fuzzy matches", () => {
    const exactish = product({ id: "1", name: "Молоко" });
    const fuzzy = product({ id: "2", name: "Малако" });
    const exactScore = scoreCatalogMatch("moloko", buildProductSearchIndex(exactish), exactish)!;
    const fuzzyScore = scoreCatalogMatch("moloko", buildProductSearchIndex(fuzzy), fuzzy)!;
    expect(exactScore).toBeGreaterThan(fuzzyScore);
  });

  it("ranks exact code highest", () => {
    const p = product({ code: "4242", name: "Something else" });
    const score = scoreCatalogMatch("4242", buildProductSearchIndex(p), p)!;
    expect(score).toBeGreaterThanOrEqual(1000);
  });

  it("ranks short numeric product code above barcode substring noise", () => {
    const byCode = product({
      id: "code",
      code: "1",
      name: "Exact code product",
      barcode: "9999999999999",
      barcode_list: "9999999999999",
    });
    const byBarcodeNoise = product({
      id: "noise",
      code: "999",
      name: "Barcode contains one",
      barcode: "4600000000001",
      barcode_list: "4600000000001 4600000000011",
    });

    const codeScore = scoreCatalogMatch("1", buildProductSearchIndex(byCode), byCode)!;
    const noiseScore = scoreCatalogMatch(
      "1",
      buildProductSearchIndex(byBarcodeNoise),
      byBarcodeNoise,
    )!;

    expect(codeScore).toBeGreaterThanOrEqual(1000);
    expect(codeScore).toBeGreaterThan(noiseScore);
  });

  it("matches short numeric queries to codes with leading zeros", () => {
    const p = product({ code: "084", name: "Zero padded", barcode: "999" });
    const score = scoreCatalogMatch("84", buildProductSearchIndex(p), p)!;
    expect(score).toBeGreaterThanOrEqual(1000);
  });

  it("allows light typos on longer tokens", () => {
    const p = product({ name: "Шоколад" });
    const score = scoreCatalogMatch("shoklad", buildProductSearchIndex(p), p);
    expect(score).not.toBeNull();
  });

  it("returns null when nothing matches", () => {
    const p = product({ name: "Хлеб", code: "9", barcode: "1" });
    expect(scoreCatalogMatch("pizza", buildProductSearchIndex(p), p)).toBeNull();
  });
});
