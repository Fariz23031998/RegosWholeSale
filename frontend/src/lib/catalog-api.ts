import { apiRequest } from "@/lib/api";
import type { CatalogSort } from "@/lib/catalog-sort";
import type { CatalogGroupsResponse, CatalogProductsResponse } from "@/types/catalog";

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
  if (query.sort) {
    params.set("sort_column", query.sort.column);
    params.set("sort_direction", query.sort.direction);
  }

  return apiRequest(`/api/v1/regos/products?${params.toString()}`, { token });
}

export async function fetchProductsByIds(
  token: string,
  regosItemIds: number[],
  query: { warehouseId?: number; priceTypeId?: number } = {},
): Promise<CatalogProductsResponse> {
  const uniqueIds = [...new Set(regosItemIds.filter((id) => id > 0))];
  if (uniqueIds.length === 0) {
    return { products: [], next_offset: 0, total: 0 };
  }
  const params = new URLSearchParams();
  params.set("ids", uniqueIds.join(","));
  if (query.warehouseId) {
    params.set("warehouse_id", String(query.warehouseId));
  }
  if (query.priceTypeId) {
    params.set("price_type_id", String(query.priceTypeId));
  }
  return apiRequest(`/api/v1/regos/products/by-ids?${params.toString()}`, { token });
}

export async function fetchProductGroups(token: string): Promise<CatalogGroupsResponse> {
  return apiRequest("/api/v1/regos/product-groups", { token });
}
