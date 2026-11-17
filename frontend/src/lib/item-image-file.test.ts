import { describe, expect, it } from "vitest";
import {
  REGOS_ITEM_IMAGE_MAX_BYTES,
  REGOS_ITEM_IMAGE_MAX_EDGE_PX,
  computeFitSize,
} from "./item-image-file";

describe("computeFitSize", () => {
  it("returns the same size when already within the max edge", () => {
    expect(computeFitSize(800, 600, REGOS_ITEM_IMAGE_MAX_EDGE_PX)).toEqual({
      width: 800,
      height: 600,
    });
    expect(computeFitSize(2000, 1500, 2000)).toEqual({
      width: 2000,
      height: 1500,
    });
  });

  it("scales down so the longest edge equals maxEdge", () => {
    expect(computeFitSize(4000, 3000, 2000)).toEqual({
      width: 2000,
      height: 1500,
    });
    expect(computeFitSize(3000, 4000, 2000)).toEqual({
      width: 1500,
      height: 2000,
    });
  });

  it("handles square images", () => {
    expect(computeFitSize(4096, 4096, 2000)).toEqual({
      width: 2000,
      height: 2000,
    });
  });

  it("clamps degenerate inputs to at least 1px", () => {
    expect(computeFitSize(0, 0, 2000)).toEqual({ width: 1, height: 1 });
    expect(computeFitSize(-10, 500, 100)).toEqual({ width: 1, height: 100 });
  });
});

describe("Regos item image constants", () => {
  it("matches published Regos catalog limits", () => {
    expect(REGOS_ITEM_IMAGE_MAX_EDGE_PX).toBe(2000);
    expect(REGOS_ITEM_IMAGE_MAX_BYTES).toBe(1024 * 1024);
  });
});
