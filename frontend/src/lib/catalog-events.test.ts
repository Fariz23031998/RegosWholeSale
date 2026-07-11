import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the APIs and DB methods returning Promises to support .catch()
vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(() => Promise.resolve({ ok: true, result: [] })),
  getApiBaseUrl: vi.fn(() => "http://localhost"),
}));
vi.mock("@/lib/catalog-api", () => ({
  fetchProductsByIds: vi.fn(() => Promise.resolve({ products: [], next_offset: 0, total: 0 })),
}));
vi.mock("@/lib/catalog-products-db", () => ({
  upsertProducts: vi.fn(() => Promise.resolve()),
  removeProducts: vi.fn(() => Promise.resolve()),
  invalidateGroups: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/catalog-products-db/loadCachedProduct/loadCachedProduct", () => ({
  loadCachedProduct: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@/lib/catalog-products-db/loadCachedProductIdsByScope/loadCachedProductIdsByScope", () => ({
  loadCachedProductIdsByScope: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/lib/catalog-service", () => ({
  refreshProductsByIds: vi.fn(() => Promise.resolve({ products: [], next_offset: 0, total: 0 })),
}));

import { apiRequest } from "@/lib/api";
import { fetchProductsByIds } from "@/lib/catalog-api";
import { upsertProducts, removeProducts, invalidateGroups } from "@/lib/catalog-products-db";
import { loadCachedProduct } from "@/lib/catalog-products-db/loadCachedProduct/loadCachedProduct";
import { loadCachedProductIdsByScope } from "@/lib/catalog-products-db/loadCachedProductIdsByScope/loadCachedProductIdsByScope";
import { handleCatalogEvent } from "./catalog-events";

describe("Selective SSE updates", () => {
  const token = "test-token";
  const context = {
    companyId: 1,
    warehouseId: 2,
    priceTypeId: 3,
    canChangeWarehouse: true,
    canChangePriceType: true,
  };
  let handlers: any;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {
      onProductsUpdated: vi.fn(),
      onProductsRemoved: vi.fn(),
      onGroupsInvalidated: vi.fn(),
    };
  });

  it("DocSetPricePerformed updates only product price and leaves quantity unchanged", async () => {
    const event = {
      type: "products_updated" as const,
      regos_item_ids: [101],
      source_action: "DocSetPricePerformed",
      occurred_at: "2026-07-11T14:49:06Z",
    };

    // Mock existing product in IndexedDB: stock is 5, price is 100
    vi.mocked(loadCachedProduct).mockResolvedValue({
      id: "101",
      regos_item_id: 101,
      name: "Test Item",
      price: 100,
      stock: 5,
      sku: "TEST-101",
      category: "Test",
      image: "",
    });

    // Mock fresh product fetched from server: price is now 150, stock is 99 (should be ignored)
    vi.mocked(fetchProductsByIds).mockResolvedValue({
      products: [
        {
          id: "101",
          regos_item_id: 101,
          name: "Test Item",
          price: 150,
          stock: 99,
          sku: "TEST-101",
          category: "Test",
          image: "",
        },
      ],
      next_offset: 0,
      total: 1,
    });

    await handleCatalogEvent(token, event, context, handlers);

    expect(fetchProductsByIds).toHaveBeenCalledWith(token, [101], {
      warehouseId: 2,
      priceTypeId: 3,
    });
    expect(upsertProducts).toHaveBeenCalledWith("1:2:3", [
      {
        id: "101",
        regos_item_id: 101,
        name: "Test Item",
        price: 150,
        stock: 5, // preserved!
        sku: "TEST-101",
        category: "Test",
        image: "",
      },
    ]);
    expect(handlers.onProductsUpdated).toHaveBeenCalled();
  });

  it("DocPurchasePerformed updates both quantity and price (default behavior)", async () => {
    const event = {
      type: "products_updated" as const,
      regos_item_ids: [101],
      source_action: "DocPurchasePerformed",
      occurred_at: "2026-07-11T14:49:06Z",
    };

    vi.mocked(fetchProductsByIds).mockResolvedValue({
      products: [
        {
          id: "101",
          regos_item_id: 101,
          name: "Test Item",
          price: 150,
          stock: 99,
          sku: "TEST-101",
          category: "Test",
          image: "",
        },
      ],
      next_offset: 0,
      total: 1,
    });

    await handleCatalogEvent(token, event, context, handlers);

    expect(upsertProducts).toHaveBeenCalledWith("1:2:3", [
      {
        id: "101",
        regos_item_id: 101,
        name: "Test Item",
        price: 150, // updated!
        stock: 99,  // updated!
        sku: "TEST-101",
        category: "Test",
        image: "",
      },
    ]);
  });

  it("DocChequeClosed updates only product stock and leaves price unchanged", async () => {
    const event = {
      type: "products_updated" as const,
      regos_item_ids: [101],
      source_action: "DocChequeClosed",
      occurred_at: "2026-07-11T14:49:06Z",
    };

    vi.mocked(loadCachedProduct).mockResolvedValue({
      id: "101",
      regos_item_id: 101,
      name: "Test Item",
      price: 100,
      stock: 5,
      sku: "TEST-101",
      category: "Test",
      image: "",
    });

    vi.mocked(fetchProductsByIds).mockResolvedValue({
      products: [
        {
          id: "101",
          regos_item_id: 101,
          name: "Test Item",
          price: 999, // should be ignored
          stock: 20,
          sku: "TEST-101",
          category: "Test",
          image: "",
        },
      ],
      next_offset: 0,
      total: 1,
    });

    await handleCatalogEvent(token, event, context, handlers);

    expect(upsertProducts).toHaveBeenCalledWith("1:2:3", [
      {
        id: "101",
        regos_item_id: 101,
        name: "Test Item",
        price: 100, // preserved!
        stock: 20,  // updated!
        sku: "TEST-101",
        category: "Test",
        image: "",
      },
    ]);
  });

  it("ItemEdited calls proxy Item/Get to update product info, leaving price and stock unchanged", async () => {
    const event = {
      type: "products_updated" as const,
      regos_item_ids: [101],
      source_action: "ItemEdited",
      occurred_at: "2026-07-11T14:49:06Z",
    };

    vi.mocked(loadCachedProduct).mockResolvedValue({
      id: "101",
      regos_item_id: 101,
      name: "Old Name",
      price: 100,
      stock: 5,
      sku: "TEST-101",
      category: "Old Cat",
      image: "",
    });

    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      result: [
        {
          id: 101,
          name: "New Name",
          articul: "NEW-101",
          base_barcode: "99999",
          unit: { name: "pcs", type: "pcs" },
          group: { name: "New Cat", id: 12 },
        },
      ],
    });

    await handleCatalogEvent(token, event, context, handlers);

    expect(apiRequest).toHaveBeenCalledWith("/api/v1/regos/proxy/Item/Get", {
      token,
      method: "POST",
      body: {
        ids: [101],
        deleted_mark: false,
      },
    });

    expect(upsertProducts).toHaveBeenCalledWith("1:2:3", [
      {
        id: "101",
        regos_item_id: 101,
        name: "New Name", // updated!
        price: 100, // preserved!
        stock: 5, // preserved!
        sku: "NEW-101", // updated!
        articul: "NEW-101", // updated!
        barcode: "99999", // updated!
        code: "",
        category: "New Cat", // updated!
        group_id: 12, // updated!
        unit_name: "pcs", // updated!
        unit_type: 1, // updated!
        image: "",
      },
    ]);
  });

  it("ItemDeleted updates product info rather than removing it", async () => {
    const event = {
      type: "products_removed" as const,
      regos_item_ids: [101],
      source_action: "ItemDeleted",
      occurred_at: "2026-07-11T14:49:06Z",
    };

    vi.mocked(loadCachedProduct).mockResolvedValue({
      id: "101",
      regos_item_id: 101,
      name: "Deleted Item Name",
      price: 100,
      stock: 5,
      sku: "TEST-101",
      category: "Test",
      image: "",
    });

    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      result: [
        {
          id: 101,
          name: "Deleted Item Name (Updated Info)",
          articul: "TEST-101",
          base_barcode: "99999",
        },
      ],
    });

    await handleCatalogEvent(token, event, context, handlers);

    expect(removeProducts).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith("/api/v1/regos/proxy/Item/Get", {
      token,
      method: "POST",
      body: {
        ids: [101],
        deleted_mark: false,
      },
    });
  });

  it("ItemGroupEdited updates info for all cached products in scope", async () => {
    const event = {
      type: "groups_invalidated" as const,
      source_action: "ItemGroupEdited",
      occurred_at: "2026-07-11T14:49:06Z",
    };

    vi.mocked(loadCachedProductIdsByScope).mockResolvedValue(["101", "102"]);
    
    vi.mocked(loadCachedProduct).mockImplementation(async (scope, id) => {
      return {
        id,
        regos_item_id: Number(id),
        name: `Item ${id}`,
        price: 100,
        stock: 5,
        sku: `SKU-${id}`,
        category: "Old Category",
        image: "",
      } as any;
    });

    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      result: [
        {
          id: 101,
          name: "Item 101",
          group: { name: "New Group", id: 20 },
        },
        {
          id: 102,
          name: "Item 102",
          group: { name: "New Group", id: 20 },
        },
      ],
    });

    await handleCatalogEvent(token, event, context, handlers);

    expect(invalidateGroups).toHaveBeenCalledWith(1);
    expect(handlers.onGroupsInvalidated).toHaveBeenCalled();
    expect(loadCachedProductIdsByScope).toHaveBeenCalledWith("1:2:3");
    expect(apiRequest).toHaveBeenCalledWith("/api/v1/regos/proxy/Item/Get", {
      token,
      method: "POST",
      body: {
        ids: [101, 102],
        deleted_mark: false,
      },
    });
  });
});
