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

export function maxCartQty(
  stock: number | undefined,
  allowOutOfStock: boolean,
): number | null {
  if (allowOutOfStock || stock === undefined) return null;
  return Math.max(0, stock);
}

export function clampCartQty(
  qty: number,
  stock: number | undefined,
  allowOutOfStock: boolean,
  unitType?: number | null,
): number {
  const safeQty = normalizeCartQty(qty, unitType);
  const max = maxCartQty(stock, allowOutOfStock);
  if (max === null) return safeQty;
  return Math.min(safeQty, max);
}

export function canAddProductToCart(
  product: Product,
  cartQty: number,
  allowOutOfStock: boolean,
): boolean {
  if (allowOutOfStock) return true;
  if (product.stock <= 0) return false;
  return cartQty < product.stock;
}

export function canIncreaseCartQty(
  productId: string,
  currentCartQty: number,
  products: Product[],
  allowOutOfStock: boolean,
): boolean {
  if (allowOutOfStock) return true;
  const stock = getProductStock(products, productId);
  if (stock === undefined || stock <= 0) return false;
  return currentCartQty < stock;
}
