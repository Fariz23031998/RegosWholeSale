import { describe, expect, it } from "vitest";
import {
  REGOS_ITEM_IMAGE_MAX_BYTES,
  REGOS_ITEM_IMAGE_SIZE_PX,
  computeFitSize,
} from "./item-image-file";

describe("computeFitSize", () => {
  it("fits landscape images inside the square edge", () => {
    expect(computeFitSize(1800, 1200, REGOS_ITEM_IMAGE_SIZE_PX)).toEqual({
      width: 900,
      height: 600,
    });
  });

  it("fits portrait images inside the square edge", () => {
    expect(computeFitSize(1200, 1800, REGOS_ITEM_IMAGE_SIZE_PX)).toEqual({
      width: 600,
      height: 900,
    });
  });

  it("fits already-small images up to the square edge", () => {
    expect(computeFitSize(450, 300, REGOS_ITEM_IMAGE_SIZE_PX)).toEqual({
      width: 900,
      height: 600,
    });
  });

  it("handles square images", () => {
    expect(computeFitSize(4096, 4096, REGOS_ITEM_IMAGE_SIZE_PX)).toEqual({
      width: 900,
      height: 900,
    });
  });

  it("clamps degenerate inputs to at least 1px", () => {
    expect(computeFitSize(0, 0, 900)).toEqual({ width: 1, height: 1 });
    expect(computeFitSize(-10, 500, 900)).toEqual({ width: 1, height: 900 });
  });
});

describe("Regos item image constants", () => {
  it("matches Regos official photo prep size (min 900×900)", () => {
    expect(REGOS_ITEM_IMAGE_SIZE_PX).toBe(900);
    expect(REGOS_ITEM_IMAGE_MAX_BYTES).toBe(500 * 1024);
  });
});
