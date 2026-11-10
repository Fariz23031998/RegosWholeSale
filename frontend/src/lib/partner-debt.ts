import type { PartnerDebtLine } from "@/types/partners";

export function visiblePartnerDebtLines(
  lines: PartnerDebtLine[] | null | undefined,
  negativeOnly: boolean,
): PartnerDebtLine[] {
  return (lines ?? []).filter((line) => {
    if (!Number.isFinite(line.amount) || line.amount === 0) return false;
    if (negativeOnly) return line.amount < 0;
    return true;
  });
}
