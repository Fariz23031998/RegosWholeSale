import { isCacheEnabled } from "@/lib/cache-policy";
import { UNIT_TYPE_PIECE } from "@/lib/cart-stock";
import {
  findProductByBarcode,
  findProductByCode,
  getCachedProductEntriesByScope,
} from "@/lib/catalog-products-db";
import { loadCatalogProducts } from "@/lib/catalog-service";
import { buildCatalogScopeKey } from "@/lib/pulse-pos-db";
import type { StockItemSearchHit } from "@/lib/stock-docs-api";
import type { Product } from "@/types/catalog";

export type StockItemCacheSearchParams = {
  term: string;
  companyId?: number | null;
  warehouseId?: number | null;
  priceTypeId?: number | null;
  limit?: number;
};

function isDigitSearch(term: string): boolean {
  return /^\d+$/.test(term);
}

export function mapProductToStockItemSearchHit(product: Product): StockItemSearchHit | null {
  const id =
    typeof product.regos_item_id === "number" && product.regos_item_id > 0
      ? product.regos_item_id
      : Number(product.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  return {
    id,
    name: product.name,
    barcode: product.barcode?.trim() ? product.barcode : null,
    code: product.code?.trim() ? product.code : null,
    articul: product.articul?.trim() ? product.articul : null,
    unit: product.unit_name?.trim() ? product.unit_name : null,
    unit_piece: product.unit_type === UNIT_TYPE_PIECE,
    vat_value: null,
    last_purchase_cost: null,
    price: Number.isFinite(product.price) ? product.price : null,
    price2: null,
    quantity_common: Number.isFinite(product.stock) ? product.stock : null,
  };
}

/**
 * Search the IndexedDB catalog for stock-doc add-line picks.
 * When cache is enabled and populated, uses the same path as the POS catalog
 * search bar (`loadCatalogProducts` → transliteration + fuzzy `scoreCatalogMatch`).
 * Returns `null` when the caller should fall back to Regos (`searchStockItems`).
 */
export async function searchStockItemsFromCache(
  params: StockItemCacheSearchParams,
): Promise<StockItemSearchHit[] | null> {
  if (!isCacheEnabled()) return null;

  const term = params.term.trim();
  if (!term) return null;

  const scope = {
    companyId: params.companyId,
    warehouseId: params.warehouseId,
    priceTypeId: params.priceTypeId,
  };
  const scopeKey = buildCatalogScopeKey(
    scope.companyId,
    scope.warehouseId,
    scope.priceTypeId,
  );
  const entries = await getCachedProductEntriesByScope(scopeKey);
  if (entries.length === 0) return null;

  const limit = params.limit ?? 20;

  // Scanner / exact code UX: prefer index hits before fuzzy ranking.
  if (isDigitSearch(term)) {
    const byBarcode = await findProductByBarcode(scopeKey, term);
    if (byBarcode) {
      const hit = mapProductToStockItemSearchHit(byBarcode);
      if (hit) return [hit];
    }
    const byCode = await findProductByCode(scopeKey, term);
    if (byCode) {
      const hit = mapProductToStockItemSearchHit(byCode);
      if (hit) return [hit];
    }
  }

  // Same as ProductCatalog search: cache-only load with translit + fuzzy scoring.
  const filtered = await loadCatalogProducts(
    "",
    {
      search: term,
      offset: 0,
      limit,
      includeZeroQuantity: true,
      includeZeroPrice: true,
    },
    scope,
  );

  const hits: StockItemSearchHit[] = [];
  for (const product of filtered.products) {
    const hit = mapProductToStockItemSearchHit(product);
    if (hit) hits.push(hit);
  }
  return hits;
}
