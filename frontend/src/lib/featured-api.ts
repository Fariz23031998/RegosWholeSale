import { apiRequest } from "@/lib/api";
import type {
  FeaturedProductMutationResponse,
  FeaturedProductsResponse,
} from "@/types/featured";

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  data: number[];
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<number[]>>();

export async function fetchFeaturedProductIds(
  token: string,
  options?: { force?: boolean },
): Promise<number[]> {
  if (!options?.force) {
    const cached = cache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const pending = inflight.get(token);
    if (pending) return pending;
  }

  const request = apiRequest<FeaturedProductsResponse>("/api/v1/me/featured-products", {
    token,
  })
    .then((res) => {
      const data = res.product_ids;
      cache.set(token, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      inflight.delete(token);
      return data;
    })
    .catch((error) => {
      inflight.delete(token);
      throw error;
    });

  inflight.set(token, request);
  return request;
}

export function invalidateFeaturedProductsCache(token?: string) {
  if (token) {
    cache.delete(token);
    inflight.delete(token);
    return;
  }
  cache.clear();
  inflight.clear();
}

export async function addFeaturedProduct(
  token: string,
  productId: number,
): Promise<FeaturedProductMutationResponse> {
  const response = await apiRequest<FeaturedProductMutationResponse>(
    `/api/v1/me/featured-products/${productId}`,
    {
      method: "PUT",
      token,
    },
  );
  invalidateFeaturedProductsCache(token);
  return response;
}

export async function removeFeaturedProduct(
  token: string,
  productId: number,
): Promise<FeaturedProductMutationResponse> {
  const response = await apiRequest<FeaturedProductMutationResponse>(
    `/api/v1/me/featured-products/${productId}`,
    {
      method: "DELETE",
      token,
    },
  );
  invalidateFeaturedProductsCache(token);
  return response;
}
