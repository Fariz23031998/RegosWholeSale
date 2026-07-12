import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/lib/settings-db", () => ({
  buildCompanySettingsKey: (companyId: number, namespace: string) =>
    `company:${companyId}:${namespace}`,
  loadCachedSettingsData: vi.fn(() => Promise.resolve(null)),
  saveCachedSettings: vi.fn(() => Promise.resolve()),
}));

import { apiRequest } from "@/lib/api";
import { loadCachedSettingsData } from "@/lib/settings-db";
import {
  fetchReceiptTemplates,
  getCachedReceiptTemplates,
  invalidateReceiptTemplatesCache,
} from "./receipt-templates-api";

const sampleResponse = {
  settings: {
    templates: [
      {
        id: "t1",
        name: "Default",
        format: "80mm" as const,
        engine: "builtin" as const,
      },
    ],
    default_template_id: "t1",
  },
};

describe("fetchReceiptTemplates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateReceiptTemplatesCache();
    vi.mocked(loadCachedSettingsData).mockResolvedValue(null);
  });

  it("coalesces concurrent requests into one network call", async () => {
    let resolveRequest!: (value: typeof sampleResponse) => void;
    vi.mocked(apiRequest).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const first = fetchReceiptTemplates("token-a", { cacheScope: { companyId: 1 } });
    const second = fetchReceiptTemplates("token-a", { cacheScope: { companyId: 1 } });
    const forced = fetchReceiptTemplates("token-a", {
      force: true,
      cacheScope: { companyId: 1 },
    });

    // Allow the shared inflight task to finish the IDB miss and start the HTTP call.
    await Promise.resolve();
    await Promise.resolve();

    expect(apiRequest).toHaveBeenCalledTimes(1);

    resolveRequest(sampleResponse);
    await expect(Promise.all([first, second, forced])).resolves.toEqual([
      sampleResponse,
      sampleResponse,
      sampleResponse,
    ]);
  });

  it("returns memory cache on subsequent calls without network", async () => {
    vi.mocked(apiRequest).mockResolvedValue(sampleResponse);

    await fetchReceiptTemplates("token-b", { cacheScope: { companyId: 1 } });
    await fetchReceiptTemplates("token-b", { cacheScope: { companyId: 1 } });

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(getCachedReceiptTemplates("token-b")).toEqual(sampleResponse);
  });

  it("warms memory cache from IndexedDB without network", async () => {
    vi.mocked(loadCachedSettingsData).mockResolvedValue(sampleResponse);

    const result = await fetchReceiptTemplates("token-c", {
      cacheScope: { companyId: 1 },
    });

    expect(result).toEqual(sampleResponse);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(getCachedReceiptTemplates("token-c")).toEqual(sampleResponse);
  });
});
