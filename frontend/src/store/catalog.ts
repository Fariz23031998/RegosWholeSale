import { create } from "zustand";
import type { Product } from "@/types/catalog";

type CatalogState = {
  products: Product[];
  refreshNonce: number;
  setProducts: (products: Product[]) => void;
  appendProducts: (products: Product[]) => void;
  requestRefresh: () => void;
  decrementStock: (productId: string, qty: number) => void;
  incrementStock: (productId: string, qty: number) => void;
};

export const useCatalog = create<CatalogState>((set) => ({
  products: [],
  refreshNonce: 0,
  setProducts: (products) => set({ products }),
  requestRefresh: () => set((s) => ({ refreshNonce: s.refreshNonce + 1 })),
  appendProducts: (products) =>
    set((s) => {
      const seen = new Set(s.products.map((p) => p.id));
      return {
        products: [...s.products, ...products.filter((p) => !seen.has(p.id))],
      };
    }),
  decrementStock: (productId, qty) =>
    set((s) => ({
      products: s.products.map((p) =>
        p.id === productId ? { ...p, stock: Math.max(0, p.stock - qty) } : p,
      ),
    })),
  incrementStock: (productId, qty) =>
    set((s) => ({
      products: s.products.map((p) =>
        p.id === productId ? { ...p, stock: p.stock + qty } : p,
      ),
    })),
}));
