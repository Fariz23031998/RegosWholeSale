import type { CartItem, DiscountMode } from "@/store/cart";

const DB_NAME = "pulse-pos";
const STORE_NAME = "checkout-tabs";
const DB_VERSION = 1;

export type CheckoutTabData = {
  id: string;
  label: string;
  items: CartItem[];
  discountMode: DiscountMode;
  discountValue: number;
  postponedWholesaleDocId?: number | null;
  updatedAt: number;
};

export type CheckoutTabsRecord = {
  activeTabId: string;
  tabs: CheckoutTabData[];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function loadCheckoutTabs(
  scopeKey: string,
): Promise<CheckoutTabsRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(scopeKey);
    request.onerror = () => reject(request.error ?? new Error("Failed to load tabs"));
    request.onsuccess = () => {
      resolve((request.result as CheckoutTabsRecord | undefined) ?? null);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load tabs"));
    };
  });
}

export async function saveCheckoutTabs(
  scopeKey: string,
  record: CheckoutTabsRecord,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record, scopeKey);
    request.onerror = () => reject(request.error ?? new Error("Failed to save tabs"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save tabs"));
    };
  });
}
