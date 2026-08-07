import { apiRequest } from "@/lib/api";
import type { CatalogSort } from "@/lib/catalog-sort";
import type { CatalogGroupsResponse, CatalogProductsResponse, Product } from "@/types/catalog";

type CatalogQuery = {
  offset?: number;
  limit?: number;
  search?: string;
  groupId?: number | null;
  featuredOnly?: boolean;
  warehouseId?: number;
  priceTypeId?: number;
  sort?: CatalogSort;
  includeZeroQuantity?: boolean;
  includeZeroPrice?: boolean;
};

export async function fetchCatalogProducts(
  token: string,
  query: CatalogQuery = {},
): Promise<CatalogProductsResponse> {
  const params = new URLSearchParams();
  params.set("offset", String(query.offset ?? 0));
  params.set("limit", String(query.limit ?? 60));
  if (query.search?.trim()) {
    params.set("search", query.search.trim());
  }
  if (query.groupId) {
    params.set("group_id", String(query.groupId));
  }
  if (query.featuredOnly) {
    params.set("featured_only", "true");
  }
  if (query.warehouseId) {
    params.set("warehouse_id", String(query.warehouseId));
  }
  if (query.priceTypeId) {
    params.set("price_type_id", String(query.priceTypeId));
  }
  if (query.includeZeroQuantity != null) {
    params.set("zero_quantity", query.includeZeroQuantity ? "true" : "false");
  }
  if (query.includeZeroPrice != null) {
    params.set("zero_price", query.includeZeroPrice ? "true" : "false");
  }
  if (query.sort) {
    params.set("sort_column", query.sort.column);
    params.set("sort_direction", query.sort.direction);
  }

  return apiRequest(`/api/v1/regos/products?${params.toString()}`, { token });
}

const inflightProductsByIds = new Map<string, Promise<CatalogProductsResponse>>();

export async function fetchProductsByIds(
  token: string,
  regosItemIds: number[],
  query: { warehouseId?: number; priceTypeId?: number } = {},
): Promise<CatalogProductsResponse> {
  const uniqueIds = [...new Set(regosItemIds.filter((id) => id > 0))];
  if (uniqueIds.length === 0) {
    return { products: [], next_offset: 0, total: 0 };
  }
  
  const cacheKey = `${uniqueIds.sort().join(",")}:${query.warehouseId ?? ""}:${query.priceTypeId ?? ""}`;
  const existing = inflightProductsByIds.get(cacheKey);
  if (existing) {
    return existing;
  }

  const params = new URLSearchParams();
  params.set("ids", uniqueIds.join(","));
  if (query.warehouseId) {
    params.set("warehouse_id", String(query.warehouseId));
  }
  if (query.priceTypeId) {
    params.set("price_type_id", String(query.priceTypeId));
  }
  
  const promise = apiRequest<CatalogProductsResponse>(`/api/v1/regos/products/by-ids?${params.toString()}`, { token })
    .finally(() => {
      inflightProductsByIds.delete(cacheKey);
    });

  inflightProductsByIds.set(cacheKey, promise);
  return promise;
}

export async function fetchProductGroups(token: string): Promise<CatalogGroupsResponse> {
  return apiRequest("/api/v1/regos/product-groups", { token });
}

export async function createProductGroup(
  token: string,
  body: { name: string; parent_id?: number | null },
): Promise<{ id: number }> {
  return apiRequest<{ id: number }>("/api/v1/regos/product-groups", {
    method: "POST",
    token,
    body,
  });
}

export async function updateProductGroup(
  token: string,
  groupId: number,
  body: { name?: string; parent_id?: number | null; move_parent?: boolean },
): Promise<{ row_affected: number }> {
  return apiRequest<{ row_affected: number }>(`/api/v1/regos/product-groups/${groupId}`, {
    method: "PATCH",
    token,
    body,
  });
}

export type SyncProductsResponse = {
  updated_products: Product[];
  removed_product_ids: number[];
  groups_invalidated: boolean;
  synced_at: string;
  full_sync_required: boolean;
};

export async function fetchProductSync(
  token: string,
  since: string,
  query: { warehouseId?: number; priceTypeId?: number } = {},
): Promise<SyncProductsResponse> {
  const params = new URLSearchParams();
  params.set("since", since);
  if (query.warehouseId) {
    params.set("warehouse_id", String(query.warehouseId));
  }
  if (query.priceTypeId) {
    params.set("price_type_id", String(query.priceTypeId));
  }

  return apiRequest(`/api/v1/regos/products/sync?${params.toString()}`, { token });
}

export type SyncMetaSettingsChange = {
  scope: string;
  namespace: string;
  user_id?: number | null;
};

export type SyncMetaResponse = {
  synced_at: string;
  full_sync_required: boolean;
  reference_kinds: string[];
  payment_types_invalidated: boolean;
  settings: SyncMetaSettingsChange[];
};

export async function fetchMetaSync(
  token: string,
  since: string,
): Promise<SyncMetaResponse> {
  const params = new URLSearchParams();
  params.set("since", since);
  return apiRequest(`/api/v1/regos/meta/sync?${params.toString()}`, { token });
}
