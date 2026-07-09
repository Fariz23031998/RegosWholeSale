import { create } from "zustand";
import type { Product } from "@/types/catalog";
import type { CatalogSort } from "@/lib/catalog-sort";
import { DEFAULT_CATALOG_SORT } from "@/lib/catalog-sort";
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
  catalogSort: CatalogSort;
  uiPreferencesHydrated: boolean;
  setProducts: (products: Product[]) => void;
  appendProducts: (products: Product[]) => void;
  requestRefresh: () => void;
  setMobileViewMode: (mode: CatalogViewMode) => void;
  setHideCardImages: (hide: boolean) => void;
  setCatalogSort: (sort: CatalogSort) => void;
  hydrateUiPreferences: () => Promise<void>;
  decrementStock: (productId: string, qty: number) => void;
  incrementStock: (productId: string, qty: number) => void;
};

function persistUiPreferences(
  state: Pick<CatalogState, "hideCardImages" | "mobileViewMode" | "catalogSort">,
) {
  if (!useCatalog.getState().uiPreferencesHydrated) return;
  void saveCatalogUiPreferences({
    hideCardImages: state.hideCardImages,
    mobileViewMode: state.mobileViewMode,
    catalogSort: state.catalogSort,
  }).catch(() => undefined);
}

export const useCatalog = create<CatalogState>((set, get) => ({
  products: [],
  refreshNonce: 0,
  mobileViewMode: "double",
  hideCardImages: false,
  catalogSort: { ...DEFAULT_CATALOG_SORT },
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
  setCatalogSort: (catalogSort) => {
    set({ catalogSort });
    persistUiPreferences({ ...get(), catalogSort });
  },
  hydrateUiPreferences: async () => {
    try {
      const preferences = await loadCatalogUiPreferences();
      set({
        mobileViewMode: preferences.mobileViewMode,
        hideCardImages: preferences.hideCardImages,
        catalogSort: preferences.catalogSort,
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
