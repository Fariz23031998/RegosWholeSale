import { SYNC_META_STORE, openPulsePosDb } from "@/lib/pulse-pos-db";

type SyncMetaRecord = {
  syncedAt: string;
};

export async function getLastSyncTime(scopeKey: string): Promise<string | null> {
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_META_STORE, "readonly");
    const store = tx.objectStore(SYNC_META_STORE);
    const request = store.get(scopeKey);
    request.onerror = () => reject(request.error ?? new Error("Failed to load sync meta"));
    request.onsuccess = () => {
      const record = request.result as SyncMetaRecord | undefined;
      resolve(record?.syncedAt ?? null);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load sync meta"));
    };
  });
}

export async function setLastSyncTime(scopeKey: string, syncedAt: string): Promise<void> {
  const db = await openPulsePosDb();
  const record: SyncMetaRecord = { syncedAt };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_META_STORE, "readwrite");
    const store = tx.objectStore(SYNC_META_STORE);
    const request = store.put(record, scopeKey);
    request.onerror = () => reject(request.error ?? new Error("Failed to save sync meta"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save sync meta"));
    };
  });
}

export async function clearSyncMeta(scopeKey?: string): Promise<void> {
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_META_STORE, "readwrite");
    const store = tx.objectStore(SYNC_META_STORE);
    const request = scopeKey ? store.delete(scopeKey) : store.clear();
    request.onerror = () => reject(request.error ?? new Error("Failed to clear sync meta"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to clear sync meta"));
    };
  });
}

export async function getSyncMetaKeysForCompany(companyId: number): Promise<string[]> {
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_META_STORE, "readonly");
    const store = tx.objectStore(SYNC_META_STORE);
    const prefix = `${companyId}:`;
    const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
    const request = store.getAllKeys(range);
    request.onerror = () => reject(request.error ?? new Error("Failed to load sync meta keys"));
    request.onsuccess = () => {
      resolve(request.result as string[]);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load sync meta keys"));
    };
  });
}

