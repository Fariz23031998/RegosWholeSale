/** Round money to 2 decimal places. */
export function roundMoney2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Selling price from cost and markup percent.
 * Returns null when either input is not a finite number.
 */
export function applyMarkupToCost(
  cost: number,
  markupPercent: number,
): number | null {
  if (!Number.isFinite(cost) || !Number.isFinite(markupPercent)) return null;
  return roundMoney2(cost * (1 + markupPercent / 100));
}

/** Parse a markup input string; empty/whitespace → null (no markup). */
export function parseMarkupPercent(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}
