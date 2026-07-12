import { apiRequest } from "@/lib/api";
import { loadCachedProduct } from "@/lib/catalog-products-db/loadCachedProduct/loadCachedProduct";
import { upsertProducts } from "../../catalog-products-db";
import { mapItemToProductInfo } from "@/lib/catalog-events/mapItemToProductInfo/mapItemToProductInfo";
import type { Product } from "@/types/catalog";

const inflightInfoFetches = new Map<string, Promise<{ ok: boolean; result: any[] }>>();

export async function updateProductInfoOnly(
  token: string,
  regosItemIds: number[],
  scopeKey: string,
  onProductsUpdated?: (products: Product[]) => void,
): Promise<void> {
  if (!regosItemIds || regosItemIds.length === 0) return;

  const sortedIds = [...new Set(regosItemIds)].sort().join(",");
  const cacheKey = sortedIds;

  let promise = inflightInfoFetches.get(cacheKey);
  if (!promise) {
    promise = apiRequest<{ ok: boolean; result: any[] }>("/api/v1/regos/proxy/Item/Get", {
      token,
      method: "POST",
      body: {
        ids: regosItemIds,
        deleted_mark: false,
      },
    }).finally(() => {
      inflightInfoFetches.delete(cacheKey);
    });
    inflightInfoFetches.set(cacheKey, promise);
  }
  
  try {
    const response = await promise;


    if (!response || !response.ok || !Array.isArray(response.result)) {
      return;
    }

    const updatedProducts: Product[] = [];

    for (const item of response.result) {
      if (!item || typeof item !== "object" || !item.id) continue;
      
      const info = mapItemToProductInfo(item);
      const existing = await loadCachedProduct(scopeKey, String(item.id)).catch(() => null);
      
      if (existing) {
        updatedProducts.push({
          ...existing,
          ...info,
        } as Product);
      } else {
        updatedProducts.push({
          price: 0,
          stock: 0,
          image: "",
          ...info,
        } as Product);
      }
    }

    if (updatedProducts.length > 0) {
      await upsertProducts(scopeKey, updatedProducts).catch(() => undefined);
      onProductsUpdated?.(updatedProducts);
    }
  } catch (error) {
    console.error("Failed to update product info via Item/Get proxy:", error);
  }
}
