import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupProductForBarcode } from "./barcode-lookup";
import type { Product } from "@/types/catalog";

vi.mock("@/lib/catalog-api", () => ({
  fetchCatalogProducts: vi.fn(),
}));

import { fetchCatalogProducts } from "@/lib/catalog-api";

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

const defaultOptions = {
  prefixes: DEFAULT_PREFIXES,
  catalogOverrides: {},
  allowOutOfStock: false,
  getInCartQty: () => 0,
  getReservedInOtherTabs: () => 0,
};

describe("lookupProductForBarcode", () => {
  beforeEach(() => {
    vi.mocked(fetchCatalogProducts).mockReset();
  });

  it("resolves internal weight barcode with clamped qty", async () => {
    const product = makeProduct({ id: "p1", code: "2345", unit_name: "kg" });
    vi.mocked(fetchCatalogProducts).mockResolvedValue({
      products: [product],
      next_offset: 0,
      total: 1,
    });

    const result = await lookupProductForBarcode("token", "2202345005004", defaultOptions);

    expect(result).toEqual({ ok: true, product, qty: 0.5 });
    expect(fetchCatalogProducts).toHaveBeenCalledWith("token", expect.objectContaining({
      search: "2345",
    }));
  });

  it("resolves standard barcode with qty 1", async () => {
    const product = makeProduct({ id: "p2", barcode: "4870249813251" });
    vi.mocked(fetchCatalogProducts).mockResolvedValue({
      products: [product],
      next_offset: 0,
      total: 1,
    });

    const result = await lookupProductForBarcode("token", "4870249813251", defaultOptions);

    expect(result).toEqual({ ok: true, product, qty: 1 });
    expect(fetchCatalogProducts).toHaveBeenCalledWith("token", expect.objectContaining({
      search: "4870249813251",
    }));
  });

  it("returns not_found when product is missing", async () => {
    vi.mocked(fetchCatalogProducts).mockResolvedValue({
      products: [],
      next_offset: 0,
      total: 0,
    });

    const result = await lookupProductForBarcode("token", "4870249813251", defaultOptions);

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns invalid_qty for internal barcode with incompatible unit", async () => {
    const product = makeProduct({ id: "p3", code: "2345", unit_type: 1, unit_name: "шт" });
    vi.mocked(fetchCatalogProducts).mockResolvedValue({
      products: [product],
      next_offset: 0,
      total: 1,
    });

    const result = await lookupProductForBarcode("token", "2202345005004", defaultOptions);

    expect(result).toEqual({ ok: false, reason: "invalid_qty" });
  });

  it("returns out_of_stock when cart is full", async () => {
    const product = makeProduct({ id: "p4", code: "2345", stock: 1, unit_name: "kg" });
    vi.mocked(fetchCatalogProducts).mockResolvedValue({
      products: [product],
      next_offset: 0,
      total: 1,
    });

    const result = await lookupProductForBarcode("token", "2202345005004", {
      ...defaultOptions,
      getInCartQty: () => 1,
    });

    expect(result).toEqual({ ok: false, reason: "out_of_stock" });
  });
});
