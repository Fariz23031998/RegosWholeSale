import { describe, expect, it } from "vitest";
import {
  canAddProductToCart,
  canFitBaseQtyInCart,
  canIncreaseCartQty,
  cartLinesWithinStock,
  clampCartQty,
  applyStockAdjustments,
  computeCheckoutStockAdjustments,
  computePostponeStockAdjustments,
  revertStockAdjustments,
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

describe("canFitBaseQtyInCart", () => {
  it("blocks a secondary-sized add when remaining stock is below the conversion factor", () => {
    const p = product(10);
    const factor = 12;
    expect(canFitBaseQtyInCart(p, 0, factor, false, 0)).toBe(false);
    expect(canFitBaseQtyInCart(p, 0, 10, false, 0)).toBe(true);
  });

  it("allows a secondary-sized add when out-of-stock sales are enabled", () => {
    const p = product(0);
    expect(canFitBaseQtyInCart(p, 0, 12, true, 0)).toBe(true);
  });

  it("accounts for qty already in the active cart", () => {
    const p = product(20);
    expect(canFitBaseQtyInCart(p, 10, 12, false, 0)).toBe(false);
    expect(canFitBaseQtyInCart(p, 8, 12, false, 0)).toBe(true);
  });

  it("blocks a second secondary package when stock is 23 and factor is 13", () => {
    const p = product(23);
    const factor = 13;
    expect(canFitBaseQtyInCart(p, 0, factor, false, 0)).toBe(true);
    expect(canFitBaseQtyInCart(p, 13, factor, false, 0)).toBe(false);
  });
});

describe("cartLinesWithinStock", () => {
  it("returns true when out-of-stock sales are enabled even if over stock", () => {
    expect(
      cartLinesWithinStock([{ productId: "1", qty: 50 }], [product(10)], true),
    ).toBe(true);
  });

  it("returns false when a line exceeds available stock with out-of-stock sales off", () => {
    expect(
      cartLinesWithinStock([{ productId: "1", qty: 15 }], [product(10)], false),
    ).toBe(false);
    expect(
      cartLinesWithinStock([{ productId: "1", qty: 10 }], [product(10)], false),
    ).toBe(true);
  });

  it("subtracts other-tab reservations from available stock", () => {
    expect(
      cartLinesWithinStock(
        [{ productId: "1", qty: 10 }],
        [product(20)],
        false,
        { "1": 15 },
      ),
    ).toBe(false);
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

  it("reverts stock adjustments by swapping increment and decrement", () => {
    const decrements: Array<{ productId: string; qty: number }> = [];
    const increments: Array<{ productId: string; qty: number }> = [];
    applyStockAdjustments(
      [{ productId: "1", decrement: 2, increment: 0 }],
      (productId, qty) => decrements.push({ productId, qty }),
      (productId, qty) => increments.push({ productId, qty }),
    );
    expect(decrements).toEqual([{ productId: "1", qty: 2 }]);

    decrements.length = 0;
    increments.length = 0;
    revertStockAdjustments(
      [{ productId: "1", decrement: 2, increment: 0 }],
      (productId, qty) => decrements.push({ productId, qty }),
      (productId, qty) => increments.push({ productId, qty }),
    );
    expect(increments).toEqual([{ productId: "1", qty: 2 }]);
  });
});
