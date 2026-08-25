import { normalizeProductCode } from "@/lib/barcode";
import type { Product } from "@/types/catalog";

export function isShortNumericCodeSearch(term: string): boolean {
  return /^\d{1,6}$/.test(term.trim());
}

export function prioritizeCatalogProductsByCode(
  products: Product[],
  term: string,
): Product[] {
  if (!isShortNumericCodeSearch(term)) return products;

  const normalizedTerm = normalizeProductCode(term);
  const matches: Product[] = [];
  const rest: Product[] = [];

  for (const product of products) {
    const normalizedCode = normalizeProductCode(product.code ?? "");
    if (normalizedCode === normalizedTerm) {
      matches.push(product);
    } else {
      rest.push(product);
    }
  }

  return [...matches, ...rest];
}
