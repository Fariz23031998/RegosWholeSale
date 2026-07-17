import { openPulsePosDb, CATALOG_PRODUCTS_STORE, buildCatalogProductKey } from "@/lib/pulse-pos-db";
import { isCacheEnabled } from "@/lib/cache-policy";
import type { Product } from "@/types/catalog";

type CachedProductRecord = {
  key: string;
  scopeKey: string;
  product: Product;
  fetchedAt: number;
  barcode: string;
  code: string;
};

export async function loadCachedProduct(
  scopeKey: string,
  productId: string,
): Promise<Product | null> {
  if (!isCacheEnabled()) return null;
  const db = await openPulsePosDb();
  const key = buildCatalogProductKey(scopeKey, productId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_PRODUCTS_STORE, "readonly");
    const store = tx.objectStore(CATALOG_PRODUCTS_STORE);
    const request = store.get(key);
    request.onerror = () => reject(request.error ?? new Error("Failed to load cached product"));
    request.onsuccess = () => {
      const record = request.result as CachedProductRecord | undefined;
      resolve(record ? record.product : null);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load cached product"));
    };
  });
}
