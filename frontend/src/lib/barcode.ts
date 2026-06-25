import type { Product } from "@/types/catalog";
import { UNIT_TYPE_NON_PIECE, UNIT_TYPE_PIECE } from "@/lib/cart-stock";

export const INTERNAL_BARCODE_LENGTH = 13;

export type InternalBarcodePrefixes = {
  weightPrefix: string;
  piecePrefix: string;
};

export type ParsedInternalBarcode =
  | { kind: "weight"; productCode: string; rawValue: number }
  | { kind: "piece"; productCode: string; rawValue: number };

export function isBarcodeInput(value: string): boolean {
  const trimmed = value.trim();
  return /^\d{12,}$/.test(trimmed);
}

export function normalizeProductCode(code: string): string {
  const trimmed = code.trim();
  const withoutLeading = trimmed.replace(/^0+/, "");
  return withoutLeading || "0";
}

export function parseInternalBarcode(
  value: string,
  prefixes: InternalBarcodePrefixes,
): ParsedInternalBarcode | null {
  const trimmed = value.trim();
  if (trimmed.length !== INTERNAL_BARCODE_LENGTH || !/^\d+$/.test(trimmed)) {
    return null;
  }

  const weightPrefix = prefixes.weightPrefix.trim();
  const piecePrefix = prefixes.piecePrefix.trim();

  let kind: ParsedInternalBarcode["kind"] | null = null;
  if (weightPrefix && trimmed.startsWith(weightPrefix)) {
    kind = "weight";
  } else if (piecePrefix && trimmed.startsWith(piecePrefix)) {
    kind = "piece";
  }

  if (!kind) return null;

  const prefixLen = kind === "weight" ? weightPrefix.length : piecePrefix.length;
  const remainder = trimmed.slice(prefixLen);
  if (remainder.length !== INTERNAL_BARCODE_LENGTH - prefixLen) return null;

  const productCodeRaw = remainder.slice(0, 5);
  const valueRaw = remainder.slice(5, 10);
  // remainder[10] is check digit — not validated

  const rawValue = Number.parseInt(valueRaw, 10);
  if (!Number.isFinite(rawValue) || rawValue <= 0) return null;

  return {
    kind,
    productCode: normalizeProductCode(productCodeRaw),
    rawValue,
  };
}

export function gramsToCartQty(
  grams: number,
  unitName?: string | null,
  unitType?: number | null,
): number | null {
  if (grams <= 0) return null;

  const name = (unitName ?? "").trim().toLowerCase();

  if (name.includes("kg") || name.includes("кг")) {
    return grams / 1000;
  }

  if (
    (name.includes("g") || name.includes("г")) &&
    !name.includes("kg") &&
    !name.includes("кг")
  ) {
    return grams;
  }

  if (unitType === UNIT_TYPE_NON_PIECE) {
    return grams / 1000;
  }

  if (unitType === UNIT_TYPE_PIECE) {
    return null;
  }

  return grams / 1000;
}

export function internalBarcodeToQty(
  parsed: ParsedInternalBarcode,
  product: Product,
): number | null {
  if (parsed.kind === "piece") {
    return parsed.rawValue;
  }
  return gramsToCartQty(parsed.rawValue, product.unit_name, product.unit_type);
}

export function findProductByCode(products: Product[], code: string): Product | undefined {
  const normalized = normalizeProductCode(code);
  return products.find(
    (product) => normalizeProductCode(product.code ?? "") === normalized,
  );
}

export function findProductByBarcode(
  products: Product[],
  barcode: string,
): Product | undefined {
  const trimmed = barcode.trim();
  const exact = products.find((product) => product.barcode?.trim() === trimmed);
  if (exact) return exact;
  return products[0];
}
