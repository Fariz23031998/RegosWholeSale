import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/catalog-api", () => ({
  fetchProductSync: vi.fn(),
}));

vi.mock("@/lib/catalog-products-db", () => ({
  upsertProducts: vi.fn(() => Promise.resolve()),
  removeProducts: vi.fn(() => Promise.resolve()),
  invalidateGroups: vi.fn(() => Promise.resolve()),
  clearCachedPagesForScope: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/catalog-products-db/loadCachedProductIdsByScope/loadCachedProductIdsByScope", () => ({
  loadCachedProductIdsByScope: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/lib/sync-meta-db", () => ({
  getLastSyncTime: vi.fn(() => Promise.resolve(null)),
  setLastSyncTime: vi.fn(() => Promise.resolve()),
}));

import { fetchProductSync } from "@/lib/catalog-api";
import { upsertProducts } from "@/lib/catalog-products-db";
import { loadCachedProductIdsByScope } from "@/lib/catalog-products-db/loadCachedProductIdsByScope/loadCachedProductIdsByScope";
import { getLastSyncTime, setLastSyncTime } from "@/lib/sync-meta-db";
import { performIncrementalSync, resolveSyncSince, applyIncrementalSyncToCatalog } from "./catalog-incremental-sync";

describe("catalog-incremental-sync", () => {
  const token = "test-token";
  const scopeKey = "1:2:3";
  const scope = { companyId: 1, warehouseId: 2, priceTypeId: 3 };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(getLastSyncTime).mockResolvedValue(null);
    vi.mocked(loadCachedProductIdsByScope).mockResolvedValue([]);
  });

  it("skips API call when there is no watermark and no local cache", async () => {
    const result = await performIncrementalSync(token, scopeKey, scope);
    expect(result.synced).toBe(false);
    expect(fetchProductSync).not.toHaveBeenCalled();
  });

  it("uses retention lookback when cache exists but watermark is missing", async () => {
    vi.mocked(loadCachedProductIdsByScope).mockResolvedValue(["101"]);
    vi.mocked(fetchProductSync).mockResolvedValue({
      updated_products: [{ id: "101", name: "Updated" } as any],
      removed_product_ids: [],
      groups_invalidated: false,
      synced_at: "2026-07-12T12:00:00Z",
      full_sync_required: false,
    });

    const result = await performIncrementalSync(token, scopeKey, scope);

    expect(result.synced).toBe(true);
    expect(fetchProductSync).toHaveBeenCalledTimes(1);
    const since = vi.mocked(fetchProductSync).mock.calls[0][1];
    const sinceMs = Date.parse(since);
    expect(sinceMs).toBeLessThan(Date.now());
    expect(Date.now() - sinceMs).toBeGreaterThan(28 * 24 * 60 * 60 * 1000);
    expect(upsertProducts).toHaveBeenCalled();
    expect(setLastSyncTime).toHaveBeenCalledWith(scopeKey, "2026-07-12T12:00:00Z");
  });

  it("uses completed download status as cache signal when product ids are empty", async () => {
    localStorage.setItem("catalog_download_status:1:2:3", "completed");
    const since = await resolveSyncSince(scopeKey, scope);
    expect(since).not.toBeNull();
    expect(Date.now() - Date.parse(since!)).toBeGreaterThan(28 * 24 * 60 * 60 * 1000);
  });

  it("prefers stored watermark over lookback", async () => {
    vi.mocked(getLastSyncTime).mockResolvedValue("2026-07-11T10:00:00Z");
    vi.mocked(loadCachedProductIdsByScope).mockResolvedValue(["101"]);
    const since = await resolveSyncSince(scopeKey, scope);
    expect(since).toBe("2026-07-11T10:00:00Z");
  });

  it("skips network fetch when watermark is only seconds old", async () => {
    vi.mocked(getLastSyncTime).mockResolvedValue(new Date().toISOString());
    const result = await performIncrementalSync(token, "fresh-scope-a", scope);
    expect(result.synced).toBe(true);
    expect(fetchProductSync).not.toHaveBeenCalled();
    expect(setLastSyncTime).not.toHaveBeenCalled();
  });

  it("skips network fetch when server watermark is slightly ahead of client clock", async () => {
    const ahead = new Date(Date.now() + 5_000).toISOString();
    vi.mocked(getLastSyncTime).mockResolvedValue(ahead);
    const result = await performIncrementalSync(token, "fresh-scope-b", scope);
    expect(result.synced).toBe(true);
    expect(fetchProductSync).not.toHaveBeenCalled();
  });

  it("marks last sync time only after a successful fetch", async () => {
    const oldSince = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    vi.mocked(getLastSyncTime).mockResolvedValue(oldSince);
    vi.mocked(fetchProductSync).mockResolvedValue({
      updated_products: [],
      removed_product_ids: [],
      groups_invalidated: false,
      synced_at: "2026-07-12T14:00:00Z",
      full_sync_required: false,
    });

    await performIncrementalSync(token, "old-scope", scope);

    expect(fetchProductSync).toHaveBeenCalledWith(token, oldSince, {
      warehouseId: 2,
      priceTypeId: 3,
    });
    expect(setLastSyncTime).toHaveBeenCalledWith("old-scope", "2026-07-12T14:00:00Z");
  });

  it("applyIncrementalSyncToCatalog patches and removes without a full refresh", () => {
    const patchProducts = vi.fn();
    const removeProducts = vi.fn();
    const requestGroupsRefresh = vi.fn();
    const requestRefresh = vi.fn();

    const fullSyncRequired = applyIncrementalSyncToCatalog(
      {
        synced: true,
        fullSyncRequired: false,
        updatedCount: 1,
        removedCount: 1,
        groupsInvalidated: false,
        updatedProducts: [{ id: "101", name: "Updated" } as any],
        removedProductIds: ["202"],
      },
      { patchProducts, removeProducts, requestGroupsRefresh },
    );

    expect(fullSyncRequired).toBe(false);
    expect(patchProducts).toHaveBeenCalledWith([{ id: "101", name: "Updated" }]);
    expect(removeProducts).toHaveBeenCalledWith(["202"]);
    expect(requestGroupsRefresh).not.toHaveBeenCalled();
    expect(requestRefresh).not.toHaveBeenCalled();
  });

  it("applyIncrementalSyncToCatalog refreshes groups when invalidated", () => {
    const requestGroupsRefresh = vi.fn();
    applyIncrementalSyncToCatalog(
      {
        synced: true,
        fullSyncRequired: false,
        updatedCount: 0,
        removedCount: 0,
        groupsInvalidated: true,
      },
      {
        patchProducts: vi.fn(),
        removeProducts: vi.fn(),
        requestGroupsRefresh,
      },
    );
    expect(requestGroupsRefresh).toHaveBeenCalledTimes(1);
  });
});
