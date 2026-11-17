import type { Product } from "@/types/catalog";
import type { SecondaryUnitMode } from "@/types/settings";
import { isPieceUnit } from "@/lib/cart-stock";

export type SelectedUnitKind = "main" | "secondary";

/** Minimal shape shared by catalog products and stock search/operation rows. */
export type SecondaryUnitCapable = {
  unit_name?: string | null;
  unit_type?: number | null;
  secondary_unit_id?: number | null;
  secondary_unit_name?: string | null;
  secondary_unit_type?: number | null;
  conversion_factor?: number | null;
};

export function productHasSecondaryUnit(
  product: SecondaryUnitCapable | Product,
): boolean {
  return Boolean(
    product.secondary_unit_id &&
      product.secondary_unit_id > 0 &&
      product.conversion_factor &&
      product.conversion_factor > 0,
  );
}

export function resolveDefaultSelectedUnit(
  mode: SecondaryUnitMode,
  product: SecondaryUnitCapable | Product,
): SelectedUnitKind {
  if (!productHasSecondaryUnit(product) || mode === "disabled") {
    return "main";
  }
  if (mode === "use_secondary") {
    return "secondary";
  }
  return "main";
}

export function shouldAskUnit(
  mode: SecondaryUnitMode,
  product: SecondaryUnitCapable | Product,
): boolean {
  return mode === "ask" && productHasSecondaryUnit(product);
}

export function unitMetaForSelection(
  product: SecondaryUnitCapable | Product,
  selectedUnit: SelectedUnitKind,
): {
  conversionFactor: number;
  selectedUnitName: string | null;
  selectedUnitType: number | null;
  unitType: number | null;
} {
  if (selectedUnit === "secondary" && productHasSecondaryUnit(product)) {
    const factor = Number(product.conversion_factor) || 1;
    return {
      conversionFactor: factor,
      selectedUnitName: product.secondary_unit_name?.trim() || null,
      selectedUnitType: product.secondary_unit_type ?? null,
      unitType: product.secondary_unit_type ?? null,
    };
  }
  return {
    conversionFactor: 1,
    selectedUnitName: product.unit_name?.trim() || null,
    selectedUnitType: product.unit_type ?? null,
    unitType: product.unit_type ?? null,
  };
}

/** Per-main-unit catalog price for the selected sell unit. */
export function resolveUnitPrice(
  product: Product,
  selectedUnit: SelectedUnitKind,
): number {
  if (
    selectedUnit === "secondary" &&
    product.secondary_price != null &&
    Number.isFinite(product.secondary_price)
  ) {
    return product.secondary_price;
  }
  return product.price;
}

export function toBaseQty(enteredQty: number, conversionFactor: number): number {
  const factor = conversionFactor > 0 ? conversionFactor : 1;
  return enteredQty * factor;
}

export function toEnteredQty(baseQty: number, conversionFactor: number): number {
  const factor = conversionFactor > 0 ? conversionFactor : 1;
  return baseQty / factor;
}

/** Per-secondary-unit money from a per-main-unit cost/price (main × factor). */
export function toDisplayUnitMoney(
  mainValue: number,
  conversionFactor: number,
): number {
  const factor = conversionFactor > 0 ? conversionFactor : 1;
  return +(mainValue * factor).toFixed(4);
}

/** Per-main-unit money from a displayed (selected-unit) cost/price (display ÷ factor). */
export function toMainUnitMoney(
  displayValue: number,
  conversionFactor: number,
): number {
  const factor = conversionFactor > 0 ? conversionFactor : 1;
  return +(displayValue / factor).toFixed(4);
}

/**
 * Max quantity in the selected (entered) unit that still fits in `maxBaseQty` main units.
 * Piece units are floored so rounding cannot push the converted base qty over stock
 * (e.g. stock 23, factor 13 → max 1 package, not 1.77→2).
 */
export function maxEnteredQty(
  maxBaseQty: number | null | undefined,
  conversionFactor: number,
  unitType?: number | null,
): number | null {
  if (maxBaseQty == null) return null;
  const factor = conversionFactor > 0 ? conversionFactor : 1;
  const raw = maxBaseQty / factor;
  if (isPieceUnit(unitType)) return Math.max(0, Math.floor(raw + 1e-9));
  return Math.round(raw * 1000) / 1000;
}
