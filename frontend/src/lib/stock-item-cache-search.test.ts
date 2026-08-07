import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/types/catalog";
import { buildProductSearchIndex } from "@/lib/catalog-text-search";

vi.mock("@/lib/cache-policy", () => ({
  isCacheEnabled: vi.fn(),
}));

vi.mock("@/store/pos-config", () => ({
  usePosConfig: {
    getState: vi.fn(() => ({
      searchTransliteration: true,
      searchFuzzy: true,
    })),
  },
}));

vi.mock("@/lib/catalog-products-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/catalog-products-db")>();
  return {
    ...actual,
    findProductByBarcode: vi.fn(),
    findProductByCode: vi.fn(),
    hasCachedProductsInScope: vi.fn(),
    getCachedProductEntriesByScope: vi.fn(),
  };
});

import { isCacheEnabled } from "@/lib/cache-policy";
import {
  findProductByBarcode,
  findProductByCode,
  getCachedProductEntriesByScope,
  hasCachedProductsInScope,
} from "@/lib/catalog-products-db";
import {
  mapProductToStockItemSearchHit,
  searchStockItemsFromCache,
} from "./stock-item-cache-search";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "42",
    regos_item_id: 42,
    name: "Milk",
    price: 12.5,
    category: "Dairy",
    stock: 7,
    image: "",
    sku: "42",
    barcode: "4870001112223",
    code: "42",
    articul: "ART-1",
    unit_name: "pcs",
    unit_type: 1,
    ...overrides,
  };
}

function entryFor(product: Product) {
  return { product, searchIndex: buildProductSearchIndex(product) };
}

describe("mapProductToStockItemSearchHit", () => {
  it("maps catalog product fields onto a stock search hit", () => {
    expect(mapProductToStockItemSearchHit(makeProduct())).toEqual({
      id: 42,
      name: "Milk",
      barcode: "4870001112223",
      code: "42",
      articul: "ART-1",
      unit: "pcs",
      unit_piece: true,
      vat_value: null,
      last_purchase_cost: null,
      price: 12.5,
      price2: null,
      quantity_common: 7,
    });
  });

  it("falls back to numeric product id and non-piece units", () => {
    const hit = mapProductToStockItemSearchHit(
      makeProduct({
        regos_item_id: undefined,
        id: "99",
        unit_type: 2,
        unit_name: "kg",
        barcode: "",
        code: "  ",
        articul: undefined,
      }),
    );
    expect(hit).toMatchObject({
      id: 99,
      unit: "kg",
      unit_piece: false,
      barcode: null,
      code: null,
      articul: null,
    });
  });

  it("returns null when id cannot be resolved", () => {
    expect(
      mapProductToStockItemSearchHit(
        makeProduct({ id: "local-only", regos_item_id: undefined }),
      ),
    ).toBeNull();
  });
});

describe("searchStockItemsFromCache", () => {
  beforeEach(() => {
    vi.mocked(isCacheEnabled).mockReset().mockReturnValue(true);
    vi.mocked(hasCachedProductsInScope).mockReset().mockResolvedValue(false);
    vi.mocked(getCachedProductEntriesByScope).mockReset().mockResolvedValue([]);
    vi.mocked(findProductByBarcode).mockReset().mockResolvedValue(null);
    vi.mocked(findProductByCode).mockReset().mockResolvedValue(null);
  });

  it("returns null when cache is disabled", async () => {
    vi.mocked(isCacheEnabled).mockReturnValue(false);

    await expect(
      searchStockItemsFromCache({
        term: "milk",
        companyId: 1,
        warehouseId: 2,
        priceTypeId: 3,
      }),
    ).resolves.toBeNull();

    expect(hasCachedProductsInScope).not.toHaveBeenCalled();
    expect(getCachedProductEntriesByScope).not.toHaveBeenCalled();
  });

  it("returns null when the catalog scope has no products", async () => {
    vi.mocked(hasCachedProductsInScope).mockResolvedValue(false);

    await expect(
      searchStockItemsFromCache({
        term: "milk",
        companyId: 1,
        warehouseId: 2,
        priceTypeId: 3,
      }),
    ).resolves.toBeNull();

    expect(hasCachedProductsInScope).toHaveBeenCalledWith("1:2:3");
    expect(getCachedProductEntriesByScope).not.toHaveBeenCalled();
  });

  it("returns empty hits when cache is populated but nothing matches", async () => {
    vi.mocked(hasCachedProductsInScope).mockResolvedValue(true);
    vi.mocked(getCachedProductEntriesByScope).mockResolvedValue([
      entryFor(makeProduct({ id: "2", regos_item_id: 2, name: "Хлеб", barcode: "1", code: "2" })),
    ]);

    await expect(
      searchStockItemsFromCache({
        term: "zzzz-no-match",
        companyId: 1,
        warehouseId: 2,
        priceTypeId: 3,
      }),
    ).resolves.toEqual([]);
  });

  it("returns barcode exact matches from cache without catalog text search", async () => {
    const product = makeProduct();
    vi.mocked(findProductByBarcode).mockResolvedValue(product);

    const hits = await searchStockItemsFromCache({
      term: "4870001112223",
      companyId: 1,
      warehouseId: 2,
      priceTypeId: 3,
    });

    expect(hits).toEqual([mapProductToStockItemSearchHit(product)]);
    expect(findProductByBarcode).toHaveBeenCalledWith("1:2:3", "4870001112223");
    expect(hasCachedProductsInScope).not.toHaveBeenCalled();
    expect(getCachedProductEntriesByScope).not.toHaveBeenCalled();
  });

  it("matches Latin queries to Cyrillic names via catalog transliteration", async () => {
    const milk = makeProduct({ id: "1", regos_item_id: 1, name: "Молоко 3.2%" });
    const other = makeProduct({ id: "2", regos_item_id: 2, name: "Хлеб", barcode: "1", code: "2" });
    vi.mocked(hasCachedProductsInScope).mockResolvedValue(true);
    vi.mocked(getCachedProductEntriesByScope).mockResolvedValue([
      entryFor(milk),
      entryFor(other),
    ]);

    const hits = await searchStockItemsFromCache({
      term: "moloko",
      companyId: 1,
      warehouseId: 2,
      priceTypeId: 3,
      limit: 20,
    });

    expect(hits?.map((h) => h.id)).toEqual([1]);
    expect(hits?.[0]?.name).toBe("Молоко 3.2%");
    expect(getCachedProductEntriesByScope).toHaveBeenCalledTimes(1);
  });

  it("ranks fuzzy transliterated matches below closer names", async () => {
    const exact = makeProduct({ id: "1", regos_item_id: 1, name: "Молоко", barcode: "1", code: "1" });
    const fuzzy = makeProduct({ id: "2", regos_item_id: 2, name: "Малако", barcode: "2", code: "2" });
    vi.mocked(hasCachedProductsInScope).mockResolvedValue(true);
    vi.mocked(getCachedProductEntriesByScope).mockResolvedValue([
      entryFor(fuzzy),
      entryFor(exact),
    ]);

    const hits = await searchStockItemsFromCache({
      term: "moloko",
      companyId: 1,
      warehouseId: 2,
      priceTypeId: 3,
    });

    expect(hits?.map((h) => h.id)).toEqual([1, 2]);
  });
});
