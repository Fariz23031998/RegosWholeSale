import { fetchCatalogProducts } from "@/lib/catalog-api";
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

export type BarcodeLookupFailureReason = "not_found" | "invalid_qty" | "out_of_stock";

export type BarcodeLookupResult =
  | { ok: true; product: Product; qty: number }
  | { ok: false; reason: BarcodeLookupFailureReason };

export type BarcodeLookupOptions = {
  prefixes: InternalBarcodePrefixes;
  catalogOverrides: { warehouseId?: number; priceTypeId?: number };
  allowOutOfStock: boolean;
  getInCartQty: (productId: string) => number;
  getReservedInOtherTabs: (productId: string) => number;
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

  const { prefixes, catalogOverrides, allowOutOfStock, getInCartQty, getReservedInOtherTabs } =
    options;
  const parsedInternal = parseInternalBarcode(term, prefixes);
  const fetchParams = {
    offset: 0,
    limit: CATALOG_PAGE_SIZE,
    groupId: null as number | null,
    featuredOnly: false,
    ...(Object.keys(catalogOverrides).length > 0 ? catalogOverrides : {}),
  };

  if (parsedInternal) {
    const res = await fetchCatalogProducts(token, {
      ...fetchParams,
      search: parsedInternal.productCode,
    });
    const product = findProductByCode(res.products, parsedInternal.productCode);
    if (!product) {
      return { ok: false, reason: "not_found" };
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
    );
    const qtyToAdd = clampedTotal - inCart;
    if (qtyToAdd <= 0) {
      return { ok: false, reason: "out_of_stock" };
    }

    return { ok: true, product, qty: qtyToAdd };
  }

  const res = await fetchCatalogProducts(token, {
    ...fetchParams,
    search: term,
  });
  const product = findProductByBarcode(res.products, term);
  if (
    !product ||
    !canAddProductToCart(
      product,
      getInCartQty(product.id),
      allowOutOfStock,
      getReservedInOtherTabs(product.id),
    )
  ) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, product, qty: 1 };
}
