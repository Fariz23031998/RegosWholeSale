import { describe, expect, it, vi, beforeEach } from "vitest";

const mockLocalStorage: Record<string, string> = {};
const localStorageStub = {
  getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorage[key];
  }),
  clear: vi.fn(() => {
    for (const key of Object.keys(mockLocalStorage)) {
      delete mockLocalStorage[key];
    }
  }),
};
vi.stubGlobal("localStorage", localStorageStub);

class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readyState = MockEventSource.CONNECTING;
  onopen: ((ev?: Event) => void) | null = null;
  onerror: ((ev?: Event) => void) | null = null;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });

  /** Test helper: simulate successful open. */
  simulateOpen() {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.(new Event("open"));
  }

  /** Test helper: simulate connection error. */
  simulateError() {
    this.readyState = MockEventSource.CONNECTING;
    this.onerror?.(new Event("error"));
  }

  /** Test helper: deliver a message to registered listeners. */
  simulateMessage(data: string) {
    for (const [type, handler] of this.addEventListener.mock.calls) {
      if (type === "message") {
        (handler as (ev: MessageEvent<string>) => void)({ data } as MessageEvent<string>);
      }
    }
  }
}
vi.stubGlobal("EventSource", MockEventSource);



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
vi.mock("@/lib/sync-meta-db", () => ({
  getLastSyncTime: vi.fn(() => Promise.resolve(null)),
  setLastSyncTime: vi.fn(() => Promise.resolve()),
  clearSyncMeta: vi.fn(() => Promise.resolve()),
}));

import { apiRequest } from "@/lib/api";
import { fetchProductsByIds } from "@/lib/catalog-api";
import { upsertProducts, removeProducts, invalidateGroups } from "@/lib/catalog-products-db";
import { loadCachedProduct } from "@/lib/catalog-products-db/loadCachedProduct/loadCachedProduct";
import { loadCachedProductIdsByScope } from "@/lib/catalog-products-db/loadCachedProductIdsByScope/loadCachedProductIdsByScope";
import { fetchAllPartners, fetchPartnerGroups } from "@/lib/partners-api";
import { saveCachedPartners, saveCachedPartnerGroups } from "@/lib/partners-db";
import { handleCatalogEvent, connectCatalogEvents, subscribeCatalogEventsReconnect, shouldForceCatalogGapFill, getCatalogEventsLastEventAt } from "./catalog-events";


vi.mock("@/lib/partners-api", () => ({
  fetchAllPartners: vi.fn(() => Promise.resolve([])),
  fetchPartnerGroups: vi.fn(() => Promise.resolve({ groups: [] })),
}));
vi.mock("@/lib/partners-db", () => ({
  saveCachedPartners: vi.fn(() => Promise.resolve()),
  saveCachedPartnerGroups: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/settings-api", () => ({
  fetchRegosReferenceOptions: vi.fn(() => Promise.resolve({ warehouses: [], price_types: [], partners: [] })),
  patchReferenceOptionsInMemory: vi.fn(),
}));
vi.mock("@/lib/reference-options-db", () => ({
  patchCachedReferenceOptions: vi.fn(() => Promise.resolve()),
}));

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

    // Mock proxy response from itemprice/get
    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      result: [
        {
          item_id: 101,
          value: 150,
          price_type: { id: 3 },
        },
      ],
    });

    await handleCatalogEvent(token, event, context, handlers);

    expect(apiRequest).toHaveBeenCalledWith("/api/v1/regos/proxy/itemprice/get", {
      token,
      method: "POST",
      body: {
        item_ids: [101],
        price_type_ids: [3],
      },
    });
    expect(upsertProducts).toHaveBeenCalledWith("1:2:3", [
      {
        id: "101",
        regos_item_id: 101,
        name: "Test Item",
        price: 150, // updated!
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

    expect(fetchProductsByIds).toHaveBeenCalledTimes(1);
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

  it("DocPurchasePerformed with matching stock_id refreshes active view once", async () => {
    const { refreshProductsByIds } = await import("@/lib/catalog-service");
    const event = {
      type: "products_updated" as const,
      regos_item_ids: [101],
      stock_id: 2,
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

    expect(refreshProductsByIds).not.toHaveBeenCalled();
    expect(fetchProductsByIds).toHaveBeenCalledTimes(1);
    expect(fetchProductsByIds).toHaveBeenCalledWith(token, [101], {
      warehouseId: 2,
      priceTypeId: 3,
    });
    expect(handlers.onProductsUpdated).toHaveBeenCalled();
  });

  it("DocPurchasePerformed with other stock_id warms that cache and refreshes active prices", async () => {
    const { refreshProductsByIds } = await import("@/lib/catalog-service");
    const event = {
      type: "products_updated" as const,
      regos_item_ids: [101],
      stock_id: 9,
      source_action: "DocPurchasePerformCanceled",
      occurred_at: "2026-07-11T14:49:06Z",
    };

    vi.mocked(fetchProductsByIds).mockResolvedValue({
      products: [
        {
          id: "101",
          regos_item_id: 101,
          name: "Test Item",
          price: 150,
          stock: 5,
          sku: "TEST-101",
          category: "Test",
          image: "",
        },
      ],
      next_offset: 0,
      total: 1,
    });

    await handleCatalogEvent(token, event, context, handlers);

    expect(refreshProductsByIds).toHaveBeenCalledTimes(1);
    expect(refreshProductsByIds).toHaveBeenCalledWith(
      token,
      [101],
      { companyId: 1, warehouseId: 9, priceTypeId: 3 },
      { warehouseId: 9, priceTypeId: 3 },
    );
    expect(fetchProductsByIds).toHaveBeenCalledTimes(1);
    expect(fetchProductsByIds).toHaveBeenCalledWith(token, [101], {
      warehouseId: 2,
      priceTypeId: 3,
    });
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

  it("DocWholeSalePerformed with matching stock_id refreshes active view once", async () => {
    const event = {
      type: "products_updated" as const,
      regos_item_ids: [10, 8, 9],
      stock_id: 2,
      source_action: "DocWholeSalePerformed",
      occurred_at: "2026-07-12T16:00:00Z",
    };

    vi.mocked(fetchProductsByIds).mockResolvedValue({
      products: [
        {
          id: "10",
          regos_item_id: 10,
          name: "A",
          price: 1,
          stock: 5,
          sku: "A",
          category: "Test",
          image: "",
        },
      ],
      next_offset: 0,
      total: 1,
    });

    await handleCatalogEvent(token, event, context, handlers);

    expect(fetchProductsByIds).toHaveBeenCalledTimes(1);
    expect(fetchProductsByIds).toHaveBeenCalledWith(token, [10, 8, 9], {
      warehouseId: 2,
      priceTypeId: 3,
    });
    expect(handlers.onProductsUpdated).toHaveBeenCalledTimes(1);
  });

  it("DocWholeSalePerformCanceled with other stock_id warms that cache only", async () => {
    const event = {
      type: "products_updated" as const,
      regos_item_ids: [10, 8, 9],
      stock_id: 9,
      source_action: "DocWholeSalePerformCanceled",
      occurred_at: "2026-07-12T16:00:00Z",
    };

    vi.mocked(fetchProductsByIds).mockResolvedValue({
      products: [],
      next_offset: 0,
      total: 0,
    });

    await handleCatalogEvent(token, event, context, handlers);

    expect(fetchProductsByIds).toHaveBeenCalledTimes(1);
    expect(fetchProductsByIds).toHaveBeenCalledWith(token, [10, 8, 9], {
      warehouseId: 9,
      priceTypeId: 3,
    });
    expect(handlers.onProductsUpdated).not.toHaveBeenCalled();
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
        barcode_list: "99999",
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

  it("ignores products_updated when onProductsUpdated handler is not provided", async () => {
    const event = {
      type: "products_updated" as const,
      regos_item_ids: [101],
      source_action: "DocSetPricePerformed",
      occurred_at: "2026-07-11T14:49:06Z",
    };

    const minimalHandlers = {
      onReferenceOptionsInvalidated: vi.fn(),
    };

    await handleCatalogEvent(token, event, context, minimalHandlers as any);

    expect(fetchProductsByIds).not.toHaveBeenCalled();
    expect(upsertProducts).not.toHaveBeenCalled();
  });

  it("handles reference_options_invalidated for partner kind and updates IndexedDB cache", async () => {
    const event = {
      type: "reference_options_invalidated" as const,
      kinds: ["partner" as const],
      source_action: "PartnerEdited",
      occurred_at: "2026-07-11T14:49:06Z",
    };

    const mockPartners = [
      { id: 1, name: "Partner A" },
    ];
    const mockGroups = [{ id: 10, name: "Retail" }];
    vi.mocked(fetchAllPartners).mockResolvedValue(mockPartners as any);
    vi.mocked(fetchPartnerGroups).mockResolvedValue({ groups: mockGroups } as any);

    const testHandlers = {
      onReferenceOptionsInvalidated: vi.fn(),
    };

    await handleCatalogEvent(token, event, context, testHandlers as any);

    expect(fetchAllPartners).toHaveBeenCalledWith(token);
    expect(fetchPartnerGroups).toHaveBeenCalledWith(token);
    expect(saveCachedPartners).toHaveBeenCalledWith(context.companyId, mockPartners);
    expect(saveCachedPartnerGroups).toHaveBeenCalledWith(context.companyId, mockGroups);
    expect(testHandlers.onReferenceOptionsInvalidated).toHaveBeenCalledWith(["partner"]);
  });
});

describe("Catalog SSE lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as any).__pulse_pos_sse_global__;
    if (typeof window !== "undefined") {
      delete (window as any).__pulse_pos_sse_global__;
    }
  });

  it("ignores heartbeat messages but updates lastEventAt", () => {
    const conn = connectCatalogEvents(
      "token",
      { companyId: 1 },
      { onProductsUpdated: vi.fn() },
    );
    const source = (globalThis as any).__pulse_pos_sse_global__.sharedSource as MockEventSource;
    expect(source).toBeTruthy();

    source.simulateMessage(
      JSON.stringify({ type: "heartbeat", occurred_at: "2026-07-18T12:00:00Z" }),
    );

    expect(getCatalogEventsLastEventAt()).not.toBeNull();
    conn.close();
  });

  it("fires reconnect listeners after error then open", () => {
    const onReconnect = vi.fn();
    const unsubscribe = subscribeCatalogEventsReconnect(onReconnect);

    const conn = connectCatalogEvents(
      "token",
      { companyId: 1 },
      { onProductsUpdated: vi.fn() },
    );
    const source = (globalThis as any).__pulse_pos_sse_global__.sharedSource as MockEventSource;

    source.simulateOpen();
    expect(onReconnect).not.toHaveBeenCalled();

    source.simulateError();
    expect(shouldForceCatalogGapFill()).toBe(true);

    source.simulateOpen();
    expect(onReconnect).toHaveBeenCalledTimes(1);

    unsubscribe();
    conn.close();
  });

  it("shouldForceCatalogGapFill is false when connected with a fresh lastEventAt", () => {
    const conn = connectCatalogEvents(
      "token",
      { companyId: 1 },
      { onProductsUpdated: vi.fn() },
    );
    const source = (globalThis as any).__pulse_pos_sse_global__.sharedSource as MockEventSource;
    source.simulateOpen();
    source.simulateMessage(
      JSON.stringify({ type: "heartbeat", occurred_at: "2026-07-18T12:00:00Z" }),
    );

    expect(shouldForceCatalogGapFill()).toBe(false);
    conn.close();
  });
});

