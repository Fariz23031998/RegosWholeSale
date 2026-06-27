export const PULSE_POS_DB_NAME = "pulse-pos";
export const PULSE_POS_DB_VERSION = 3;

export const CHECKOUT_TABS_STORE = "checkout-tabs";
export const CATALOG_UI_STORE = "catalog-ui";
export const SELL_CONTEXT_STORE = "sell-context";

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
