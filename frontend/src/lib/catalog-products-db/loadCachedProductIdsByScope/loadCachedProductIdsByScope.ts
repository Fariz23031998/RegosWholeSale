import { openPulsePosDb, CATALOG_PRODUCTS_STORE } from "@/lib/pulse-pos-db";

type CachedProductRecord = {
  key: string;
  scopeKey: string;
  product: { id: string };
};

export async function loadCachedProductIdsByScope(scopeKey: string): Promise<string[]> {
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_PRODUCTS_STORE, "readonly");
    const store = tx.objectStore(CATALOG_PRODUCTS_STORE);
    const index = store.index("scopeKey");
    const request = index.openCursor(IDBKeyRange.only(scopeKey));
    const ids: string[] = [];
    request.onerror = () => reject(request.error ?? new Error("Failed to load cached product ids"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(ids);
        return;
      }
      const record = cursor.value as CachedProductRecord;
      if (record && record.product && record.product.id) {
        ids.push(record.product.id);
      }
      cursor.continue();
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load cached product ids"));
    };
  });
}
