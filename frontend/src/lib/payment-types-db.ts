import { PAYMENT_TYPES_STORE, openPulsePosDb } from "@/lib/pulse-pos-db";
import { isCacheEnabled } from "@/lib/cache-policy";
import type { PaymentType } from "@/types/payment";

export type CachedPaymentTypesRecord = {
  payment_types: PaymentType[];
  fetchedAt: number;
};

async function openDb(): Promise<IDBDatabase> {
  return openPulsePosDb();
}

export async function loadCachedPaymentTypes(
  companyId: number,
): Promise<CachedPaymentTypesRecord | null> {
  if (!isCacheEnabled()) return null;
  const db = await openDb();
  const key = String(companyId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PAYMENT_TYPES_STORE, "readonly");
    const store = tx.objectStore(PAYMENT_TYPES_STORE);
    const request = store.get(key);
    request.onerror = () => reject(request.error ?? new Error("Failed to load cached payment types"));
    request.onsuccess = () => {
      resolve((request.result as CachedPaymentTypesRecord | undefined) ?? null);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load cached payment types"));
    };
  });
}

export async function saveCachedPaymentTypes(
  companyId: number,
  paymentTypes: PaymentType[],
): Promise<void> {
  if (!isCacheEnabled()) return;
  const db = await openDb();
  const key = String(companyId);
  const record: CachedPaymentTypesRecord = {
    payment_types: paymentTypes,
    fetchedAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PAYMENT_TYPES_STORE, "readwrite");
    const store = tx.objectStore(PAYMENT_TYPES_STORE);
    const request = store.put(record, key);
    request.onerror = () => reject(request.error ?? new Error("Failed to save cached payment types"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save cached payment types"));
    };
  });
}

export async function removePaymentTypes(companyId: number, ids: number[]): Promise<void> {
  if (!isCacheEnabled()) return;
  if (ids.length === 0) return;
  const cached = await loadCachedPaymentTypes(companyId).catch(() => null);
  if (!cached) return;
  const idSet = new Set(ids);
  const paymentTypes = cached.payment_types.filter((type) => !idSet.has(type.id));
  if (paymentTypes.length === cached.payment_types.length) return;
  await saveCachedPaymentTypes(companyId, paymentTypes);
}

export async function invalidatePaymentTypes(companyId: number): Promise<void> {
  if (!isCacheEnabled()) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PAYMENT_TYPES_STORE, "readwrite");
    const store = tx.objectStore(PAYMENT_TYPES_STORE);
    const request = store.delete(String(companyId));
    request.onerror = () => reject(request.error ?? new Error("Failed to invalidate payment types"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to invalidate payment types"));
    };
  });
}
