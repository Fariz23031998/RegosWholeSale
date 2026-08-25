import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/pulse-pos-db", () => ({
  openPulsePosDb: vi.fn(),
  SETTINGS_CACHE_STORE: "settings-cache",
}));

import { resetCachePolicyForTests, setCacheEnabled } from "@/lib/cache-policy";

describe("settings-db cache policy", () => {
  beforeEach(async () => {
    localStorage.clear();
    resetCachePolicyForTests();
    vi.clearAllMocks();
    const { openPulsePosDb } = await import("@/lib/pulse-pos-db");
    vi.mocked(openPulsePosDb).mockReset();
  });

  afterEach(() => {
    resetCachePolicyForTests();
  });

  it("skips cached settings reads and writes when browser cache is disabled", async () => {
    const { openPulsePosDb } = await import("@/lib/pulse-pos-db");
    const { loadCachedSettings, saveCachedSettings } = await import("@/lib/settings-db");

    setCacheEnabled(false);

    await expect(loadCachedSettings("company:1:pos")).resolves.toBeNull();
    await expect(saveCachedSettings("company:1:pos", { foo: "bar" })).resolves.toBeUndefined();
    expect(openPulsePosDb).not.toHaveBeenCalled();
  });
});
