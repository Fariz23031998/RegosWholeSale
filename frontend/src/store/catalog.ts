import { create } from "zustand";
import type { Product } from "@/types/catalog";
import {
  loadCatalogUiPreferences,
  saveCatalogUiPreferences,
} from "@/lib/catalog-ui-db";

export type CatalogViewMode = "single" | "double" | "list";

type CatalogState = {
  products: Product[];
  refreshNonce: number;
  mobileViewMode: CatalogViewMode;
  hideCardImages: boolean;
  uiPreferencesHydrated: boolean;
  setProducts: (products: Product[]) => void;
  appendProducts: (products: Product[]) => void;
  requestRefresh: () => void;
  setMobileViewMode: (mode: CatalogViewMode) => void;
  setHideCardImages: (hide: boolean) => void;
  hydrateUiPreferences: () => Promise<void>;
  decrementStock: (productId: string, qty: number) => void;
  incrementStock: (productId: string, qty: number) => void;
};

function persistUiPreferences(state: Pick<CatalogState, "hideCardImages" | "mobileViewMode">) {
  if (!useCatalog.getState().uiPreferencesHydrated) return;
  void saveCatalogUiPreferences({
    hideCardImages: state.hideCardImages,
    mobileViewMode: state.mobileViewMode,
  }).catch(() => undefined);
}

export const useCatalog = create<CatalogState>((set, get) => ({
  products: [],
  refreshNonce: 0,
  mobileViewMode: "double",
  hideCardImages: false,
  uiPreferencesHydrated: false,
  setProducts: (products) => set({ products }),
  requestRefresh: () => set((s) => ({ refreshNonce: s.refreshNonce + 1 })),
  setMobileViewMode: (mode) => {
    set({ mobileViewMode: mode });
    persistUiPreferences({ ...get(), mobileViewMode: mode });
  },
  setHideCardImages: (hideCardImages) => {
    set({ hideCardImages });
    persistUiPreferences({ ...get(), hideCardImages });
  },
  hydrateUiPreferences: async () => {
    try {
      const preferences = await loadCatalogUiPreferences();
      set({
        mobileViewMode: preferences.mobileViewMode,
        hideCardImages: preferences.hideCardImages,
        uiPreferencesHydrated: true,
      });
    } catch {
      set({ uiPreferencesHydrated: true });
    }
  },
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
