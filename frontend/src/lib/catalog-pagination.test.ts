import { describe, expect, it } from "vitest";
import {
  catalogCanLoadMore,
  catalogEffectiveNextOffset,
  catalogHasMore,
  nextCatalogCursor,
} from "./catalog-pagination";

describe("catalogHasMore", () => {  it("stops after a single search hit", () => {
    const res = { products: [{}], next_offset: 0, total: 1 };
    expect(catalogHasMore(res, 0, 1)).toBe(false);
  });

  it("continues when backend exposes a next offset", () => {
    const res = { products: Array(20).fill({}), next_offset: 20, total: 50 };
    expect(catalogHasMore(res, 0, 20)).toBe(true);
  });

  it("continues when total exceeds loaded count", () => {
    const res = { products: Array(5).fill({}), next_offset: 0, total: 25 };
    expect(catalogHasMore(res, 0, 5)).toBe(true);
  });
});

describe("nextCatalogCursor", () => {
  it("does not advance past a complete search result", () => {
    expect(nextCatalogCursor(0, 1, 0, 1, 1)).toBe(0);
  });

  it("uses backend next offset when provided", () => {
    expect(nextCatalogCursor(0, 20, 20, 50, 20)).toBe(20);
  });

  it("falls back to row scan when total is unknown", () => {
    expect(nextCatalogCursor(0, 20, 0, 0, 20)).toBe(20);
  });
});

describe("catalogEffectiveNextOffset", () => {
  it("clears next offset for a short search page", () => {
    const res = { products: [{}], next_offset: 20, total: 500 };
    expect(catalogEffectiveNextOffset(res, 1, true)).toBe(0);
  });

  it("keeps next offset for a full search page", () => {
    const res = { products: Array(20).fill({}), next_offset: 20, total: 50 };
    expect(catalogEffectiveNextOffset(res, 20, true)).toBe(20);
  });
});

describe("catalogCanLoadMore", () => {
  it("does not load more after a single search hit", () => {
    expect(catalogCanLoadMore(0, 1, 1, true, 1)).toBe(false);
  });

  it("loads more when search results span pages", () => {
    expect(catalogCanLoadMore(20, 50, 20, true, 20)).toBe(true);
  });

  it("ignores catalog-wide totals for short search pages", () => {
    expect(catalogCanLoadMore(20, 500, 1, true, 1)).toBe(false);
  });
});
