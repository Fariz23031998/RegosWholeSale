import type { PartnerBalanceRow } from "@/types/partners";

export type CurrencyGroup = {
  key: string;
  currency: PartnerBalanceRow["currency"];
  rows: PartnerBalanceRow[];
  debitTotal: number;
  creditTotal: number;
  closingTotal: number;
};

export function toBalanceAmount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function compareOperationsDesc(a: PartnerBalanceRow, b: PartnerBalanceRow): number {
  if (b.date !== a.date) {
    return b.date - a.date;
  }
  return b.id - a.id;
}

export function groupRowsByCurrency(rows: PartnerBalanceRow[]): CurrencyGroup[] {
  const groups = new Map<string, CurrencyGroup>();

  for (const row of rows) {
    const currency = row.currency;
    const key = currency ? String(currency.id) : "none";
    const debit = toBalanceAmount(row.debit);
    const credit = toBalanceAmount(row.credit);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      existing.debitTotal += debit;
      existing.creditTotal += credit;
      continue;
    }
    groups.set(key, {
      key,
      currency,
      rows: [row],
      debitTotal: debit,
      creditTotal: credit,
      closingTotal: 0,
    });
  }

  for (const group of groups.values()) {
    group.rows.sort(compareOperationsDesc);
    group.closingTotal = toBalanceAmount(group.rows[0]?.end_amount);
  }

  return Array.from(groups.values()).sort((left, right) => {
    const leftRow = left.rows[0];
    const rightRow = right.rows[0];
    if (!leftRow) return 1;
    if (!rightRow) return -1;
    return compareOperationsDesc(rightRow, leftRow);
  });
}
