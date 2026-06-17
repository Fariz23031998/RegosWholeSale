import { create } from "zustand";
import { SEED_SALES, type Sale, type SaleItem } from "@/data/seed";
import { useCatalog } from "./catalog";
import { useAuth } from "./auth";

type SalesState = {
  sales: Sale[];
  record: (sale: Sale) => void;
  refund: (
    originalId: string,
    items: SaleItem[],
    reason: string,
  ) => Sale | null;
  refundedQty: (saleId: string, productId: string) => number;
};

export const useSales = create<SalesState>((set, get) => ({
  sales: SEED_SALES,
  record: (sale) => set((s) => ({ sales: [sale, ...s.sales] })),
  refundedQty: (saleId, productId) => {
    return get()
      .sales.filter((s) => s.type === "refund" && s.refundOf === saleId)
      .reduce(
        (n, r) =>
          n +
          r.items
            .filter((i) => i.productId === productId)
            .reduce((m, i) => m + i.qty, 0),
        0,
      );
  },
  refund: (originalId, items, reason) => {
    const original = get().sales.find((s) => s.id === originalId);
    if (!original || items.length === 0) return null;
    const cashier = useAuth.getState().cashier;
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const total = +subtotal.toFixed(2);
    const refund: Sale = {
      id: `R${Date.now().toString(36).toUpperCase()}`,
      createdAt: new Date().toISOString(),
      cashierId: cashier?.id ?? original.cashierId,
      cashierName: cashier?.name ?? original.cashierName,
      items: items.map((i) => ({ ...i, qty: -i.qty })),
      subtotal: -subtotal,
      discount: 0,
      tax: 0,
      total: -total,
      paymentTypeId: original.paymentTypeId,
      paymentTypeName: original.paymentTypeName,
      isCash: original.isCash,
      type: "refund",
      refundOf: originalId,
      reason,
    };
    // Restock returned items
    const incrementStock = useCatalog.getState().incrementStock;
    items.forEach((i) => incrementStock(i.productId, i.qty));
    set((s) => ({ sales: [refund, ...s.sales] }));
    return refund;
  },
}));
