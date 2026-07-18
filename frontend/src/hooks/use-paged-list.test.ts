import { describe, expect, it } from "vitest";
import { listHasMore } from "@/hooks/use-paged-list";

describe("listHasMore", () => {
  it("uses total when available", () => {
    expect(listHasMore(100, 100, 274, 100, 100)).toBe(true);
    expect(listHasMore(274, 274, 274, 74, 100)).toBe(false);
  });

  it("falls back to next_offset and full pages when total is unknown", () => {
    expect(listHasMore(100, 100, 0, 100, 100)).toBe(true);
    expect(listHasMore(100, 0, 0, 40, 100)).toBe(false);
    expect(listHasMore(50, 100, 0, 50, 100)).toBe(true);
  });
});
