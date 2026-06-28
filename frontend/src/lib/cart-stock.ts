import type { PostponedDocType } from "@/store/cart";
import type { PostponeDocumentType } from "@/types/settings";
import type { Product } from "@/types/catalog";

export const UNIT_TYPE_PIECE = 1;
export const UNIT_TYPE_NON_PIECE = 2;

export function isPieceUnit(unitType?: number | null): boolean {
  return unitType === UNIT_TYPE_PIECE;
}

export function allowsDecimalQty(unitType?: number | null): boolean {
  return !isPieceUnit(unitType);
}

export function normalizeCartQty(qty: number, unitType?: number | null): number {
  const safeQty = Math.max(0, qty);
  if (isPieceUnit(unitType)) return Math.round(safeQty);
  return Math.round(safeQty * 1000) / 1000;
}

export function formatCartQty(qty: number, unitType?: number | null): string {
  if (isPieceUnit(unitType)) return String(Math.round(qty));
  const rounded = normalizeCartQty(qty, unitType);
  return rounded.toFixed(3).replace(/\.?0+$/, "");
}

export type CatalogStockOptions = {
  bookedOrderContinuation?: boolean;
};

export function isBookedOrderFromPartnerContinuation(
  postponedDocType: PostponedDocType,
  postponedWholesaleDocId: number | null,
  postponeDocumentType: PostponeDocumentType,
  postponeOrderBooked: boolean,
): boolean {
  return (
    postponeDocumentType === "doc_order_from_partner" &&
    postponeOrderBooked &&
    postponedDocType === "order_from_partner" &&
    postponedWholesaleDocId != null
  );
}

/**
 * Regos already reserves stock for booked partner orders. When continuing one,
 * add the active cart line qty back for cart limit checks only — not for display.
 */
export function getBookedContinuationCartStock(
  stock: number | undefined,
  inCartQty: number,
): number | undefined {
  if (stock === undefined) return undefined;
  if (inCartQty <= 0) return stock;
  return stock + inCartQty;
}

export function getCartAvailabilityStock(
  stock: number | undefined,
  inCartQty: number,
  options?: CatalogStockOptions,
): number | undefined {
  if (options?.bookedOrderContinuation) {
    return getBookedContinuationCartStock(stock, inCartQty);
  }
  return stock;
}

export function shouldReserveStockOnPostpone(
  postponeDocumentType: PostponeDocumentType,
  postponeOrderBooked: boolean,
): boolean {
  return postponeDocumentType === "doc_order_from_partner" && postponeOrderBooked;
}

export type StockAdjustOp = {
  productId: string;
  decrement: number;
  increment: number;
};

export function computePostponeStockAdjustments(
  items: Array<{ productId: string; qty: number; postponedQty?: number }>,
  isUpdatingPostponedDoc: boolean,
): StockAdjustOp[] {
  return items.map((item) => {
    if (isUpdatingPostponedDoc && item.postponedQty != null) {
      const delta = item.qty - item.postponedQty;
      return {
        productId: item.productId,
        decrement: Math.max(0, delta),
        increment: Math.max(0, -delta),
      };
    }
    return { productId: item.productId, decrement: item.qty, increment: 0 };
  });
}

export function computeCheckoutStockAdjustments(
  items: Array<{ productId: string; qty: number; postponedQty?: number }>,
  bookedOrderContinuation: boolean,
): StockAdjustOp[] {
  if (!bookedOrderContinuation) {
    return items.map((item) => ({
      productId: item.productId,
      decrement: item.qty,
      increment: 0,
    }));
  }
  return items.map((item) => {
    const original = item.postponedQty ?? item.qty;
    const delta = item.qty - original;
    return {
      productId: item.productId,
      decrement: Math.max(0, delta),
      increment: Math.max(0, -delta),
    };
  });
}

export function applyStockAdjustments(
  adjustments: StockAdjustOp[],
  decrementStock: (productId: string, qty: number) => void,
  incrementStock: (productId: string, qty: number) => void,
): void {
  for (const { productId, decrement, increment } of adjustments) {
    if (decrement > 0) decrementStock(productId, decrement);
    if (increment > 0) incrementStock(productId, increment);
  }
}

export function getProductStock(
  products: Product[],
  productId: string,
): number | undefined {
  return products.find((product) => product.id === productId)?.stock;
}

export function getProductUnitType(
  products: Product[],
  productId: string,
): number | null | undefined {
  return products.find((product) => product.id === productId)?.unit_type;
}

export function resolveCartUnitType(
  cartUnitType: number | null | undefined,
  products: Product[],
  productId: string,
): number | null | undefined {
  if (cartUnitType != null) return cartUnitType;
  return getProductUnitType(products, productId);
}

/**
 * Maximum quantity allowed in the active cart line for a product.
 * `reservedInOtherTabs` is the sum of that product's qty in all other open sale tabs.
 * Returns null when no upper bound (unknown stock, or out-of-stock sales enabled).
 */
export function maxCartQty(
  stock: number | undefined,
  allowOutOfStock: boolean,
  reservedInOtherTabs = 0,
): number | null {
  if (stock === undefined) return null;
  if (allowOutOfStock) return null;
  const remaining = stock - reservedInOtherTabs;
  return Math.max(0, remaining);
}

export function clampCartQty(
  qty: number,
  stock: number | undefined,
  allowOutOfStock: boolean,
  unitType?: number | null,
  reservedInOtherTabs = 0,
  catalogStockOptions?: CatalogStockOptions,
  inCartQty = 0,
): number {
  const safeQty = normalizeCartQty(qty, unitType);
  const effectiveStock = getCartAvailabilityStock(stock, inCartQty, catalogStockOptions);
  const max = maxCartQty(effectiveStock, allowOutOfStock, reservedInOtherTabs);
  if (max === null) return safeQty;
  return Math.min(safeQty, max);
}

export function canAddProductToCart(
  product: Product,
  cartQty: number,
  allowOutOfStock: boolean,
  reservedInOtherTabs = 0,
  catalogStockOptions?: CatalogStockOptions,
): boolean {
  const stock = getCartAvailabilityStock(
    product.stock,
    cartQty,
    catalogStockOptions,
  );
  const max = maxCartQty(stock, allowOutOfStock, reservedInOtherTabs);
  if (max === null) return true;
  if (max <= 0) return false;
  return cartQty < max;
}

export function canIncreaseCartQty(
  productId: string,
  currentCartQty: number,
  products: Product[],
  allowOutOfStock: boolean,
  reservedInOtherTabs = 0,
  catalogStockOptions?: CatalogStockOptions,
): boolean {
  const stock = getProductStock(products, productId);
  const effectiveStock = getCartAvailabilityStock(
    stock,
    currentCartQty,
    catalogStockOptions,
  );
  const max = maxCartQty(effectiveStock, allowOutOfStock, reservedInOtherTabs);
  if (max === null) return true;
  return currentCartQty < max;
}
