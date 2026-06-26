import type { CartItem, DiscountMode, PostponedDocType } from "@/store/cart";
import {
  CHECKOUT_TABS_STORE,
  openPulsePosDb,
} from "@/lib/pulse-pos-db";

const STORE_NAME = CHECKOUT_TABS_STORE;

export type CheckoutTabData = {
  id: string;
  label: string;
  items: CartItem[];
  discountMode: DiscountMode;
  discountValue: number;
  postponedWholesaleDocId?: number | null;
  postponedDocType?: PostponedDocType;
  updatedAt: number;
};

export type CheckoutTabsRecord = {
  activeTabId: string;
  tabs: CheckoutTabData[];
};

function openDb(): Promise<IDBDatabase> {
  return openPulsePosDb();
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
