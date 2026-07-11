import { fetchProductsByIds } from "@/lib/catalog-api";
import { loadCachedProduct } from "@/lib/catalog-products-db/loadCachedProduct/loadCachedProduct";
import { upsertProducts } from "@/lib/catalog-products-db";
import type { Product } from "@/types/catalog";

export async function updateProductStockOnly(
  token: string,
  regosItemIds: number[],
  scopeKey: string,
  query: { warehouseId?: number; priceTypeId?: number },
  onProductsUpdated?: (products: Product[]) => void,
): Promise<void> {
  if (regosItemIds.length === 0) return;
  const fresh = await fetchProductsByIds(token, regosItemIds, query);
  const updatedProducts: Product[] = [];
  
  for (const freshProd of fresh.products) {
    const existing = await loadCachedProduct(scopeKey, freshProd.id).catch(() => null);
    if (existing) {
      updatedProducts.push({
        ...existing,
        stock: freshProd.stock,
      });
    } else {
      updatedProducts.push(freshProd);
    }
  }

  if (updatedProducts.length > 0) {
    await upsertProducts(scopeKey, updatedProducts).catch(() => undefined);
    onProductsUpdated?.(updatedProducts);
  }
}
