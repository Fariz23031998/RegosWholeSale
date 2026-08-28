import { loadCatalogProducts, type CatalogScope } from "@/lib/catalog-service";
import {
  findProductByBarcode as findCachedProductByBarcode,
  findProductByCode as findCachedProductByCode,
} from "./catalog-products-db";
import { canAddProductToCart, clampCartQty } from "@/lib/cart-stock";
import { CATALOG_PAGE_SIZE } from "@/lib/catalog-pagination";
import {
  findProductByBarcode,
  findProductByCode,
  internalBarcodeToQty,
  parseInternalBarcode,
  type InternalBarcodePrefixes,
} from "@/lib/barcode";
import type { Product } from "@/types/catalog";

export type BarcodeLookupFailureReason = "not_found" | "invalid_qty" | "out_of_stock" | "out_of_scope";

export type BarcodeLookupResult =
  | { ok: true; product: Product; qty: number }
  | { ok: false; reason: BarcodeLookupFailureReason };

export type BarcodeLookupOptions = {
  prefixes: InternalBarcodePrefixes;
  catalogOverrides: { warehouseId?: number; priceTypeId?: number };
  scopeKey?: string;
  /** Used to route the cache-miss fallback search through loadCatalogProducts (cache-first, no direct Regos call when caching is enabled). */
  scope: CatalogScope;
  allowOutOfStock: boolean;
  bookedOrderContinuation?: boolean;
  getInCartQty: (productId: string) => number;
  getReservedInOtherTabs: (productId: string) => number;
  allowedGroupIds?: number[];
};

export async function lookupProductForBarcode(
  token: string,
  barcode: string,
  options: BarcodeLookupOptions,
): Promise<BarcodeLookupResult> {
  const term = barcode.trim();
  if (!term) {
    return { ok: false, reason: "not_found" };
  }

  const {
    prefixes,
    catalogOverrides,
    scopeKey,
    scope,
    allowOutOfStock,
    bookedOrderContinuation = false,
    getInCartQty,
    getReservedInOtherTabs,
    allowedGroupIds,
  } = options;
  const allowedGroupIdSet =
    allowedGroupIds && allowedGroupIds.length > 0 ? new Set(allowedGroupIds) : null;
  const productInScope = (item: Product) =>
    allowedGroupIdSet == null || (item.group_id != null && allowedGroupIdSet.has(item.group_id));
  const catalogStockOptions = bookedOrderContinuation
    ? { bookedOrderContinuation: true as const }
    : undefined;
  const parsedInternal = parseInternalBarcode(term, prefixes);
  const fetchParams = {
    offset: 0,
    limit: CATALOG_PAGE_SIZE,
    groupId: null as number | null,
    featuredOnly: false,
    allowedGroupIds,
    ...(Object.keys(catalogOverrides).length > 0 ? catalogOverrides : {}),
  };

  if (parsedInternal) {
    let product: Product | null | undefined =
      scopeKey != null
        ? await findCachedProductByCode(scopeKey, parsedInternal.productCode)
        : null;
    if (!product) {
      const res = await loadCatalogProducts(
        token,
        { ...fetchParams, search: parsedInternal.productCode },
        scope,
      );
      product = findProductByCode(res.products, parsedInternal.productCode);
    }
    if (!product) {
      return { ok: false, reason: "not_found" };
    }
    if (!productInScope(product)) {
      return { ok: false, reason: "out_of_scope" };
    }

    const barcodeQty = internalBarcodeToQty(parsedInternal, product);
    if (barcodeQty == null || barcodeQty <= 0) {
      return { ok: false, reason: "invalid_qty" };
    }

    const inCart = getInCartQty(product.id);
    const reservedInOtherTabs = getReservedInOtherTabs(product.id);
    const clampedTotal = clampCartQty(
      inCart + barcodeQty,
      product.stock,
      allowOutOfStock,
      product.unit_type,
      reservedInOtherTabs,
      catalogStockOptions,
      inCart,
    );
    const qtyToAdd = clampedTotal - inCart;
    if (qtyToAdd <= 0) {
      return { ok: false, reason: "out_of_stock" };
    }

    return { ok: true, product, qty: qtyToAdd };
  }

  let product: Product | null | undefined =
    scopeKey != null ? await findCachedProductByBarcode(scopeKey, term) : null;
  if (!product) {
    const res = await loadCatalogProducts(token, { ...fetchParams, search: term }, scope);
    product = findProductByBarcode(res.products, term);
  }
  if (!product) {
    return { ok: false, reason: "not_found" };
  }
  if (!productInScope(product)) {
    return { ok: false, reason: "out_of_scope" };
  }
  if (
    !canAddProductToCart(
      product,
      getInCartQty(product.id),
      allowOutOfStock,
      getReservedInOtherTabs(product.id),
      catalogStockOptions,
    )
  ) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, product, qty: 1 };
}
