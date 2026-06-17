import type { Product } from "@/types/catalog";

export function getProductStock(
  products: Product[],
  productId: string,
): number | undefined {
  return products.find((product) => product.id === productId)?.stock;
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
): number {
  const safeQty = Math.max(0, qty);
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
