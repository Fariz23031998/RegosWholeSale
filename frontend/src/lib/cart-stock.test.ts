import { describe, expect, it } from "vitest";
import {
  canAddProductToCart,
  canIncreaseCartQty,
  clampCartQty,
  computeCheckoutStockAdjustments,
  computePostponeStockAdjustments,
  getBookedContinuationCartStock,
  getCartAvailabilityStock,
  isBookedOrderFromPartnerContinuation,
  maxCartQty,
  shouldReserveStockOnPostpone,
} from "@/lib/cart-stock";
import type { Product } from "@/types/catalog";

const product = (stock: number): Product => ({
  id: "1",
  name: "Widget",
  price: 10,
  stock,
  image: "",
  sku: "W1",
  category: "General",
});

describe("maxCartQty", () => {
  it("caps at remaining stock after other tab reservations", () => {
    expect(maxCartQty(35, false, 35)).toBe(0);
    expect(maxCartQty(35, false, 10)).toBe(25);
  });

  it("allows unlimited qty when out-of-stock sales enabled", () => {
    expect(maxCartQty(20, true, 0)).toBeNull();
    expect(maxCartQty(0, true, 0)).toBeNull();
    expect(maxCartQty(-2, true, 0)).toBeNull();
    expect(maxCartQty(35, true, 35)).toBeNull();
  });

  it("blocks sales at zero stock when out-of-stock sales disabled", () => {
    expect(maxCartQty(0, false, 0)).toBe(0);
  });
});

describe("canAddProductToCart", () => {
  it("prevents adding in a second tab when the first tab reserved all stock", () => {
    const p = product(35);
    expect(canAddProductToCart(p, 0, false, 35)).toBe(false);
    expect(canAddProductToCart(p, 0, true, 35)).toBe(true);
  });

  it("prevents adding more in the active tab when it already holds all remaining stock", () => {
    const p = product(35);
    expect(canAddProductToCart(p, 35, false, 0)).toBe(false);
    expect(canAddProductToCart(p, 34, false, 0)).toBe(true);
  });
});

describe("canIncreaseCartQty", () => {
  it("respects reservations held in other tabs", () => {
    expect(
      canIncreaseCartQty("1", 10, [product(35)], false, 25),
    ).toBe(false);
    expect(
      canIncreaseCartQty("1", 9, [product(35)], false, 25),
    ).toBe(true);
  });
});

describe("clampCartQty", () => {
  it("clamps totals using other-tab reservations", () => {
    expect(clampCartQty(40, 35, false, 1, 35)).toBe(0);
    expect(clampCartQty(20, 35, false, 1, 20)).toBe(15);
  });

  it("does not clamp when out-of-stock sales enabled", () => {
    expect(clampCartQty(50, 20, true, 1, 0)).toBe(50);
    expect(clampCartQty(50, 20, true, 1, 20)).toBe(50);
  });
});

describe("booked order continuation stock", () => {
  it("detects booked partner-order continuation", () => {
    expect(
      isBookedOrderFromPartnerContinuation(
        "order_from_partner",
        1001,
        "doc_order_from_partner",
        true,
      ),
    ).toBe(true);
    expect(
      isBookedOrderFromPartnerContinuation(
        "order_from_partner",
        1001,
        "doc_order_from_partner",
        false,
      ),
    ).toBe(false);
    expect(
      isBookedOrderFromPartnerContinuation(
        "wholesale",
        1001,
        "doc_order_from_partner",
        true,
      ),
    ).toBe(false);
  });

  it("restores cart availability for items already in the continued cart", () => {
    expect(getBookedContinuationCartStock(90, 10)).toBe(100);
    expect(getBookedContinuationCartStock(90, 0)).toBe(90);
    expect(
      getCartAvailabilityStock(90, 10, { bookedOrderContinuation: true }),
    ).toBe(100);
    expect(
      getCartAvailabilityStock(90, 0, { bookedOrderContinuation: true }),
    ).toBe(90);
  });

  it("allows editing continued booked order lines without double-counting stock", () => {
    const p = product(90);
    expect(
      canAddProductToCart(p, 10, false, 0, { bookedOrderContinuation: true }),
    ).toBe(true);
    expect(
      canIncreaseCartQty("1", 10, [p], false, 0, {
        bookedOrderContinuation: true,
      }),
    ).toBe(true);
    expect(
      clampCartQty(15, 90, false, 1, 0, { bookedOrderContinuation: true }, 10),
    ).toBe(15);
  });
});

describe("postpone and checkout stock adjustments", () => {
  it("reserves stock on first booked postpone", () => {
    expect(
      computePostponeStockAdjustments(
        [{ productId: "1", qty: 2 }],
        false,
      ),
    ).toEqual([{ productId: "1", decrement: 2, increment: 0 }]);
  });

  it("applies only qty delta when updating a postponed doc", () => {
    expect(
      computePostponeStockAdjustments(
        [{ productId: "1", qty: 3, postponedQty: 2 }],
        true,
      ),
    ).toEqual([{ productId: "1", decrement: 1, increment: 0 }]);
    expect(
      computePostponeStockAdjustments(
        [{ productId: "1", qty: 1, postponedQty: 2 }],
        true,
      ),
    ).toEqual([{ productId: "1", decrement: 0, increment: 1 }]);
  });

  it("skips checkout decrement for unchanged continued booked orders", () => {
    expect(
      computeCheckoutStockAdjustments(
        [{ productId: "1", qty: 2, postponedQty: 2 }],
        true,
      ),
    ).toEqual([{ productId: "1", decrement: 0, increment: 0 }]);
  });

  it("decrements checkout delta when qty increased during continuation", () => {
    expect(
      computeCheckoutStockAdjustments(
        [{ productId: "1", qty: 3, postponedQty: 2 }],
        true,
      ),
    ).toEqual([{ productId: "1", decrement: 1, increment: 0 }]);
  });

  it("decrements full qty on normal checkout", () => {
    expect(
      computeCheckoutStockAdjustments([{ productId: "1", qty: 2 }], false),
    ).toEqual([{ productId: "1", decrement: 2, increment: 0 }]);
  });

  it("detects when postpone should reserve stock", () => {
    expect(
      shouldReserveStockOnPostpone("doc_order_from_partner", true),
    ).toBe(true);
    expect(
      shouldReserveStockOnPostpone("doc_order_from_partner", false),
    ).toBe(false);
    expect(shouldReserveStockOnPostpone("doc_wholesale", true)).toBe(false);
  });
});
