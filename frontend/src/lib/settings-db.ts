import { openPulsePosDb, SETTINGS_CACHE_STORE } from "@/lib/pulse-pos-db";

export const SETTINGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type SettingsCacheScope = {
  companyId: number;
  userId?: number;
};

export type SettingsNamespace =
  | "pos"
  | "regos-defaults"
  | "receipt-templates"
  | "exchange-rate-sync"
  | "regos-token"
  | "payment-linking"
  | "doc-payment-sale-id";

export type SettingsCacheRecord = {
  data: unknown;
  fetchedAt: number;
};

export function buildCompanySettingsKey(
  companyId: number,
  namespace: SettingsNamespace,
): string {
  return `company:${companyId}:${namespace}`;
}

export function buildEmployeeSettingsKey(
  companyId: number,
  userId: number,
  namespace: "pos" | "regos-defaults",
): string {
  return `employee:${companyId}:${userId}:${namespace}`;
}

async function openDb(): Promise<IDBDatabase> {
  return openPulsePosDb();
}

export async function loadCachedSettings(key: string): Promise<SettingsCacheRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_CACHE_STORE, "readonly");
    const store = tx.objectStore(SETTINGS_CACHE_STORE);
    const request = store.get(key);
    request.onerror = () => reject(request.error ?? new Error("Failed to load cached settings"));
    request.onsuccess = () => {
      resolve((request.result as SettingsCacheRecord | undefined) ?? null);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load cached settings"));
    };
  });
}

export async function saveCachedSettings(key: string, data: unknown): Promise<void> {
  const db = await openDb();
  const record: SettingsCacheRecord = {
    data,
    fetchedAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_CACHE_STORE, "readwrite");
    const store = tx.objectStore(SETTINGS_CACHE_STORE);
    const request = store.put(record, key);
    request.onerror = () => reject(request.error ?? new Error("Failed to save cached settings"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save cached settings"));
    };
  });
}

export async function clearCachedSettings(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_CACHE_STORE, "readwrite");
    const store = tx.objectStore(SETTINGS_CACHE_STORE);
    const request = store.delete(key);
    request.onerror = () => reject(request.error ?? new Error("Failed to clear cached settings"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to clear cached settings"));
    };
  });
}

export function isSettingsCacheFresh(
  record: SettingsCacheRecord | null,
  ttlMs: number = SETTINGS_CACHE_TTL_MS,
): boolean {
  if (!record) return false;
  return record.fetchedAt + ttlMs > Date.now();
}

export async function loadCachedSettingsData<T>(key: string): Promise<T | null> {
  const cached = await loadCachedSettings(key).catch(() => null);
  if (!cached) return null;
  return cached.data as T;
}
