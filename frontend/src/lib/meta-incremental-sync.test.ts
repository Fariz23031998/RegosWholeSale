import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/catalog-api", () => ({
  fetchMetaSync: vi.fn(),
}));

vi.mock("@/lib/sync-meta-db", () => ({
  getLastSyncTime: vi.fn(() => Promise.resolve(null)),
  setLastSyncTime: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/cache-service", () => ({
  clearPartnersCache: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/payment-service", () => ({
  loadPaymentTypes: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/lib/settings-api", () => ({
  refreshSettingsNamespace: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/store/sell-context", () => ({
  useSellContext: {
    getState: vi.fn(() => ({
      hydrate: vi.fn(() => Promise.resolve()),
      refreshReferenceOptions: vi.fn(() => Promise.resolve()),
    })),
  },
}));

vi.mock("@/store/pos-config", () => ({
  usePosConfig: {
    getState: vi.fn(() => ({
      hydrate: vi.fn(() => Promise.resolve()),
    })),
  },
}));

import { fetchMetaSync } from "@/lib/catalog-api";
import { loadPaymentTypes } from "@/lib/payment-service";
import { refreshSettingsNamespace } from "@/lib/settings-api";
import { getLastSyncTime, setLastSyncTime } from "@/lib/sync-meta-db";
import { useSellContext } from "@/store/sell-context";
import {
  META_RECENT_SYNC_SKIP_MS,
  performMetaIncrementalSync,
} from "./meta-incremental-sync";

describe("performMetaIncrementalSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLastSyncTime).mockResolvedValue(
      new Date(Date.now() - META_RECENT_SYNC_SKIP_MS * 2).toISOString(),
    );
  });

  it("refreshes reference options and settings from events_log catch-up", async () => {
    const refreshReferenceOptions = vi.fn(() => Promise.resolve());
    vi.mocked(useSellContext.getState).mockReturnValue({
      hydrate: vi.fn(() => Promise.resolve()),
      refreshReferenceOptions,
    } as never);

    vi.mocked(fetchMetaSync).mockResolvedValue({
      synced_at: "2026-07-12T17:00:00Z",
      full_sync_required: false,
      reference_kinds: ["warehouse", "price_type"],
      payment_types_invalidated: true,
      settings: [
        { scope: "company", namespace: "receipt_templates", user_id: null },
        { scope: "employee", namespace: "regos_defaults", user_id: 9 },
      ],
    });

    const result = await performMetaIncrementalSync("token", 1, 9, {
      canChangePosContext: true,
    });

    expect(result.synced).toBe(true);
    expect(result.referenceKinds).toEqual(["warehouse", "price_type"]);
    expect(result.paymentTypesInvalidated).toBe(true);
    expect(refreshReferenceOptions).toHaveBeenCalledWith("token", [
      "warehouse",
      "price_type",
    ]);
    expect(loadPaymentTypes).toHaveBeenCalledWith("token", 1, { force: true });
    expect(refreshSettingsNamespace).toHaveBeenCalledWith(
      "token",
      "receipt_templates",
      expect.objectContaining({ companyId: 1, userId: 9 }),
    );
    expect(setLastSyncTime).toHaveBeenCalledWith("meta:1", "2026-07-12T17:00:00Z");
  });

  it("skips employee settings for other users", async () => {
    vi.mocked(fetchMetaSync).mockResolvedValue({
      synced_at: "2026-07-12T17:00:00Z",
      full_sync_required: false,
      reference_kinds: [],
      payment_types_invalidated: false,
      settings: [{ scope: "employee", namespace: "pos", user_id: 99 }],
    });

    await performMetaIncrementalSync("token", 1, 9);

    expect(refreshSettingsNamespace).not.toHaveBeenCalled();
  });

  it("force resume bypasses fresh watermark skip", async () => {
    vi.mocked(getLastSyncTime).mockResolvedValue(new Date().toISOString());
    vi.mocked(fetchMetaSync).mockResolvedValue({
      synced_at: "2026-07-12T17:05:00Z",
      full_sync_required: false,
      reference_kinds: ["partner"],
      payment_types_invalidated: false,
      settings: [],
    });

    const skipped = await performMetaIncrementalSync("token", 1, 9);
    expect(skipped.referenceKinds).toEqual([]);
    expect(fetchMetaSync).not.toHaveBeenCalled();

    const forced = await performMetaIncrementalSync("token", 1, 9, { force: true });
    expect(fetchMetaSync).toHaveBeenCalledTimes(1);
    expect(forced.referenceKinds).toEqual(["partner"]);
  });
});
