import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/types/catalog";

// Mock IDBKeyRange since it might not be available in Node test environment
if (typeof globalThis.IDBKeyRange === "undefined") {
  globalThis.IDBKeyRange = {
    only: (value: any) => ({ lower: value, upper: value, lowerOpen: false, upperOpen: false } as IDBKeyRange),
    bound: (lower: any, upper: any) => ({ lower, upper, lowerOpen: false, upperOpen: false } as IDBKeyRange),
  } as any;
}

let memory = new Map<string, any>();

function createMockDb(): IDBDatabase {
  return {
    transaction: (storeNames: string | string[], mode: "readonly" | "readwrite") => {
      const tx = {
        objectStore: (storeName: string) => ({
          put: (record: any) => {
            memory.set(record.key, structuredClone(record));
            const request = {
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          get: (key: string) => {
            const request = {
              result: memory.get(key),
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          delete: (key: string) => {
            memory.delete(key);
            const request = {
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          index: (indexName: string) => ({
            openCursor: (range?: IDBKeyRange) => {
              const records = [...memory.values()].filter(record => {
                if (!range) return true;
                if (indexName === "scopeKey") {
                  return record.scopeKey === range.lower;
                }
                if (indexName === "barcode") {
                  return record.barcode === range.lower;
                }
                if (indexName === "code") {
                  return record.code === range.lower;
                }
                return true;
              });

              let cursorIndex = 0;
              const request = {
                result: null as any,
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
              };

              const advanceCursor = () => {
                if (cursorIndex < records.length) {
                  request.result = {
                    value: records[cursorIndex],
                    primaryKey: records[cursorIndex].key,
                    continue: () => {
                      cursorIndex++;
                      advanceCursor();
                    }
                  };
                } else {
                  request.result = null;
                }
                queueMicrotask(() => request.onsuccess?.());
              };

              advanceCursor();
              return request;
            }
          }),
          openCursor: (range?: IDBKeyRange) => {
            const keys = [...memory.keys()].filter(k => {
              if (!range) return true;
              const lower = range.lower as string;
              const upper = range.upper as string;
              return k >= lower && k <= upper;
            });

            let cursorIndex = 0;
            const request = {
              result: null as any,
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };

            const advanceCursor = () => {
              if (cursorIndex < keys.length) {
                request.result = {
                  value: memory.get(keys[cursorIndex]),
                  primaryKey: keys[cursorIndex],
                  continue: () => {
                    cursorIndex++;
                    advanceCursor();
                  }
                };
              } else {
                request.result = null;
              }
              queueMicrotask(() => request.onsuccess?.());
            };

            advanceCursor();
            return request;
          }
        }),
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
    close: vi.fn(),
  } as unknown as IDBDatabase;
}

vi.mock("@/lib/pulse-pos-db", () => ({
  openPulsePosDb: vi.fn(async () => createMockDb()),
  CATALOG_PRODUCTS_STORE: "catalog-products",
  CATALOG_PAGES_STORE: "catalog-pages",
  CATALOG_GROUPS_STORE: "catalog-groups",
  buildCatalogProductKey: (scopeKey: string, productId: string) => `${scopeKey}:${productId}`,
}));

import {
  upsertProducts,
  removeProducts,
  findProductByBarcode,
  getCachedProductsByScope,
  getCachedProductEntriesByScope,
  filterAndSortCachedProducts,
} from "./catalog-products-db";

describe("catalog-products-db multi-barcode indexing", () => {
  beforeEach(() => {
    memory.clear();
  });

  const sampleProduct: Product = {
    id: "101",
    regos_item_id: 101,
    name: "Multi-Barcode Item",
    price: 1500,
    category: "Groceries",
    stock: 10,
    image: "",
    sku: "M-101",
    barcode: "4601234567890",
    barcode_list: "4601234567890, 88888888, 99999999",
    code: "C-101",
  };

  it("should save a product with multiple barcodes and allow looking it up by any barcode", async () => {
    await upsertProducts("1:2:3", [sampleProduct]);

    // Check that we can lookup using base barcode
    const p1 = await findProductByBarcode("1:2:3", "4601234567890");
    expect(p1).toBeDefined();
    expect(p1?.id).toBe("101");

    // Check that we can lookup using the second barcode from barcode_list
    const p2 = await findProductByBarcode("1:2:3", "88888888");
    expect(p2).toBeDefined();
    expect(p2?.id).toBe("101");

    // Check that we can lookup using the third barcode from barcode_list
    const p3 = await findProductByBarcode("1:2:3", "99999999");
    expect(p3).toBeDefined();
    expect(p3?.id).toBe("101");
  });

  it("should return unique products when querying by scope", async () => {
    await upsertProducts("1:2:3", [sampleProduct]);

    const products = await getCachedProductsByScope("1:2:3");
    // Should be exactly 1 product returned (no duplicates despite multiple entries in DB)
    expect(products).toHaveLength(1);
    expect(products[0].id).toBe("101");
  });

  it("should store a precomputed searchIndex on upsert", async () => {
    await upsertProducts("1:2:3", [sampleProduct]);
    const entries = await getCachedProductEntriesByScope("1:2:3");
    expect(entries).toHaveLength(1);
    expect(entries[0].searchIndex.length).toBeGreaterThan(0);
    expect(entries[0].searchIndex).toContain("multi");
  });

  it("should filter catalog search using any barcode in barcode_list in-memory", () => {
    const response = filterAndSortCachedProducts([sampleProduct], { search: "88888888" });
    expect(response.products).toHaveLength(1);
    expect(response.products[0].id).toBe("101");
  });

  it("should match Latin search against Cyrillic product names", () => {
    const milk: Product = {
      ...sampleProduct,
      id: "201",
      name: "Молоко 3.2%",
      barcode: "111",
      barcode_list: "111",
      code: "201",
    };
    const bread: Product = {
      ...sampleProduct,
      id: "202",
      name: "Хлеб белый",
      barcode: "222",
      barcode_list: "222",
      code: "202",
    };

    const response = filterAndSortCachedProducts([milk, bread], {
      search: "moloko",
      includeZeroQuantity: true,
      includeZeroPrice: true,
    });
    expect(response.products.map((p) => p.id)).toEqual(["201"]);
  });

  it("should match Cyrillic search against Latin product names", () => {
    const milk: Product = {
      ...sampleProduct,
      id: "301",
      name: "Moloko Fresh",
      barcode: "333",
      barcode_list: "333",
      code: "301",
    };

    const response = filterAndSortCachedProducts([milk], {
      search: "молоко",
      includeZeroQuantity: true,
      includeZeroPrice: true,
    });
    expect(response.products).toHaveLength(1);
    expect(response.products[0].id).toBe("301");
  });

  it("should rank closer name matches above weaker ones", () => {
    const exact: Product = {
      ...sampleProduct,
      id: "401",
      name: "Молоко",
      barcode: "401",
      barcode_list: "401",
      code: "401",
    };
    const weaker: Product = {
      ...sampleProduct,
      id: "402",
      name: "Малако продукт",
      barcode: "402",
      barcode_list: "402",
      code: "402",
    };

    const response = filterAndSortCachedProducts([weaker, exact], {
      search: "moloko",
      includeZeroQuantity: true,
      includeZeroPrice: true,
    });
    expect(response.products[0].id).toBe("401");
  });

  it("should surface short numeric product codes on the first page", () => {
    const noise = Array.from({ length: 30 }, (_, index) => ({
      ...sampleProduct,
      id: `noise-${index}`,
      name: `Noise ${String.fromCharCode(65 + (index % 26))}${index}`,
      code: String(1000 + index),
      barcode: `46000000000${String(index).padStart(2, "0")}`,
      barcode_list: `46000000000${String(index).padStart(2, "0")}`,
      stock: 5,
      price: 10,
    }));
    const match: Product = {
      ...sampleProduct,
      id: "match-1",
      name: "Zebra short code",
      code: "1",
      barcode: "9999999999999",
      barcode_list: "9999999999999",
      stock: 5,
      price: 10,
    };

    const response = filterAndSortCachedProducts([...noise, match], {
      search: "1",
      limit: 20,
      includeZeroQuantity: true,
      includeZeroPrice: true,
    });

    expect(response.products[0]?.id).toBe("match-1");
    expect(response.products.some((p) => p.id === "match-1")).toBe(true);
  });

  it("should exclude zero quantity and zero price products unless included", () => {
    const zeroStock: Product = { ...sampleProduct, id: "102", stock: 0, price: 10 };
    const zeroPrice: Product = { ...sampleProduct, id: "103", stock: 5, price: 0 };
    const products = [sampleProduct, zeroStock, zeroPrice];

    const excluded = filterAndSortCachedProducts(products, {
      includeZeroQuantity: false,
      includeZeroPrice: false,
    });
    expect(excluded.products.map((p) => p.id)).toEqual(["101"]);

    const withZeroStock = filterAndSortCachedProducts(products, {
      includeZeroQuantity: true,
      includeZeroPrice: false,
    });
    expect(withZeroStock.products.map((p) => p.id).sort()).toEqual(["101", "102"]);

    const withBoth = filterAndSortCachedProducts(products, {
      includeZeroQuantity: true,
      includeZeroPrice: true,
    });
    expect(withBoth.products.map((p) => p.id).sort()).toEqual(["101", "102", "103"]);
  });

  it("should only return featured products when featuredOnly is set", () => {
    const other: Product = {
      ...sampleProduct,
      id: "202",
      regos_item_id: 202,
      name: "Water",
    };
    const products = [sampleProduct, other];

    const featured = filterAndSortCachedProducts(products, {
      featuredOnly: true,
      featuredProductIds: [101],
      includeZeroQuantity: true,
      includeZeroPrice: true,
    });
    expect(featured.products.map((p) => p.id)).toEqual(["101"]);
    expect(featured.total).toBe(1);

    const emptyFeatured = filterAndSortCachedProducts(products, {
      featuredOnly: true,
      featuredProductIds: [],
      includeZeroQuantity: true,
      includeZeroPrice: true,
    });
    expect(emptyFeatured.products).toEqual([]);
    expect(emptyFeatured.total).toBe(0);
  });

  it("should restrict products to allowedGroupIds when set", () => {
    const other: Product = {
      ...sampleProduct,
      id: "202",
      regos_item_id: 202,
      group_id: 5,
      name: "Water",
    };
    const inScope: Product = {
      ...sampleProduct,
      group_id: 2,
    };
    const products = [inScope, other];

    const scoped = filterAndSortCachedProducts(products, {
      allowedGroupIds: [2],
      includeZeroQuantity: true,
      includeZeroPrice: true,
    });
    expect(scoped.products.map((p) => p.id)).toEqual(["101"]);

    const unrestricted = filterAndSortCachedProducts(products, {
      includeZeroQuantity: true,
      includeZeroPrice: true,
    });
    expect(unrestricted.products.map((p) => p.id).sort()).toEqual(["101", "202"]);
  });

  it("should remove all barcode entries when removeProducts is called", async () => {
    await upsertProducts("1:2:3", [sampleProduct]);

    // Verify it exists first
    let p = await findProductByBarcode("1:2:3", "88888888");
    expect(p).not.toBeNull();

    // Remove
    await removeProducts("1:2:3", ["101"]);

    // Verify all entries are deleted
    const pDeletedMain = await findProductByBarcode("1:2:3", "4601234567890");
    const pDeletedAlt = await findProductByBarcode("1:2:3", "88888888");
    expect(pDeletedMain).toBeNull();
    expect(pDeletedAlt).toBeNull();

    // Verify database is completely empty
    expect(memory.size).toBe(0);
  });
});
