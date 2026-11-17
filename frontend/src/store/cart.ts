import { create } from "zustand";
import type { Product } from "@/types/catalog";
import { normalizeCartQty } from "@/lib/cart-stock";
import {
  resolveUnitPrice,
  toBaseQty,
  toEnteredQty,
  unitMetaForSelection,
  type SelectedUnitKind,
} from "@/lib/secondary-units";

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
  /** Original list / catalog unit price captured when the item was added. */
  listPrice?: number;
  /** Quantity in the item's main (Regos) unit — used for stock and checkout. */
  qty: number;
  /** Quantity in the cashier-selected unit (display / receipts). */
  enteredQty?: number;
  selectedUnit?: SelectedUnitKind;
  conversionFactor?: number;
  selectedUnitName?: string | null;
  selectedUnitType?: number | null;
  image: string;
  unitType?: number | null;
  /** Qty from the postponed document when continuing a sale. */
  postponedQty?: number;
} & CartItemPrintMeta;

export function cartItemListPrice(item: Pick<CartItem, "price" | "listPrice">): number {
  return item.listPrice ?? item.price;
}

export function toCheckoutCartItem(
  item: CartItem,
  keypadUpdateDiscountedPriceOnly: boolean,
): { regos_item_id: number; qty: number; price: number; price2?: number } {
  return {
    regos_item_id: item.regosItemId,
    qty: item.qty,
    price: item.price,
    ...(keypadUpdateDiscountedPriceOnly ? { price2: cartItemListPrice(item) } : {}),
  };
}

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
  /** Force quantity keypad open even when auto-open is off (e.g. ask-unit mode). */
  forceKeypad?: boolean;
  /** Quantity is in this unit; converted to main-unit `qty` when secondary. */
  selectedUnit?: SelectedUnitKind;
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
  forceKeypadOnLastAdd: boolean;
  add: (p: Product, options?: AddWithQtyOptions) => void;
  addWithQty: (p: Product, qty: number, options?: AddWithQtyOptions) => void;
  clearSkipKeypadOnLastAdd: () => void;
  clearForceKeypadOnLastAdd: () => void;
  remove: (productId: string) => void;
  /** `qty` argument is entered (selected-unit) quantity. */
  setQty: (productId: string, qty: number, unitType?: number | null) => void;
  setSelectedUnit: (
    productId: string,
    selectedUnit: SelectedUnitKind,
    product: Product,
  ) => void;
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
  forceKeypadOnLastAdd: false,
  add: (p, options) => get().addWithQty(p, 1, options),
  addWithQty: (p, qty, options) =>
    set((s) => {
      const selectedUnit: SelectedUnitKind = options?.selectedUnit ?? "main";
      const meta = unitMetaForSelection(p, selectedUnit);
      const entered = normalizeCartQty(qty, meta.selectedUnitType);
      if (entered <= 0) return s;
      const addBase = normalizeCartQty(
        toBaseQty(entered, meta.conversionFactor),
        p.unit_type ?? null,
      );
      if (addBase <= 0) return s;

      const existing = s.items.find((i) => i.productId === p.id);
      const base = {
        lastAddedId: p.id,
        lastAddedAt: Date.now(),
        skipKeypadOnLastAdd: options?.skipKeypad ?? false,
        forceKeypadOnLastAdd: options?.forceKeypad ?? false,
      };
      if (existing) {
        const factor = existing.conversionFactor ?? 1;
        const nextBase = normalizeCartQty(
          existing.qty + addBase,
          p.unit_type ?? existing.unitType,
        );
        const nextEntered = normalizeCartQty(
          toEnteredQty(nextBase, factor),
          existing.selectedUnitType ?? existing.unitType,
        );
        return {
          ...base,
          items: s.items.map((i) =>
            i.productId === p.id
              ? {
                  ...i,
                  qty: nextBase,
                  enteredQty: nextEntered,
                }
              : i,
          ),
        };
      }
      const printMeta = cartItemPrintMetaFromProduct(p);
      const unitPrice = resolveUnitPrice(p, selectedUnit);
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
            price: unitPrice,
            listPrice: unitPrice,
            qty: addBase,
            enteredQty: entered,
            selectedUnit,
            conversionFactor: meta.conversionFactor,
            selectedUnitName: meta.selectedUnitName,
            selectedUnitType: meta.selectedUnitType,
            image: p.image,
            unitType: meta.unitType,
            ...printMeta,
            // Always keep the product main unit name for dual-unit cart display.
            itemUnitName: printMeta.itemUnitName,
          },
        ],
      };
    }),
  clearSkipKeypadOnLastAdd: () => set({ skipKeypadOnLastAdd: false }),
  clearForceKeypadOnLastAdd: () => set({ forceKeypadOnLastAdd: false }),
  remove: (productId) =>
    set((s) => ({ items: s.items.filter((i) => i.productId !== productId) })),
  setQty: (productId, qty, unitType) =>
    set((s) => ({
      items: s.items
        .map((i) => {
          if (i.productId !== productId) return i;
          const factor = i.conversionFactor ?? 1;
          const displayUnitType =
            unitType ?? i.selectedUnitType ?? i.unitType;
          const entered = normalizeCartQty(qty, displayUnitType);
          const base = normalizeCartQty(toBaseQty(entered, factor), null);
          return {
            ...i,
            unitType: displayUnitType ?? i.unitType,
            selectedUnitType: displayUnitType ?? i.selectedUnitType,
            enteredQty: entered,
            qty: base,
          };
        })
        .filter((i) => i.qty > 0),
    })),
  setSelectedUnit: (productId, selectedUnit, product) =>
    set((s) => ({
      items: s.items.map((i) => {
        if (i.productId !== productId) return i;
        const previousUnit = i.selectedUnit ?? "main";
        const meta = unitMetaForSelection(product, selectedUnit);
        const entered =
          i.enteredQty ??
          toEnteredQty(i.qty, i.conversionFactor ?? 1);
        const normalizedEntered = normalizeCartQty(
          entered,
          meta.selectedUnitType,
        );
        const base = normalizeCartQty(
          toBaseQty(normalizedEntered, meta.conversionFactor),
          product.unit_type ?? null,
        );
        const next: CartItem = {
          ...i,
          selectedUnit,
          conversionFactor: meta.conversionFactor,
          selectedUnitName: meta.selectedUnitName,
          selectedUnitType: meta.selectedUnitType,
          unitType: meta.unitType,
          enteredQty: normalizedEntered,
          qty: base,
        };
        if (previousUnit !== selectedUnit) {
          const unitPrice = resolveUnitPrice(product, selectedUnit);
          const listPrice = cartItemListPrice(i);
          const priceWasModified = Math.abs(i.price - listPrice) > 0.0001;
          next.listPrice = unitPrice;
          if (!priceWasModified) {
            next.price = unitPrice;
          }
        }
        return next;
      }),
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
      forceKeypadOnLastAdd: false,
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
