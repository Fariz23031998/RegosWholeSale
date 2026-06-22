import { create } from "zustand";
import type { Product } from "@/types/catalog";

export type CartItem = {
  productId: string;
  regosItemId: number;
  name: string;
  price: number;
  qty: number;
  image: string;
};

export type DiscountMode = "percent" | "amount";

type CartState = {
  items: CartItem[];
  discountMode: DiscountMode;
  discountValue: number;
  lastAddedId: string | null;
  lastAddedAt: number;
  add: (p: Product) => void;
  remove: (productId: string) => void;
  setQty: (productId: string, qty: number) => void;
  setPrice: (productId: string, price: number) => void;
  setDiscountValue: (value: number) => void;
  toggleDiscountMode: () => void;
  clear: () => void;
};

function cartSubtotal(items: CartItem[]): number {
  return +items.reduce((s, i) => s + i.price * i.qty, 0).toFixed(2);
}

function clampDiscountValue(mode: DiscountMode, value: number): number {
  const n = Math.max(0, value);
  return mode === "percent" ? Math.min(100, n) : n;
}

export const useCart = create<CartState>((set, get) => ({
  items: [],
  discountMode: "percent",
  discountValue: 0,
  lastAddedId: null,
  lastAddedAt: 0,
  add: (p) =>
    set((s) => {
      const existing = s.items.find((i) => i.productId === p.id);
      const base = { lastAddedId: p.id, lastAddedAt: Date.now() };
      if (existing) {
        return {
          ...base,
          items: s.items.map((i) =>
            i.productId === p.id ? { ...i, qty: i.qty + 1 } : i,
          ),
        };
      }
      return {
        ...base,
        items: [
          ...s.items,
          {
            productId: p.id,
            regosItemId:
              typeof p.regos_item_id === "number"
                ? p.regos_item_id
                : Number.parseInt(p.id, 10) || 0,
            name: p.name,
            price: p.price,
            qty: 1,
            image: p.image,
          },
        ],
      };
    }),
  remove: (productId) =>
    set((s) => ({ items: s.items.filter((i) => i.productId !== productId) })),
  setQty: (productId, qty) =>
    set((s) => ({
      items: s.items
        .map((i) => (i.productId === productId ? { ...i, qty } : i))
        .filter((i) => i.qty > 0),
    })),
  setPrice: (productId, price) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.productId === productId ? { ...i, price: Math.max(0, price) } : i,
      ),
    })),
  setDiscountValue: (value) =>
    set((s) => ({
      discountValue: clampDiscountValue(s.discountMode, value),
    })),
  toggleDiscountMode: () => {
    const { items, discountMode, discountValue } = get();
    const subtotal = cartSubtotal(items);
    const nextMode: DiscountMode =
      discountMode === "percent" ? "amount" : "percent";

    let nextValue = discountValue;
    if (discountValue > 0 && subtotal > 0) {
      if (discountMode === "percent") {
        nextValue = +(subtotal * (discountValue / 100)).toFixed(2);
      } else {
        nextValue = +Math.min(100, (discountValue / subtotal) * 100).toFixed(
          2,
        );
      }
    }

    set({
      discountMode: nextMode,
      discountValue: clampDiscountValue(nextMode, nextValue),
    });
  },
  clear: () =>
    set({ items: [], discountMode: "percent", discountValue: 0 }),
}));

export const cartTotals = (
  items: CartItem[],
  discountMode: DiscountMode,
  discountValue: number,
) => {
  const subtotal = cartSubtotal(items);
  const clampedValue = clampDiscountValue(discountMode, discountValue);

  let discount = 0;
  if (clampedValue > 0) {
    discount =
      discountMode === "amount"
        ? Math.min(subtotal, clampedValue)
        : subtotal * (clampedValue / 100);
  }

  discount = +discount.toFixed(2);
  const total = +(Math.max(0, subtotal - discount).toFixed(2));

  return {
    subtotal,
    discountMode,
    discountValue: clampedValue,
    discount,
    total,
  };
};
