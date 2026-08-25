import { create } from "zustand";
import type { Product } from "@/types/catalog";
import { normalizeCartQty } from "@/lib/cart-stock";

export type CartItemPrintMeta = {
  itemCode?: string | null;
  itemArticul?: string | null;
  itemGroupId?: number | null;
  itemGroupName?: string | null;
  itemUnitName?: string | null;
  itemBrand?: string | null;
};

export type CartItem = {
  productId: string;
  regosItemId: number;
  name: string;
  price: number;
  qty: number;
  image: string;
  unitType?: number | null;
  /** Qty from the postponed document when continuing a sale. */
  postponedQty?: number;
} & CartItemPrintMeta;

export function cartItemPrintMetaFromProduct(product: Product): CartItemPrintMeta {
  return {
    itemCode: product.code?.trim() || null,
    itemArticul: product.articul?.trim() || null,
    itemGroupId: product.group_id ?? null,
    itemGroupName: product.category?.trim() || null,
    itemUnitName: product.unit_name?.trim() || null,
  };
}

export type DiscountMode = "percent" | "amount";
export type PostponedDocType = "wholesale" | "order_from_partner" | null;

type AddWithQtyOptions = {
  skipKeypad?: boolean;
};

type CartState = {
  items: CartItem[];
  discountMode: DiscountMode;
  discountValue: number;
  postponedWholesaleDocId: number | null;
  postponedDocType: PostponedDocType;
  lastAddedId: string | null;
  lastAddedAt: number;
  skipKeypadOnLastAdd: boolean;
  add: (p: Product) => void;
  addWithQty: (p: Product, qty: number, options?: AddWithQtyOptions) => void;
  clearSkipKeypadOnLastAdd: () => void;
  remove: (productId: string) => void;
  setQty: (productId: string, qty: number, unitType?: number | null) => void;
  setPrice: (productId: string, price: number) => void;
  setDiscountValue: (value: number) => void;
  toggleDiscountMode: () => void;
  setPostponedWholesaleDocId: (docId: number | null) => void;
  setPostponedDocType: (docType: PostponedDocType) => void;
  clear: () => void;
  restore: (snapshot: {
    items: CartItem[];
    discountMode: DiscountMode;
    discountValue: number;
    postponedWholesaleDocId?: number | null;
    postponedDocType?: PostponedDocType;
  }) => void;
  snapshot: () => {
    items: CartItem[];
    discountMode: DiscountMode;
    discountValue: number;
    postponedWholesaleDocId: number | null;
    postponedDocType: PostponedDocType;
  };
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
  postponedWholesaleDocId: null,
  postponedDocType: null,
  lastAddedId: null,
  lastAddedAt: 0,
  skipKeypadOnLastAdd: false,
  add: (p) => get().addWithQty(p, 1),
  addWithQty: (p, qty, options) =>
    set((s) => {
      const unitType = p.unit_type ?? null;
      const normalizedQty = normalizeCartQty(qty, unitType);
      if (normalizedQty <= 0) return s;

      const existing = s.items.find((i) => i.productId === p.id);
      const base = {
        lastAddedId: p.id,
        lastAddedAt: Date.now(),
        skipKeypadOnLastAdd: options?.skipKeypad ?? false,
      };
      if (existing) {
        return {
          ...base,
          items: s.items.map((i) =>
            i.productId === p.id
              ? {
                  ...i,
                  qty: normalizeCartQty(
                    i.qty + normalizedQty,
                    i.unitType ?? unitType,
                  ),
                }
              : i,
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
            qty: normalizedQty,
            image: p.image,
            unitType,
            ...cartItemPrintMetaFromProduct(p),
          },
        ],
      };
    }),
  clearSkipKeypadOnLastAdd: () => set({ skipKeypadOnLastAdd: false }),
  remove: (productId) =>
    set((s) => ({ items: s.items.filter((i) => i.productId !== productId) })),
  setQty: (productId, qty, unitType) =>
    set((s) => ({
      items: s.items
        .map((i) => {
          if (i.productId !== productId) return i;
          const resolvedUnitType = unitType ?? i.unitType;
          return {
            ...i,
            unitType: resolvedUnitType ?? i.unitType,
            qty: normalizeCartQty(qty, resolvedUnitType),
          };
        })
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
  setPostponedWholesaleDocId: (docId) => set({ postponedWholesaleDocId: docId }),
  setPostponedDocType: (docType) => set({ postponedDocType: docType }),
  clear: () =>
    set({
      items: [],
      discountMode: "percent",
      discountValue: 0,
      postponedWholesaleDocId: null,
      postponedDocType: null,
    }),
  restore: (snapshot) =>
    set({
      items: snapshot.items.map((item) => ({ ...item })),
      discountMode: snapshot.discountMode,
      discountValue: snapshot.discountValue,
      postponedWholesaleDocId: snapshot.postponedWholesaleDocId ?? null,
      postponedDocType:
        snapshot.postponedDocType ??
        (snapshot.postponedWholesaleDocId != null ? "wholesale" : null),
      lastAddedId: null,
      lastAddedAt: 0,
      skipKeypadOnLastAdd: false,
    }),
  snapshot: () => {
    const {
      items,
      discountMode,
      discountValue,
      postponedWholesaleDocId,
      postponedDocType,
    } = get();
    return {
      items: items.map((item) => ({ ...item })),
      discountMode,
      discountValue,
      postponedWholesaleDocId,
      postponedDocType,
    };
  },
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
