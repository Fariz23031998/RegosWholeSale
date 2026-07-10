import type { CatalogProductsResponse, Product, ProductGroup } from "@/types/catalog";
import {
  buildCatalogProductKey,
  CATALOG_GROUPS_STORE,
  CATALOG_PAGES_STORE,
  CATALOG_PRODUCTS_STORE,
  openPulsePosDb,
} from "@/lib/pulse-pos-db";

export const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

type CachedProductRecord = {
  key: string;
  scopeKey: string;
  product: Product;
  fetchedAt: number;
  barcode: string;
  code: string;
};

type CachedPageRecord = {
  response: CatalogProductsResponse;
  fetchedAt: number;
};

type CachedGroupsRecord = {
  groups: ProductGroup[];
  fetchedAt: number;
};

function productBarcode(product: Product): string {
  return product.barcode?.trim() ?? "";
}

function productCode(product: Product): string {
  return product.code?.trim() || product.sku?.trim() || "";
}

function openDb(): Promise<IDBDatabase> {
  return openPulsePosDb();
}

export async function loadCachedPage(
  scopeKey: string,
  pageKey: string,
): Promise<CachedPageRecord | null> {
  const db = await openDb();
  const key = `${scopeKey}:${pageKey}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_PAGES_STORE, "readonly");
    const store = tx.objectStore(CATALOG_PAGES_STORE);
    const request = store.get(key);
    request.onerror = () => reject(request.error ?? new Error("Failed to load cached page"));
    request.onsuccess = () => {
      resolve((request.result as CachedPageRecord | undefined) ?? null);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load cached page"));
    };
  });
}

export async function saveCachedPage(
  scopeKey: string,
  pageKey: string,
  response: CatalogProductsResponse,
): Promise<void> {
  const db = await openDb();
  const key = `${scopeKey}:${pageKey}`;
  const record: CachedPageRecord = {
    response,
    fetchedAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_PAGES_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_PAGES_STORE);
    const request = store.put(record, key);
    request.onerror = () => reject(request.error ?? new Error("Failed to save cached page"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save cached page"));
    };
  });
}

export async function upsertProducts(scopeKey: string, products: Product[]): Promise<void> {
  if (products.length === 0) return;
  const db = await openDb();
  const fetchedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_PRODUCTS_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_PRODUCTS_STORE);
    for (const product of products) {
      const record: CachedProductRecord = {
        key: buildCatalogProductKey(scopeKey, product.id),
        scopeKey,
        product,
        fetchedAt,
        barcode: productBarcode(product),
        code: productCode(product),
      };
      store.put(record);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to upsert products"));
    };
  });
}

export async function removeProducts(scopeKey: string, productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_PRODUCTS_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_PRODUCTS_STORE);
    for (const productId of productIds) {
      store.delete(buildCatalogProductKey(scopeKey, productId));
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to remove products"));
    };
  });
}

async function findProductByIndex(
  scopeKey: string,
  indexName: "barcode" | "code",
  value: string,
): Promise<Product | null> {
  const normalized = value.trim();
  if (!normalized) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_PRODUCTS_STORE, "readonly");
    const store = tx.objectStore(CATALOG_PRODUCTS_STORE);
    const index = store.index(indexName);
    const request = index.openCursor(IDBKeyRange.only(normalized));
    let match: Product | null = null;
    request.onerror = () => reject(request.error ?? new Error("Failed to search products"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(match);
        return;
      }
      const record = cursor.value as CachedProductRecord;
      if (record.scopeKey === scopeKey) {
        match = record.product;
        resolve(match);
        return;
      }
      cursor.continue();
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to search products"));
    };
  });
}

export function findProductByBarcode(scopeKey: string, barcode: string): Promise<Product | null> {
  return findProductByIndex(scopeKey, "barcode", barcode);
}

export function findProductByCode(scopeKey: string, code: string): Promise<Product | null> {
  return findProductByIndex(scopeKey, "code", code);
}

export async function invalidateScope(scopeKey: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([CATALOG_PRODUCTS_STORE, CATALOG_PAGES_STORE], "readwrite");
    const productsStore = tx.objectStore(CATALOG_PRODUCTS_STORE);
    const pagesStore = tx.objectStore(CATALOG_PAGES_STORE);
    const productRequest = productsStore.index("scopeKey").openCursor(IDBKeyRange.only(scopeKey));
    productRequest.onsuccess = () => {
      const cursor = productRequest.result;
      if (!cursor) return;
      productsStore.delete(cursor.primaryKey as IDBValidKey);
      cursor.continue();
    };
    const pagePrefix = `${scopeKey}:`;
    const pageRequest = pagesStore.openCursor();
    pageRequest.onsuccess = () => {
      const cursor = pageRequest.result;
      if (!cursor) return;
      const key = String(cursor.key);
      if (key.startsWith(pagePrefix)) {
        pagesStore.delete(cursor.primaryKey as IDBValidKey);
      }
      cursor.continue();
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to invalidate catalog scope"));
    };
  });
}

export async function loadCachedGroups(companyId: number): Promise<CachedGroupsRecord | null> {
  const db = await openDb();
  const key = String(companyId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_GROUPS_STORE, "readonly");
    const store = tx.objectStore(CATALOG_GROUPS_STORE);
    const request = store.get(key);
    request.onerror = () => reject(request.error ?? new Error("Failed to load cached groups"));
    request.onsuccess = () => {
      resolve((request.result as CachedGroupsRecord | undefined) ?? null);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load cached groups"));
    };
  });
}

export async function saveCachedGroups(
  companyId: number,
  groups: ProductGroup[],
): Promise<void> {
  const db = await openDb();
  const key = String(companyId);
  const record: CachedGroupsRecord = {
    groups,
    fetchedAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_GROUPS_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_GROUPS_STORE);
    const request = store.put(record, key);
    request.onerror = () => reject(request.error ?? new Error("Failed to save cached groups"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save cached groups"));
    };
  });
}

export async function invalidateGroups(companyId: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_GROUPS_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_GROUPS_STORE);
    const request = store.delete(String(companyId));
    request.onerror = () => reject(request.error ?? new Error("Failed to invalidate groups"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to invalidate groups"));
    };
  });
}

export function isCacheFresh(fetchedAt: number, ttlMs: number = CATALOG_CACHE_TTL_MS): boolean {
  return Date.now() - fetchedAt < ttlMs;
}
