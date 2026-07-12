import type { CatalogProductsResponse, Product, ProductGroup } from "@/types/catalog";
import type { CatalogSort } from "@/lib/catalog-sort";
import { prioritizeCatalogProductsByCode, isShortNumericCodeSearch } from "@/lib/catalog-search";
import {
  buildProductSearchIndex,
  scoreCatalogMatch,
} from "@/lib/catalog-text-search";

export type CatalogQuery = {
  offset?: number;
  limit?: number;
  search?: string;
  groupId?: number | null;
  featuredOnly?: boolean;
  /** Regos item IDs for the Featured category; required when featuredOnly is true. */
  featuredProductIds?: number[];
  warehouseId?: number;
  priceTypeId?: number;
  sort?: CatalogSort;
  includeZeroQuantity?: boolean;
  includeZeroPrice?: boolean;
};
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
  /** Precomputed Latin+Cyrillic search blob; missing on legacy IDB rows. */
  searchIndex?: string;
};

export type ProductSearchEntry = {
  product: Product;
  searchIndex: string;
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
  return product.barcode != null ? String(product.barcode).trim() : "";
}

function productCode(product: Product): string {
  const code = product.code != null ? String(product.code).trim() : "";
  const sku = product.sku != null ? String(product.sku).trim() : "";
  return code || sku || "";
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

function getProductBarcodes(product: Product): string[] {
  const list = product.barcode_list != null ? String(product.barcode_list).trim() : "";
  if (list) {
    return list.split(",")
      .map(b => b.trim())
      .filter(Boolean);
  }
  const main = productBarcode(product);
  return main ? [main] : [];
}

export async function upsertProducts(scopeKey: string, products: Product[]): Promise<void> {
  if (products.length === 0) return;
  const db = await openDb();
  const fetchedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_PRODUCTS_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_PRODUCTS_STORE);
    for (const product of products) {
      const searchIndex = buildProductSearchIndex(product);
      // 1. Save the canonical record
      const canonicalRecord: CachedProductRecord = {
        key: buildCatalogProductKey(scopeKey, product.id),
        scopeKey,
        product,
        fetchedAt,
        barcode: productBarcode(product),
        code: productCode(product),
        searchIndex,
      };
      store.put(canonicalRecord);

      // 2. Save separate records for each barcode in barcode_list
      const barcodes = getProductBarcodes(product);
      for (const barcode of barcodes) {
        if (!barcode) continue;
        const barcodeRecord: CachedProductRecord = {
          key: `${scopeKey}:${product.id}:${barcode}`,
          scopeKey,
          product,
          fetchedAt,
          barcode,
          code: productCode(product),
          searchIndex,
        };
        store.put(barcodeRecord);
      }
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
      const canonicalKey = buildCatalogProductKey(scopeKey, productId);
      store.delete(canonicalKey);

      // Delete all barcode-specific entries
      const prefix = `${canonicalKey}:`;
      const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
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

export async function clearCachedPagesForScope(scopeKey: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_PAGES_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_PAGES_STORE);
    const prefix = `${scopeKey}:`;
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const key = String(cursor.key);
      if (key.startsWith(prefix)) {
        store.delete(cursor.primaryKey);
      }
      cursor.continue();
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to clear cached pages"));
    };
  });
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

export async function getCachedProductEntriesByScope(
  scopeKey: string,
): Promise<ProductSearchEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_PRODUCTS_STORE, "readonly");
    const store = tx.objectStore(CATALOG_PRODUCTS_STORE);
    const index = store.index("scopeKey");
    const request = index.openCursor(IDBKeyRange.only(scopeKey));
    const results: ProductSearchEntry[] = [];
    const seenIds = new Set<string>();
    request.onerror = () => reject(request.error ?? new Error("Failed to load cached products"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(results);
        return;
      }
      const record = cursor.value as CachedProductRecord;
      if (record && record.product && record.product.id) {
        if (!seenIds.has(record.product.id)) {
          seenIds.add(record.product.id);
          results.push({
            product: record.product,
            searchIndex: record.searchIndex ?? buildProductSearchIndex(record.product),
          });
        }
      }
      cursor.continue();
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load cached products"));
    };
  });
}

export async function getCachedProductsByScope(scopeKey: string): Promise<Product[]> {
  const entries = await getCachedProductEntriesByScope(scopeKey);
  return entries.map((entry) => entry.product);
}

function productRegosItemId(product: Product): number | null {
  if (typeof product.regos_item_id === "number" && product.regos_item_id > 0) {
    return product.regos_item_id;
  }
  const parsed = Number(product.id);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveSearchIndex(
  product: Product,
  searchIndexes?: ReadonlyMap<string, string>,
): string {
  return searchIndexes?.get(product.id) ?? buildProductSearchIndex(product);
}

export function filterAndSortCachedProducts(
  products: Product[],
  query: CatalogQuery,
  searchIndexes?: ReadonlyMap<string, string>,
): CatalogProductsResponse {
  let filtered = [...products];

  // 1. Featured filtering — never fall through to the full catalog
  if (query.featuredOnly) {
    const featuredIds = new Set(
      (query.featuredProductIds ?? []).filter((id) => Number.isFinite(id) && id > 0),
    );
    if (featuredIds.size === 0) {
      return { products: [], next_offset: query.offset ?? 0, total: 0 };
    }
    filtered = filtered.filter((p) => {
      const id = productRegosItemId(p);
      return id != null && featuredIds.has(id);
    });
  }

  // 2. Group filtering
  if (query.groupId) {
    filtered = filtered.filter((p) => p.group_id === query.groupId);
  }

  // 3. Zero quantity / zero price filtering (defaults match server: exclude unless explicitly included)
  const includeZeroQuantity = query.includeZeroQuantity === true;
  const includeZeroPrice = query.includeZeroPrice === true;
  if (!includeZeroQuantity || !includeZeroPrice) {
    filtered = filtered.filter((p) => {
      if (!includeZeroQuantity && (p.stock ?? 0) <= 0) return false;
      if (!includeZeroPrice && (p.price ?? 0) <= 0) return false;
      return true;
    });
  }

  // 4. Search filtering (transliteration + similarity scoring)
  const searchTerm = query.search?.trim() ?? "";
  const scores = new Map<string, number>();
  if (searchTerm) {
    const matched: Product[] = [];
    for (const product of filtered) {
      const index = resolveSearchIndex(product, searchIndexes);
      const score = scoreCatalogMatch(searchTerm, index, product);
      if (score == null) continue;
      scores.set(product.id, score);
      matched.push(product);
    }
    filtered = matched;
  }

  // 5. Sorting
  const sort = query.sort;
  if (searchTerm && scores.size > 0) {
    filtered.sort((a, b) => {
      const scoreDiff = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (a.name || "").localeCompare(b.name || "", undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  } else if (sort) {
    filtered.sort((a, b) => {
      let valA = "";
      let valB = "";
      if (sort.column === "name") {
        valA = a.name || "";
        valB = b.name || "";
      } else if (sort.column === "articul") {
        valA = a.articul || a.sku || "";
        valB = b.articul || b.sku || "";
      } else if (sort.column === "code") {
        valA = a.code || "";
        valB = b.code || "";
      }

      const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: "base" });
      return sort.direction === "asc" ? cmp : -cmp;
    });
  } else if (query.featuredOnly && query.featuredProductIds?.length) {
    // Keep the user's featured order when no explicit sort is selected
    const order = new Map(query.featuredProductIds.map((id, index) => [id, index]));
    filtered.sort((a, b) => {
      const aId = productRegosItemId(a) ?? 0;
      const bId = productRegosItemId(b) ?? 0;
      return (order.get(aId) ?? 0) - (order.get(bId) ?? 0);
    });
  } else {
    // Default sorting by name asc
    filtered.sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }

  // Short numeric queries are usually product codes — promote exact code matches
  // before pagination so they are not buried behind barcode/name noise.
  if (searchTerm && isShortNumericCodeSearch(searchTerm)) {
    filtered = prioritizeCatalogProductsByCode(filtered, searchTerm);
  }

  // 6. Pagination
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 60;
  const sliced = filtered.slice(offset, offset + limit);

  return {
    products: sliced,
    next_offset: offset + sliced.length,
    total: filtered.length,
  };
}
