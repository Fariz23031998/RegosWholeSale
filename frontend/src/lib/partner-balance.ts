import type { PartnerBalanceRow } from "@/types/partners";
import type { RegosCurrencyOption } from "@/types/settings";
import { convertBetweenRates } from "@/lib/currency-conversion";

export type CurrencyGroup = {
  key: string;
  currency: PartnerBalanceRow["currency"];
  rows: PartnerBalanceRow[];
  debitTotal: number;
  creditTotal: number;
  closingTotal: number;
};

/**
 * Partner debt for a currency when the latest closing balance is positive
 * (partner owes the firm).
 */
export type PartnerCurrencyDebt = {
  key: string;
  currency: PartnerBalanceRow["currency"];
  currencyId: number | null;
  amount: number;
  amountBase: number;
};

/**
 * Firm debt for a currency when the latest closing balance is negative
 * (firm owes the partner). Can offset partner debt in other currencies.
 */
export type PartnerCurrencyCredit = {
  key: string;
  currency: PartnerBalanceRow["currency"];
  currencyId: number | null;
  amount: number;
  amountBase: number;
};

export type PartnerDebtSummary = {
  debts: PartnerCurrencyDebt[];
  credits: PartnerCurrencyCredit[];
  /** Sum of positive closings (partner debt) in base currency. */
  grossDebtBase: number;
  /** Sum of |negative closings| (firm debt) in base currency. */
  creditBase: number;
  /** max(0, grossDebtBase - creditBase). */
  netDebtBase: number;
  /**
   * Suggested pay amount per debt key in that debt's currency,
   * after proportionally applying firm-debt offsets.
   */
  payableByKey: Record<string, number>;
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

function resolveGroupExchangeRate(
  group: CurrencyGroup,
  knownRates: Map<number, number>,
): number {
  const fromCurrency = group.currency?.exchange_rate;
  if (typeof fromCurrency === "number" && fromCurrency > 0) {
    return fromCurrency;
  }
  const fromRow = group.rows[0]?.exchange_rate;
  if (typeof fromRow === "number" && fromRow > 0) {
    return fromRow;
  }
  const currencyId = group.currency?.id;
  if (typeof currencyId === "number") {
    const known = knownRates.get(currencyId);
    if (known != null && known > 0) return known;
  }
  return 1;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Convert an amount in `fromRate` currency into base currency (`baseRate`, usually 1).
 */
export function amountToBase(
  amount: number,
  fromRate: number | null | undefined,
  baseRate: number | null | undefined = 1,
): number {
  return roundMoney(convertBetweenRates(amount, fromRate, baseRate ?? 1));
}

/**
 * Extract partner debts from currency groups.
 * Partner debt = absolute value of the latest closing balance when it is positive.
 */
export function debtsFromCurrencyGroups(groups: CurrencyGroup[]): PartnerCurrencyDebt[] {
  return buildPartnerDebtSummary(groups).debts;
}

/**
 * Build full debt/credit summary with base-currency totals and payable amounts
 * after offsetting firm debt (negative closings) against partner debt (positive closings).
 *
 * Closing balance sign convention:
 * - positive → partner owes the firm
 * - negative → firm owes the partner
 */
export function buildPartnerDebtSummary(
  groups: CurrencyGroup[],
  options?: {
    baseCurrency?: RegosCurrencyOption | null;
    knownCurrencies?: Array<RegosCurrencyOption | null | undefined>;
  },
): PartnerDebtSummary {
  const baseRate =
    options?.baseCurrency?.exchange_rate != null && options.baseCurrency.exchange_rate > 0
      ? options.baseCurrency.exchange_rate
      : 1;

  const knownRates = new Map<number, number>();
  if (options?.baseCurrency?.id && baseRate > 0) {
    knownRates.set(options.baseCurrency.id, baseRate);
  }
  for (const currency of options?.knownCurrencies ?? []) {
    if (currency?.id && currency.exchange_rate != null && currency.exchange_rate > 0) {
      knownRates.set(currency.id, currency.exchange_rate);
    }
  }

  const debts: PartnerCurrencyDebt[] = [];
  const credits: PartnerCurrencyCredit[] = [];

  for (const group of groups) {
    const closing = toBalanceAmount(group.closingTotal);
    if (closing === 0) continue;
    const rate = resolveGroupExchangeRate(group, knownRates);
    const amount = Math.abs(closing);
    const amountBase = amountToBase(amount, rate, baseRate);
    const entry = {
      key: group.key,
      currency: group.currency
        ? {
            ...group.currency,
            exchange_rate: group.currency.exchange_rate ?? rate,
          }
        : group.currency,
      currencyId: group.currency?.id ?? null,
      amount,
      amountBase,
    };
    if (closing > 0) {
      // Partner owes the firm.
      debts.push(entry);
    } else {
      // Firm owes the partner — can offset partner debt elsewhere.
      credits.push(entry);
    }
  }

  const grossDebtBase = roundMoney(debts.reduce((sum, d) => sum + d.amountBase, 0));
  const creditBase = roundMoney(credits.reduce((sum, c) => sum + c.amountBase, 0));
  const netDebtBase = roundMoney(Math.max(0, grossDebtBase - creditBase));

  const payableByKey: Record<string, number> = {};
  if (grossDebtBase <= 0 || debts.length === 0) {
    return { debts, credits, grossDebtBase, creditBase, netDebtBase, payableByKey };
  }

  const scale = netDebtBase / grossDebtBase;
  let allocatedBase = 0;

  for (let index = 0; index < debts.length; index += 1) {
    const debt = debts[index]!;
    const rate = debt.currency?.exchange_rate ?? 1;
    let payableBase: number;
    if (index === debts.length - 1) {
      // Last line absorbs rounding remainder.
      payableBase = roundMoney(Math.max(0, netDebtBase - allocatedBase));
    } else {
      payableBase = roundMoney(debt.amountBase * scale);
      allocatedBase = roundMoney(allocatedBase + payableBase);
    }
    const payableNative = roundMoney(
      convertBetweenRates(payableBase, baseRate, rate),
    );
    payableByKey[debt.key] = Math.min(debt.amount, Math.max(0, payableNative));
  }

  return { debts, credits, grossDebtBase, creditBase, netDebtBase, payableByKey };
}
