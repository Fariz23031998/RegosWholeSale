import { apiRequest } from "@/lib/api";
import { loadCachedProduct } from "@/lib/catalog-products-db/loadCachedProduct/loadCachedProduct";
import { upsertProducts } from "../../catalog-products-db";
import type { Product } from "@/types/catalog";

const inflightPriceFetches = new Map<string, Promise<{ ok: boolean; result: any[] }>>();

export async function updateProductPriceOnly(
  token: string,
  regosItemIds: number[],
  scopeKey: string,
  query: { warehouseId?: number; priceTypeId?: number },
  onProductsUpdated?: (products: Product[]) => void,
): Promise<void> {
  if (!regosItemIds || regosItemIds.length === 0) return;

  const sortedIds = [...new Set(regosItemIds)].sort().join(",");
  const cacheKey = `${sortedIds}:${query.priceTypeId ?? ""}`;

  let promise = inflightPriceFetches.get(cacheKey);
  if (!promise) {
    promise = apiRequest<{ ok: boolean; result: any[] }>("/api/v1/regos/proxy/itemprice/get", {
      token,
      method: "POST",
      body: {
        item_ids: regosItemIds,
        price_type_ids: query.priceTypeId ? [query.priceTypeId] : [],
      },
    }).finally(() => {
      inflightPriceFetches.delete(cacheKey);
    });
    inflightPriceFetches.set(cacheKey, promise);
  }

  try {
    const response = await promise;


    if (!response || !response.ok || !Array.isArray(response.result)) {
      return;
    }

    const priceMap = new Map<number, number>();
    for (const itemPrice of response.result) {
      if (!itemPrice || typeof itemPrice !== "object") continue;
      const itemId = Number(itemPrice.item_id);
      const val = Number(itemPrice.value);
      const ptId = itemPrice.price_type?.id;
      if (!isNaN(itemId) && !isNaN(val)) {
        if (!query.priceTypeId || ptId === query.priceTypeId) {
          priceMap.set(itemId, val);
        }
      }
    }

    const updatedProducts: Product[] = [];
    for (const itemId of regosItemIds) {
      const price = priceMap.get(itemId);
      if (price === undefined) continue;

      const existing = await loadCachedProduct(scopeKey, String(itemId)).catch(() => null);
      if (existing) {
        updatedProducts.push({
          ...existing,
          price: price,
        });
      }
    }

    if (updatedProducts.length > 0) {
      await upsertProducts(scopeKey, updatedProducts).catch(() => undefined);
      onProductsUpdated?.(updatedProducts);
    }
  } catch (error) {
    console.error("Failed to update product prices via itemprice/get proxy:", error);
  }
}

