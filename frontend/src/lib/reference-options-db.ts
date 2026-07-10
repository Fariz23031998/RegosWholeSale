import { REFERENCE_OPTIONS_STORE, openPulsePosDb } from "@/lib/pulse-pos-db";
import type { RegosDefaultOption, RegosPriceTypeOption } from "@/types/settings";

export type CachedReferenceOptions = {
  warehouses: RegosDefaultOption[];
  price_types: RegosPriceTypeOption[];
  partners: RegosDefaultOption[];
  fetchedAt: number;
};

export type ReferenceOptionsPatch = Partial<
  Pick<CachedReferenceOptions, "warehouses" | "price_types" | "partners">
>;

export function mergeReferenceOptionsCache(
  existing: CachedReferenceOptions | null,
  patch: ReferenceOptionsPatch,
): CachedReferenceOptions {
  return {
    warehouses: patch.warehouses ?? existing?.warehouses ?? [],
    price_types: patch.price_types ?? existing?.price_types ?? [],
    partners: patch.partners ?? existing?.partners ?? [],
    fetchedAt: Date.now(),
  };
}

async function openDb(): Promise<IDBDatabase> {
  return openPulsePosDb();
}

export async function loadCachedReferenceOptions(
  companyId: number,
): Promise<CachedReferenceOptions | null> {
  const db = await openDb();
  const key = String(companyId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REFERENCE_OPTIONS_STORE, "readonly");
    const store = tx.objectStore(REFERENCE_OPTIONS_STORE);
    const request = store.get(key);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to load cached reference options"));
    request.onsuccess = () => {
      resolve((request.result as CachedReferenceOptions | undefined) ?? null);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load cached reference options"));
    };
  });
}

export async function saveCachedReferenceOptions(
  companyId: number,
  data: ReferenceOptionsPatch | CachedReferenceOptions,
): Promise<void> {
  const existing = await loadCachedReferenceOptions(companyId).catch(() => null);
  const record = mergeReferenceOptionsCache(existing, data);
  const db = await openDb();
  const key = String(companyId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REFERENCE_OPTIONS_STORE, "readwrite");
    const store = tx.objectStore(REFERENCE_OPTIONS_STORE);
    const request = store.put(record, key);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to save cached reference options"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save cached reference options"));
    };
  });
}

export async function patchCachedReferenceOptions(
  companyId: number,
  patch: ReferenceOptionsPatch,
): Promise<void> {
  await saveCachedReferenceOptions(companyId, patch);
}

export async function invalidateCachedReferenceOptions(companyId: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REFERENCE_OPTIONS_STORE, "readwrite");
    const store = tx.objectStore(REFERENCE_OPTIONS_STORE);
    const request = store.delete(String(companyId));
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to invalidate cached reference options"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to invalidate cached reference options"));
    };
  });
}
