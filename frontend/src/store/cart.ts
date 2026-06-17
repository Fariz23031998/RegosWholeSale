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

type CartState = {
  items: CartItem[];
  discount: number;
  lastAddedId: string | null;
  lastAddedAt: number;
  add: (p: Product) => void;
  remove: (productId: string) => void;
  setQty: (productId: string, qty: number) => void;
  setPrice: (productId: string, price: number) => void;
  setDiscount: (d: number) => void;
  clear: () => void;
};

export const useCart = create<CartState>((set) => ({
  items: [],
  discount: 0,
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
  setDiscount: (d) => set({ discount: Math.max(0, d) }),
  clear: () => set({ items: [], discount: 0 }),
}));

export const cartTotals = (items: CartItem[], discount: number) => {
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const total = +(Math.max(0, subtotal - discount).toFixed(2));
  return {
    subtotal: +subtotal.toFixed(2),
    discount,
    total,
  };
};
