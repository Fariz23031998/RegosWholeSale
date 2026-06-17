import { apiRequest } from "@/lib/api";
import type { CatalogGroupsResponse, CatalogProductsResponse } from "@/types/catalog";

type CatalogQuery = {
  offset?: number;
  limit?: number;
  search?: string;
  groupId?: number | null;
  featuredOnly?: boolean;
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

  return apiRequest(`/api/v1/regos/products?${params.toString()}`, { token });
}

export async function fetchProductGroups(token: string): Promise<CatalogGroupsResponse> {
  return apiRequest("/api/v1/regos/product-groups", { token });
}
