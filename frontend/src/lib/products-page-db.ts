import type { Product } from "@/types/catalog";
import { CATALOG_UI_STORE, openPulsePosDb } from "@/lib/pulse-pos-db";

const PRODUCTS_PAGE_KEY = "products-page";

export type ProductsPageSelectedItem = {
  id: string;
  product: Product;
  copies: number;
};

export type ProductsPageState = {
  selected: ProductsPageSelectedItem[];
  showSelectedOnly: boolean;
};

const DEFAULT_STATE: ProductsPageState = {
  selected: [],
  showSelectedOnly: false,
};

function clampCopies(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(99, Math.max(1, Math.round(n)));
}

function normalizeSelectedItem(value: unknown): ProductsPageSelectedItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ProductsPageSelectedItem>;
  if (typeof record.id !== "string" || !record.id) return null;
  if (!record.product || typeof record.product !== "object") return null;
  const product = record.product as Product;
  if (typeof product.id !== "string" || !product.id) return null;
  return {
    id: record.id,
    product: { ...product, id: product.id },
    copies: clampCopies(record.copies),
  };
}

function normalizeState(value: unknown): ProductsPageState {
  if (!value || typeof value !== "object") return { ...DEFAULT_STATE, selected: [] };

  const record = value as Partial<ProductsPageState>;
  const selected: ProductsPageSelectedItem[] = [];
  const seen = new Set<string>();
  if (Array.isArray(record.selected)) {
    for (const item of record.selected) {
      const normalized = normalizeSelectedItem(item);
      if (!normalized || seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      selected.push(normalized);
    }
  }

  return {
    selected,
    showSelectedOnly: Boolean(record.showSelectedOnly),
  };
}

export async function loadProductsPageState(): Promise<ProductsPageState> {
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_UI_STORE, "readonly");
    const store = tx.objectStore(CATALOG_UI_STORE);
    const request = store.get(PRODUCTS_PAGE_KEY);
    request.onerror = () => reject(request.error ?? new Error("Failed to load products page state"));
    request.onsuccess = () => {
      resolve(normalizeState(request.result));
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load products page state"));
    };
  });
}

export async function saveProductsPageState(state: ProductsPageState): Promise<void> {
  const payload = normalizeState(state);
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_UI_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_UI_STORE);
    const request = store.put(payload, PRODUCTS_PAGE_KEY);
    request.onerror = () => reject(request.error ?? new Error("Failed to save products page state"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save products page state"));
    };
  });
}
