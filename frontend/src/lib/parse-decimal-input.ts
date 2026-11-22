/**
 * Parse a user-entered decimal string.
 * Accepts both `,` and `.` as the decimal separator (first comma only).
 * Empty / whitespace → null; invalid → null.
 */
export function parseDecimalInput(raw: string): number | null {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
