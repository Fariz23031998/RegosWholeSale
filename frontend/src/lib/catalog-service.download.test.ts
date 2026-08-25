import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/catalog-api", () => ({
  fetchCatalogProducts: vi.fn(),
  fetchProductGroups: vi.fn(),
  fetchProductSync: vi.fn(),
  fetchProductsByIds: vi.fn(),
}));

vi.mock("@/lib/catalog-products-db", () => ({
  CATALOG_CACHE_TTL_MS: 60_000,
  isCacheFresh: vi.fn(),
  loadCachedGroups: vi.fn(),
  loadCachedPage: vi.fn(),
  saveCachedGroups: vi.fn(() => Promise.resolve()),
  saveCachedPage: vi.fn(() => Promise.resolve()),
  upsertProducts: vi.fn(() => Promise.resolve()),
  getCachedProductsByScope: vi.fn(),
  getCachedProductEntriesByScope: vi.fn(),
  filterAndSortCachedProducts: vi.fn(),
}));

vi.mock("@/lib/sync-meta-db", () => ({
  setLastSyncTime: vi.fn(() => Promise.resolve()),
}));

import { fetchCatalogProducts, fetchProductGroups, fetchProductSync } from "@/lib/catalog-api";
import { downloadCompleteCatalog } from "@/lib/catalog-service";

describe("downloadCompleteCatalog", () => {
  beforeEach(() => {
    vi.mocked(fetchCatalogProducts).mockReset();
    vi.mocked(fetchProductGroups).mockReset();
    vi.mocked(fetchProductSync).mockReset();

    vi.mocked(fetchProductGroups).mockResolvedValue({ groups: [] });
    vi.mocked(fetchProductSync).mockResolvedValue({
      updated_products: [],
      removed_product_ids: [],
      groups_invalidated: false,
      synced_at: "2026-07-12T00:00:00Z",
      full_sync_required: true,
    });
    vi.mocked(fetchCatalogProducts).mockResolvedValue({
      products: [],
      next_offset: 0,
      total: 0,
    });
  });

  it("always requests products with zero_quantity and zero_price enabled", async () => {
    await downloadCompleteCatalog("token", {
      companyId: 1,
      warehouseId: 11,
      priceTypeId: 22,
    });

    expect(fetchCatalogProducts).toHaveBeenCalled();
    for (const call of vi.mocked(fetchCatalogProducts).mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          includeZeroQuantity: true,
          includeZeroPrice: true,
          limit: 500,
        }),
      );
    }
  });
});
