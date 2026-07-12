import {
  CATALOG_PRODUCTS_STORE,
  CATALOG_PAGES_STORE,
  CATALOG_GROUPS_STORE,
  PARTNERS_STORE,
  REFERENCE_OPTIONS_STORE,
  SETTINGS_CACHE_STORE,
  PAYMENT_TYPES_STORE,
  SYNC_META_STORE,
  openPulsePosDb,
} from "./pulse-pos-db";

export async function clearObjectStore(storeName: string): Promise<void> {
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onerror = () => reject(request.error ?? new Error(`Failed to clear store ${storeName}`));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error(`Failed to clear store ${storeName}`));
    };
  });
}

export async function clearProductCatalogCache(companyId: number): Promise<void> {
  await clearObjectStore(CATALOG_PRODUCTS_STORE);
  await clearObjectStore(CATALOG_PAGES_STORE);
  await clearObjectStore(CATALOG_GROUPS_STORE);
  await clearObjectStore(SYNC_META_STORE);

  // Clear download status in localStorage for all scopes
  const keys = Object.keys(localStorage);
  for (const key of keys) {
    if (key.startsWith("catalog_download_status:")) {
      localStorage.removeItem(key);
    }
  }
}

export async function clearPartnersCache(): Promise<void> {
  await clearObjectStore(PARTNERS_STORE);
}

export async function clearSettingsCache(): Promise<void> {
  await clearObjectStore(REFERENCE_OPTIONS_STORE);
  await clearObjectStore(SETTINGS_CACHE_STORE);
}

export async function clearPaymentTypesCache(): Promise<void> {
  await clearObjectStore(PAYMENT_TYPES_STORE);
}

export async function clearAllCaches(companyId: number): Promise<void> {
  await clearProductCatalogCache(companyId);
  await clearPartnersCache();
  await clearSettingsCache();
  await clearPaymentTypesCache();
}
