import { apiRequest } from "@/lib/api";
import type {
  FeaturedProductMutationResponse,
  FeaturedProductsResponse,
} from "@/types/featured";

export async function fetchFeaturedProductIds(token: string): Promise<number[]> {
  const res = await apiRequest<FeaturedProductsResponse>("/api/v1/me/featured-products", {
    token,
  });
  return res.product_ids;
}

export async function addFeaturedProduct(
  token: string,
  productId: number,
): Promise<FeaturedProductMutationResponse> {
  return apiRequest(`/api/v1/me/featured-products/${productId}`, {
    method: "PUT",
    token,
  });
}

export async function removeFeaturedProduct(
  token: string,
  productId: number,
): Promise<FeaturedProductMutationResponse> {
  return apiRequest(`/api/v1/me/featured-products/${productId}`, {
    method: "DELETE",
    token,
  });
}
