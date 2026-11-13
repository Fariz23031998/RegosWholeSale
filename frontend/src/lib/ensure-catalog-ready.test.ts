import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal("localStorage", {
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
});

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "toast-id"),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/cache-policy", () => ({
  isCacheEnabled: vi.fn(() => true),
}));

vi.mock("@/lib/catalog-incremental-sync", () => ({
  performIncrementalSync: vi.fn(),
  applyIncrementalSyncToCatalog: vi.fn((_result, _handlers) => false),
  getCatalogDownloadStatus: vi.fn(() => null),
  setCatalogDownloadStatus: vi.fn(),
  removeCatalogDownloadStatus: vi.fn(),
}));

vi.mock("@/lib/catalog-service", () => ({
  downloadCompleteCatalog: vi.fn(() => Promise.resolve()),
}));

import { isCacheEnabled } from "@/lib/cache-policy";
import {
  getCatalogDownloadStatus,
  performIncrementalSync,
  setCatalogDownloadStatus,
} from "@/lib/catalog-incremental-sync";
import { downloadCompleteCatalog } from "@/lib/catalog-service";
import { ensureCatalogReady } from "./ensure-catalog-ready";

describe("ensureCatalogReady", () => {
  const token = "token";
  const scope = { companyId: 1, warehouseId: 2, priceTypeId: 3 };
  const t = (key: string, fallback: string) => fallback;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockLocalStorage)) {
      delete mockLocalStorage[key];
    }
    vi.mocked(isCacheEnabled).mockReturnValue(true);
    vi.mocked(performIncrementalSync).mockResolvedValue({
      synced: true,
      fullSyncRequired: false,
      updatedCount: 0,
      removedCount: 0,
      groupsInvalidated: false,
    });
    vi.mocked(getCatalogDownloadStatus).mockReturnValue(null);
    vi.mocked(downloadCompleteCatalog).mockResolvedValue(undefined);
  });

  it("no-ops when caching is disabled", async () => {
    vi.mocked(isCacheEnabled).mockReturnValue(false);
    const result = await ensureCatalogReady(token, scope, { t });
    expect(result).toEqual({
      synced: false,
      downloaded: false,
      fullSyncRequired: false,
    });
    expect(performIncrementalSync).not.toHaveBeenCalled();
    expect(downloadCompleteCatalog).not.toHaveBeenCalled();
  });

  it("skips full download when status is completed and sync is not full_sync_required", async () => {
    vi.mocked(getCatalogDownloadStatus).mockReturnValue("completed");
    const doneForScopeRef = { current: null as string | null };

    const result = await ensureCatalogReady(token, scope, {
      t,
      skipIfDone: true,
      doneForScopeRef,
    });

    expect(result.synced).toBe(true);
    expect(result.downloaded).toBe(false);
    expect(downloadCompleteCatalog).not.toHaveBeenCalled();
    expect(doneForScopeRef.current).toBe("1:2:3");
  });

  it("downloads when status is not completed", async () => {
    vi.mocked(getCatalogDownloadStatus).mockReturnValue(null);

    const result = await ensureCatalogReady(token, scope, { t });

    expect(downloadCompleteCatalog).toHaveBeenCalledWith(token, {
      companyId: 1,
      warehouseId: 2,
      priceTypeId: 3,
    });
    expect(setCatalogDownloadStatus).toHaveBeenCalledWith(1, 2, 3, "completed");
    expect(result.downloaded).toBe(true);
    expect(result.synced).toBe(true);
  });

  it("skips work when skipIfDone and scope already marked done", async () => {
    const doneForScopeRef = { current: "1:2:3" };
    const result = await ensureCatalogReady(token, scope, {
      t,
      skipIfDone: true,
      doneForScopeRef,
    });
    expect(result.synced).toBe(true);
    expect(performIncrementalSync).not.toHaveBeenCalled();
    expect(downloadCompleteCatalog).not.toHaveBeenCalled();
  });

  it("awaits a shared download promise when callers overlap", async () => {
    let resolveDownload: (() => void) | undefined;
    let shared: Promise<void> | null = null;
    vi.mocked(downloadCompleteCatalog).mockImplementation(() => {
      if (!shared) {
        shared = new Promise<void>((resolve) => {
          resolveDownload = resolve;
        });
      }
      return shared;
    });
    vi.mocked(getCatalogDownloadStatus).mockReturnValue(null);

    const first = ensureCatalogReady(token, scope, { t });
    const second = ensureCatalogReady(token, scope, { t });

    await vi.waitFor(() => {
      expect(resolveDownload).toBeTypeOf("function");
    });

    resolveDownload?.();
    const [a, b] = await Promise.all([first, second]);
    expect(a.downloaded).toBe(true);
    expect(b.downloaded).toBe(true);
  });
});
