import type { CatalogViewMode } from "@/store/catalog";
import {
  CATALOG_UI_STORE,
  openPulsePosDb,
} from "@/lib/pulse-pos-db";

const PREFERENCES_KEY = "preferences";

export type CatalogUiPreferences = {
  hideCardImages: boolean;
  mobileViewMode: CatalogViewMode;
};

const DEFAULT_PREFERENCES: CatalogUiPreferences = {
  hideCardImages: false,
  mobileViewMode: "double",
};

const VALID_VIEW_MODES = new Set<CatalogViewMode>(["single", "double", "list"]);

function normalizePreferences(value: unknown): CatalogUiPreferences {
  if (!value || typeof value !== "object") return { ...DEFAULT_PREFERENCES };

  const record = value as Partial<CatalogUiPreferences>;
  return {
    hideCardImages: Boolean(record.hideCardImages),
    mobileViewMode:
      record.mobileViewMode && VALID_VIEW_MODES.has(record.mobileViewMode)
        ? record.mobileViewMode
        : DEFAULT_PREFERENCES.mobileViewMode,
  };
}

export async function loadCatalogUiPreferences(): Promise<CatalogUiPreferences> {
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_UI_STORE, "readonly");
    const store = tx.objectStore(CATALOG_UI_STORE);
    const request = store.get(PREFERENCES_KEY);
    request.onerror = () => reject(request.error ?? new Error("Failed to load catalog UI preferences"));
    request.onsuccess = () => {
      resolve(normalizePreferences(request.result));
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load catalog UI preferences"));
    };
  });
}

export async function saveCatalogUiPreferences(
  preferences: CatalogUiPreferences,
): Promise<void> {
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_UI_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_UI_STORE);
    const request = store.put(preferences, PREFERENCES_KEY);
    request.onerror = () => reject(request.error ?? new Error("Failed to save catalog UI preferences"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save catalog UI preferences"));
    };
  });
}
