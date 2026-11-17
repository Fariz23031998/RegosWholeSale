import { apiRequest } from "@/lib/api";
import { loadCachedProduct } from "@/lib/catalog-products-db/loadCachedProduct/loadCachedProduct";
import { upsertProducts } from "../../catalog-products-db";
import type { Product } from "@/types/catalog";

const inflightPriceFetches = new Map<string, Promise<{ ok: boolean; result: any[] }>>();

async function fetchPricesForTypes(
  token: string,
  regosItemIds: number[],
  priceTypeIds: number[],
): Promise<Map<string, number>> {
  const uniqueTypeIds = [...new Set(priceTypeIds.filter((id) => id > 0))];
  if (regosItemIds.length === 0 || uniqueTypeIds.length === 0) {
    return new Map();
  }

  const sortedIds = [...new Set(regosItemIds)].sort().join(",");
  const sortedTypes = [...uniqueTypeIds].sort().join(",");
  const cacheKey = `${sortedIds}:${sortedTypes}`;

  let promise = inflightPriceFetches.get(cacheKey);
  if (!promise) {
    promise = apiRequest<{ ok: boolean; result: any[] }>("/api/v1/regos/proxy/itemprice/get", {
      token,
      method: "POST",
      body: {
        item_ids: regosItemIds,
        price_type_ids: uniqueTypeIds,
      },
    }).finally(() => {
      inflightPriceFetches.delete(cacheKey);
    });
    inflightPriceFetches.set(cacheKey, promise);
  }

  const response = await promise;
  const priceMap = new Map<string, number>();
  if (!response || !response.ok || !Array.isArray(response.result)) {
    return priceMap;
  }

  for (const itemPrice of response.result) {
    if (!itemPrice || typeof itemPrice !== "object") continue;
    const itemId = Number(itemPrice.item_id);
    const val = Number(itemPrice.value);
    const ptId = Number(itemPrice.price_type?.id);
    if (!isNaN(itemId) && !isNaN(val) && !isNaN(ptId) && uniqueTypeIds.includes(ptId)) {
      priceMap.set(`${itemId}:${ptId}`, val);
    }
  }
  return priceMap;
}

export async function updateProductPriceOnly(
  token: string,
  regosItemIds: number[],
  scopeKey: string,
  query: { warehouseId?: number; priceTypeId?: number },
  onProductsUpdated?: (products: Product[]) => void,
): Promise<void> {
  if (!regosItemIds || regosItemIds.length === 0) return;

  try {
    const cachedProducts: Product[] = [];
    const secondaryTypeIds: number[] = [];
    for (const itemId of regosItemIds) {
      const existing = await loadCachedProduct(scopeKey, String(itemId)).catch(() => null);
      if (!existing) continue;
      cachedProducts.push(existing);
      if (
        existing.secondary_price_type_id != null &&
        existing.secondary_price_type_id > 0
      ) {
        secondaryTypeIds.push(existing.secondary_price_type_id);
      }
    }

    const typeIds = [
      ...(query.priceTypeId ? [query.priceTypeId] : []),
      ...secondaryTypeIds,
    ];
    const priceMap = await fetchPricesForTypes(token, regosItemIds, typeIds);

    const updatedProducts: Product[] = [];
    for (const existing of cachedProducts) {
      const itemId = existing.regos_item_id ?? Number.parseInt(existing.id, 10);
      if (!Number.isFinite(itemId)) continue;

      let next = existing;
      let changed = false;

      if (query.priceTypeId) {
        const mainPrice = priceMap.get(`${itemId}:${query.priceTypeId}`);
        if (mainPrice !== undefined && mainPrice !== existing.price) {
          next = { ...next, price: mainPrice };
          changed = true;
        }
      }

      if (
        existing.secondary_price_type_id != null &&
        existing.secondary_price_type_id > 0
      ) {
        const secondaryPrice = priceMap.get(
          `${itemId}:${existing.secondary_price_type_id}`,
        );
        if (
          secondaryPrice !== undefined &&
          secondaryPrice !== existing.secondary_price
        ) {
          next = { ...next, secondary_price: secondaryPrice };
          changed = true;
        }
      }

      if (changed) {
        updatedProducts.push(next);
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
