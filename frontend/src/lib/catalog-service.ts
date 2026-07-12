import type { CatalogSort } from "@/lib/catalog-sort";
import {
  CATALOG_CACHE_TTL_MS,
  isCacheFresh,
  loadCachedGroups,
  loadCachedPage,
  saveCachedGroups,
  saveCachedPage,
  upsertProducts,
  getCachedProductEntriesByScope,
  filterAndSortCachedProducts,
} from "./catalog-products-db";
import {
  fetchCatalogProducts,
  fetchProductGroups,
  fetchProductSync,
  fetchProductsByIds,
} from "@/lib/catalog-api";
import { buildCatalogScopeKey } from "@/lib/pulse-pos-db";
import { setLastSyncTime } from "@/lib/sync-meta-db";
import type { CatalogProductsResponse, ProductGroup } from "@/types/catalog";

type CatalogQuery = {
  offset?: number;
  limit?: number;
  search?: string;
  groupId?: number | null;
  featuredOnly?: boolean;
  featuredProductIds?: number[];
  warehouseId?: number;
  priceTypeId?: number;
  sort?: CatalogSort;
  includeZeroQuantity?: boolean;
  includeZeroPrice?: boolean;
};

type CatalogScope = {
  companyId?: number | null;
  warehouseId?: number | null;
  priceTypeId?: number | null;
};

const inflightPages = new Map<string, Promise<CatalogProductsResponse>>();
const inflightGroups = new Map<string, Promise<ProductGroup[]>>();

function scopeKeyFor(scope: CatalogScope): string {
  return buildCatalogScopeKey(scope.companyId, scope.warehouseId, scope.priceTypeId);
}

export function buildCatalogPageKey(query: CatalogQuery): string {
  const sort = query.sort;
  return [
    query.search?.trim() ?? "",
    query.groupId ?? "",
    query.featuredOnly ? "1" : "0",
    query.includeZeroQuantity ? "1" : "0",
    query.includeZeroPrice ? "1" : "0",
    sort ? `${sort.column}:${sort.direction}` : "",
    String(query.offset ?? 0),
    String(query.limit ?? 60),
  ].join("|");
}

export async function loadCatalogProducts(
  token: string,
  query: CatalogQuery,
  scope: CatalogScope,
  options?: { forceApi?: boolean },
): Promise<CatalogProductsResponse> {
  const scopeKey = scopeKeyFor(scope);
  const pageKey = buildCatalogPageKey(query);
  const inflightKey = `${scopeKey}:${pageKey}`;

  if (options?.forceApi) {
    const existing = inflightPages.get(inflightKey);
    if (existing) return existing;

    const request = fetchCatalogProducts(token, query)
      .then(async (response) => {
        await saveCachedPage(scopeKey, pageKey, response).catch(() => undefined);
        await upsertProducts(scopeKey, response.products).catch(() => undefined);
        return response;
      })
      .finally(() => {
        inflightPages.delete(inflightKey);
      });

    inflightPages.set(inflightKey, request);
    return request;
  }

  // Prefer filtering the full product store so zero qty/price toggles apply client-side.
  try {
    const entries = await getCachedProductEntriesByScope(scopeKey);
    if (entries.length > 0) {
      const searchIndexes = new Map(
        entries.map((entry) => [entry.product.id, entry.searchIndex]),
      );
      return filterAndSortCachedProducts(
        entries.map((entry) => entry.product),
        query,
        searchIndexes,
      );
    }
  } catch {
    // ignore
  }

  const cached = await loadCachedPage(scopeKey, pageKey).catch(() => null);
  if (cached != null) {
    return cached.response;
  }

  return { products: [], next_offset: query.offset ?? 0, total: 0 };
}

async function revalidateCatalogPage(
  token: string,
  query: CatalogQuery,
  scope: CatalogScope,
  scopeKey: string,
  pageKey: string,
): Promise<void> {
  const inflightKey = `${scopeKey}:${pageKey}:revalidate`;
  if (inflightPages.has(inflightKey)) return;

  const request = fetchCatalogProducts(token, query)
    .then(async (response) => {
      await saveCachedPage(scopeKey, pageKey, response).catch(() => undefined);
      await upsertProducts(scopeKey, response.products).catch(() => undefined);
      return response;
    })
    .finally(() => {
      inflightPages.delete(inflightKey);
    });

  inflightPages.set(inflightKey, request);
  await request.catch(() => undefined);
}

export async function loadProductGroups(
  token: string,
  companyId: number | null | undefined,
): Promise<ProductGroup[]> {
  const companyKey = String(companyId ?? 0);
  const cached = await loadCachedGroups(companyId ?? 0).catch(() => null);
  const hasFreshCache = cached != null && isCacheFresh(cached.fetchedAt, CATALOG_CACHE_TTL_MS);

  if (hasFreshCache) {
    void revalidateProductGroups(token, companyId ?? 0);
    return cached.groups;
  }

  if (cached != null) {
    void revalidateProductGroups(token, companyId ?? 0);
    return cached.groups;
  }

  const existing = inflightGroups.get(companyKey);
  if (existing) return existing;

  const request = fetchProductGroups(token)
    .then(async (response) => {
      await saveCachedGroups(companyId ?? 0, response.groups).catch(() => undefined);
      return response.groups;
    })
    .finally(() => {
      inflightGroups.delete(companyKey);
    });

  inflightGroups.set(companyKey, request);
  return request;
}

async function revalidateProductGroups(token: string, companyId: number): Promise<void> {
  const companyKey = `${companyId}:revalidate`;
  if (inflightGroups.has(companyKey)) return;

  const request = fetchProductGroups(token)
    .then(async (response) => {
      await saveCachedGroups(companyId, response.groups).catch(() => undefined);
      return response.groups;
    })
    .finally(() => {
      inflightGroups.delete(companyKey);
    });

  inflightGroups.set(companyKey, request);
  await request.catch(() => undefined);
}

export async function refreshProductsByIds(
  token: string,
  regosItemIds: number[],
  scope: CatalogScope,
  query?: Pick<CatalogQuery, "warehouseId" | "priceTypeId">,
): Promise<CatalogProductsResponse> {
  if (regosItemIds.length === 0) {
    return { products: [], next_offset: 0, total: 0 };
  }
  const response = await fetchProductsByIds(token, regosItemIds, query);
  const scopeKey = scopeKeyFor(scope);
  await upsertProducts(scopeKey, response.products).catch(() => undefined);
  return response;
}

export async function downloadCompleteCatalog(
  token: string,
  scope: CatalogScope,
): Promise<void> {
  const scopeKey = scopeKeyFor(scope);
  let offset = 0;
  const limit = 500;

  // Pre-download groups
  if (scope.companyId) {
    try {
      const groupsResponse = await fetchProductGroups(token);
      await saveCachedGroups(scope.companyId, groupsResponse.groups);
    } catch {
      // ignore groups pre-download failure
    }
  }

  // Pre-download products page by page (include zeros so client filters can toggle later)
  while (true) {
    const query = {
      offset,
      limit,
      warehouseId: scope.warehouseId ?? undefined,
      priceTypeId: scope.priceTypeId ?? undefined,
      includeZeroQuantity: true,
      includeZeroPrice: true,
    };
    const response = await fetchCatalogProducts(token, query);
    const pageKey = buildCatalogPageKey(query);

    await saveCachedPage(scopeKey, pageKey, response).catch(() => undefined);
    await upsertProducts(scopeKey, response.products).catch(() => undefined);

    if (
      !response.products.length ||
      offset + response.products.length >= response.total ||
      response.next_offset === offset
    ) {
      break;
    }
    offset = response.next_offset || (offset + limit);
  }

  // Seed watermark from server clock (epoch since → full_sync_required, but synced_at is still returned)
  try {
    const syncResponse = await fetchProductSync(token, "1970-01-01T00:00:00Z", {
      warehouseId: scope.warehouseId ?? undefined,
      priceTypeId: scope.priceTypeId ?? undefined,
    });
    await setLastSyncTime(scopeKey, syncResponse.synced_at);
  } catch {
    // Fallback if sync endpoint is unreachable — prefer missing watermark over a skewed client clock
  }
}

export { fetchProductsByIds };
