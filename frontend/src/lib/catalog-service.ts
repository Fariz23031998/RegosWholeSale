import type { CatalogSort } from "@/lib/catalog-sort";
import {
  CATALOG_CACHE_TTL_MS,
  isCacheFresh,
  loadCachedGroups,
  loadCachedPage,
  saveCachedGroups,
  saveCachedPage,
  upsertProducts,
} from "@/lib/catalog-products-db";
import {
  fetchCatalogProducts,
  fetchProductGroups,
  fetchProductsByIds,
} from "@/lib/catalog-api";
import { buildCatalogScopeKey } from "@/lib/pulse-pos-db";
import type { CatalogProductsResponse, ProductGroup } from "@/types/catalog";

type CatalogQuery = {
  offset?: number;
  limit?: number;
  search?: string;
  groupId?: number | null;
  featuredOnly?: boolean;
  warehouseId?: number;
  priceTypeId?: number;
  sort?: CatalogSort;
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
    sort ? `${sort.column}:${sort.direction}` : "",
    String(query.offset ?? 0),
    String(query.limit ?? 60),
  ].join("|");
}

export async function loadCatalogProducts(
  token: string,
  query: CatalogQuery,
  scope: CatalogScope,
): Promise<CatalogProductsResponse> {
  const scopeKey = scopeKeyFor(scope);
  const pageKey = buildCatalogPageKey(query);
  const inflightKey = `${scopeKey}:${pageKey}`;

  const cached = await loadCachedPage(scopeKey, pageKey).catch(() => null);
  const hasFreshCache = cached != null && isCacheFresh(cached.fetchedAt, CATALOG_CACHE_TTL_MS);

  if (hasFreshCache) {
    void revalidateCatalogPage(token, query, scope, scopeKey, pageKey);
    return cached.response;
  }

  if (cached != null) {
    void revalidateCatalogPage(token, query, scope, scopeKey, pageKey);
    return cached.response;
  }

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

export { fetchProductsByIds };
