export const PULSE_POS_DB_NAME = "pulse-pos";
export const PULSE_POS_DB_VERSION = 10;

export const CHECKOUT_TABS_STORE = "checkout-tabs";
export const CATALOG_UI_STORE = "catalog-ui";
export const SELL_CONTEXT_STORE = "sell-context";
export const SETTINGS_CACHE_STORE = "settings-cache";
export const CATALOG_PRODUCTS_STORE = "catalog-products";
export const CATALOG_PAGES_STORE = "catalog-pages";
export const CATALOG_GROUPS_STORE = "catalog-groups";
export const PAYMENT_TYPES_STORE = "payment-types";
export const REFERENCE_OPTIONS_STORE = "reference-options";
export const PENDING_SALES_STORE = "pending-sales";
export const PARTNERS_STORE = "partners";
export const SYNC_META_STORE = "sync-meta";

export function ensurePulsePosStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(CHECKOUT_TABS_STORE)) {
    db.createObjectStore(CHECKOUT_TABS_STORE);
  }
  if (!db.objectStoreNames.contains(CATALOG_UI_STORE)) {
    db.createObjectStore(CATALOG_UI_STORE);
  }
  if (!db.objectStoreNames.contains(SELL_CONTEXT_STORE)) {
    db.createObjectStore(SELL_CONTEXT_STORE);
  }
  if (!db.objectStoreNames.contains(SETTINGS_CACHE_STORE)) {
    db.createObjectStore(SETTINGS_CACHE_STORE);
  }
  if (!db.objectStoreNames.contains(CATALOG_PRODUCTS_STORE)) {
    const store = db.createObjectStore(CATALOG_PRODUCTS_STORE, { keyPath: "key" });
    store.createIndex("scopeKey", "scopeKey", { unique: false });
    store.createIndex("barcode", "barcode", { unique: false });
    store.createIndex("code", "code", { unique: false });
  }
  if (!db.objectStoreNames.contains(CATALOG_PAGES_STORE)) {
    db.createObjectStore(CATALOG_PAGES_STORE);
  }
  if (!db.objectStoreNames.contains(CATALOG_GROUPS_STORE)) {
    db.createObjectStore(CATALOG_GROUPS_STORE);
  }
  if (!db.objectStoreNames.contains(PAYMENT_TYPES_STORE)) {
    db.createObjectStore(PAYMENT_TYPES_STORE);
  }
  if (!db.objectStoreNames.contains(REFERENCE_OPTIONS_STORE)) {
    db.createObjectStore(REFERENCE_OPTIONS_STORE);
  }
  if (!db.objectStoreNames.contains(PENDING_SALES_STORE)) {
    const store = db.createObjectStore(PENDING_SALES_STORE, { keyPath: "localId" });
    store.createIndex("scopeKey", "scopeKey", { unique: false });
    store.createIndex("status", "status", { unique: false });
  }
  if (!db.objectStoreNames.contains(PARTNERS_STORE)) {
    db.createObjectStore(PARTNERS_STORE);
  }
  if (!db.objectStoreNames.contains(SYNC_META_STORE)) {
    db.createObjectStore(SYNC_META_STORE);
  }
}

export function openPulsePosDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PULSE_POS_DB_NAME, PULSE_POS_DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      ensurePulsePosStores(request.result);
    };
  });
}

export function buildCatalogScopeKey(
  companyId: number | null | undefined,
  warehouseId: number | null | undefined,
  priceTypeId: number | null | undefined,
): string {
  return `${companyId ?? 0}:${warehouseId ?? 0}:${priceTypeId ?? 0}`;
}

export function buildCatalogProductKey(scopeKey: string, productId: string): string {
  return `${scopeKey}:${productId}`;
}
