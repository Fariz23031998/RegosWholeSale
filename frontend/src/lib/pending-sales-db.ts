import { openPulsePosDb, PENDING_SALES_STORE } from "@/lib/pulse-pos-db";
import type { PendingSaleRecord } from "@/types/pending-sale";

const STORE_NAME = PENDING_SALES_STORE;

function openDb(): Promise<IDBDatabase> {
  return openPulsePosDb();
}

export async function listPendingSales(scopeKey: string): Promise<PendingSaleRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("scopeKey");
    const request = index.getAll(scopeKey);
    request.onerror = () => reject(request.error ?? new Error("Failed to list pending sales"));
    request.onsuccess = () => {
      const records = (request.result as PendingSaleRecord[] | undefined) ?? [];
      resolve(records.sort((a, b) => a.createdAt - b.createdAt));
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to list pending sales"));
    };
  });
}

export async function getPendingSale(localId: string): Promise<PendingSaleRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(localId);
    request.onerror = () => reject(request.error ?? new Error("Failed to get pending sale"));
    request.onsuccess = () => {
      resolve((request.result as PendingSaleRecord | undefined) ?? null);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to get pending sale"));
    };
  });
}

export async function savePendingSale(record: PendingSaleRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record);
    request.onerror = () => reject(request.error ?? new Error("Failed to save pending sale"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save pending sale"));
    };
  });
}

export async function updatePendingSale(
  localId: string,
  patch: Partial<PendingSaleRecord>,
): Promise<PendingSaleRecord | null> {
  const existing = await getPendingSale(localId);
  if (!existing) return null;
  const next = { ...existing, ...patch, localId: existing.localId };
  await savePendingSale(next);
  return next;
}

export async function deletePendingSale(localId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(localId);
    request.onerror = () => reject(request.error ?? new Error("Failed to delete pending sale"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to delete pending sale"));
    };
  });
}

export async function listSyncable(scopeKey: string): Promise<PendingSaleRecord[]> {
  const records = await listPendingSales(scopeKey);
  return records.filter((record) => record.status === "pending");
}
