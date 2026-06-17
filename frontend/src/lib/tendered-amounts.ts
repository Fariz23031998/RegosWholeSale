export const DEFAULT_TENDERED_QUICK_AMOUNTS = [20, 50, 100];

export function parseTenderedQuickAmounts(text: string): number[] {
  const amounts = text
    .split(/[,;\s]+/)
    .map((part) => Number.parseFloat(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  return amounts.slice(0, 8);
}

export function formatTenderedQuickAmounts(amounts: number[]): string {
  return amounts.join(", ");
}
