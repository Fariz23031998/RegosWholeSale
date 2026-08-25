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

import {
  isCacheEnabled,
  resetCachePolicyForTests,
  setCacheEnabled,
  subscribeCacheEnabled,
} from "@/lib/cache-policy";

describe("cache-policy", () => {
  beforeEach(() => {
    localStorage.clear();
    resetCachePolicyForTests();
  });

  afterEach(() => {
    localStorage.clear();
    resetCachePolicyForTests();
  });

  it("defaults to enabled when no preference is stored", () => {
    expect(isCacheEnabled()).toBe(true);
  });

  it("persists disabled state in localStorage", () => {
    setCacheEnabled(false);
    expect(isCacheEnabled()).toBe(false);
    expect(localStorage.getItem("cache_enabled")).toBe("false");
  });

  it("notifies subscribers when the value changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCacheEnabled(listener);

    setCacheEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);

    setCacheEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);

    setCacheEnabled(true);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setCacheEnabled(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
