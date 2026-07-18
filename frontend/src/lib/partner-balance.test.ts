import { describe, expect, it } from "vitest";
import {
  amountToBase,
  buildPartnerDebtSummary,
  debtsFromCurrencyGroups,
  groupRowsByCurrency,
  toBalanceAmount,
} from "./partner-balance";
import type { PartnerBalanceRow } from "@/types/partners";

function row(
  overrides: Partial<PartnerBalanceRow> & Pick<PartnerBalanceRow, "id" | "date">,
): PartnerBalanceRow {
  return {
    document_code: null,
    document_id: null,
    document_type: null,
    currency: { id: 1, name: "UZS", code_chr: "UZS", exchange_rate: 1 },
    firm: null,
    exchange_rate: null,
    currency_amount: null,
    start_amount: 0,
    debit: 0,
    credit: 0,
    end_amount: 0,
    ...overrides,
  };
}

describe("toBalanceAmount", () => {
  it("coerces numeric strings and ignores invalid values", () => {
    expect(toBalanceAmount(12.5)).toBe(12.5);
    expect(toBalanceAmount("68.44")).toBe(68.44);
    expect(toBalanceAmount("")).toBe(0);
    expect(toBalanceAmount(null)).toBe(0);
    expect(toBalanceAmount(undefined)).toBe(0);
    expect(toBalanceAmount(Number.NaN)).toBe(0);
  });
});

describe("groupRowsByCurrency", () => {
  it("sums debit and credit totals when only credit values are present", () => {
    const groups = groupRowsByCurrency([
      row({
        id: 3,
        date: 30,
        credit: 68.44,
        end_amount: -127_654_340.51,
      }),
      row({
        id: 2,
        date: 20,
        credit: 242.35,
        end_amount: -127_654_272.07,
      }),
      row({
        id: 1,
        date: 10,
        credit: 40,
        end_amount: -127_654_029.72,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.debitTotal).toBe(0);
    expect(groups[0]?.creditTotal).toBeCloseTo(350.79, 2);
    expect(groups[0]?.closingTotal).toBeCloseTo(-127_654_340.51, 2);
  });

  it("keeps totals numeric when debit values are absent from the payload", () => {
    const groups = groupRowsByCurrency([
      row({
        id: 1,
        date: 10,
        debit: undefined as unknown as number,
        credit: "68.44" as unknown as number,
        end_amount: -100,
      }),
      row({
        id: 2,
        date: 20,
        debit: undefined as unknown as number,
        credit: "242.35" as unknown as number,
        end_amount: -200,
      }),
    ]);

    expect(groups[0]?.debitTotal).toBe(0);
    expect(groups[0]?.creditTotal).toBeCloseTo(310.79, 2);
    expect(groups[0]?.closingTotal).toBe(-200);
  });

  it("sums debit totals when debit values are present", () => {
    const groups = groupRowsByCurrency([
      row({
        id: 2,
        date: 20,
        debit: 1_000,
        credit: 0,
        end_amount: 3_558,
      }),
      row({
        id: 1,
        date: 10,
        debit: 2_558,
        credit: 0,
        end_amount: 2_558,
      }),
    ]);

    expect(groups[0]?.debitTotal).toBe(3_558);
    expect(groups[0]?.creditTotal).toBe(0);
    expect(groups[0]?.closingTotal).toBe(3_558);
  });
});

describe("debtsFromCurrencyGroups", () => {
  it("returns absolute debt only for positive closing balances (partner owes firm)", () => {
    const groups = groupRowsByCurrency([
      row({
        id: 2,
        date: 20,
        currency: { id: 1, name: "UZS", code_chr: "UZS", exchange_rate: 1 },
        end_amount: 1_250_000,
      }),
      row({
        id: 1,
        date: 10,
        currency: { id: 2, name: "USD", code_chr: "USD", exchange_rate: 12600 },
        end_amount: -500,
      }),
    ]);

    const debts = debtsFromCurrencyGroups(groups);
    expect(debts).toHaveLength(1);
    expect(debts[0]?.currencyId).toBe(1);
    expect(debts[0]?.amount).toBe(1_250_000);
  });

  it("includes multiple positive currency debts", () => {
    const groups = groupRowsByCurrency([
      row({
        id: 3,
        date: 30,
        currency: { id: 1, name: "UZS", code_chr: "UZS", exchange_rate: 1 },
        end_amount: 100,
      }),
      row({
        id: 2,
        date: 20,
        currency: { id: 2, name: "USD", code_chr: "USD", exchange_rate: 12600 },
        end_amount: 50.5,
      }),
      row({
        id: 1,
        date: 10,
        currency: { id: 3, name: "EUR", code_chr: "EUR", exchange_rate: 14000 },
        end_amount: 0,
      }),
    ]);

    const debts = debtsFromCurrencyGroups(groups);
    expect(debts).toHaveLength(2);
    expect(debts.map((d) => d.currencyId).sort()).toEqual([1, 2]);
    expect(debts.find((d) => d.currencyId === 2)?.amount).toBe(50.5);
  });

  it("returns empty when all closings are non-positive", () => {
    const groups = groupRowsByCurrency([
      row({ id: 1, date: 10, end_amount: 0 }),
      row({
        id: 2,
        date: 20,
        currency: { id: 2, name: "USD", code_chr: "USD", exchange_rate: 1 },
        end_amount: -10,
      }),
    ]);
    expect(debtsFromCurrencyGroups(groups)).toEqual([]);
  });
});

describe("amountToBase", () => {
  it("converts foreign amounts using exchange rate", () => {
    expect(amountToBase(10, 12600, 1)).toBe(126_000);
    expect(amountToBase(100, 1, 1)).toBe(100);
  });
});

describe("buildPartnerDebtSummary", () => {
  const base = { id: 1, name: "UZS", code_chr: "UZS", exchange_rate: 1 };

  it("totals partner debt in base currency and offsets firm debt balances", () => {
    const groups = groupRowsByCurrency([
      row({
        id: 2,
        date: 20,
        currency: { id: 1, name: "UZS", code_chr: "UZS", exchange_rate: 1 },
        end_amount: 1_260_000,
      }),
      row({
        id: 1,
        date: 10,
        currency: { id: 2, name: "USD", code_chr: "USD", exchange_rate: 12600 },
        end_amount: -50,
      }),
    ]);

    const summary = buildPartnerDebtSummary(groups, { baseCurrency: base });
    expect(summary.debts).toHaveLength(1);
    expect(summary.credits).toHaveLength(1);
    expect(summary.grossDebtBase).toBe(1_260_000);
    expect(summary.creditBase).toBe(630_000);
    expect(summary.netDebtBase).toBe(630_000);
    expect(summary.payableByKey["1"]).toBe(630_000);
  });

  it("allocates firm-debt offset proportionally across multiple partner debts", () => {
    const groups = groupRowsByCurrency([
      row({
        id: 3,
        date: 30,
        currency: { id: 1, name: "UZS", code_chr: "UZS", exchange_rate: 1 },
        end_amount: 100_000,
      }),
      row({
        id: 2,
        date: 20,
        currency: { id: 2, name: "USD", code_chr: "USD", exchange_rate: 10_000 },
        end_amount: 10,
      }),
      row({
        id: 1,
        date: 10,
        currency: { id: 3, name: "EUR", code_chr: "EUR", exchange_rate: 12_000 },
        end_amount: -5,
      }),
    ]);

    // Partner debts: 100000 UZS + 10*10000 = 200000 base
    // Firm debt offset: 5*12000 = 60000 base → net 140000
    const summary = buildPartnerDebtSummary(groups, { baseCurrency: base });
    expect(summary.grossDebtBase).toBe(200_000);
    expect(summary.creditBase).toBe(60_000);
    expect(summary.netDebtBase).toBe(140_000);

    const uzsPayable = summary.payableByKey["1"] ?? 0;
    const usdPayable = summary.payableByKey["2"] ?? 0;
    expect(uzsPayable).toBeCloseTo(70_000, 0);
    expect(usdPayable).toBeCloseTo(7, 1);
    expect(amountToBase(uzsPayable, 1) + amountToBase(usdPayable, 10_000)).toBeCloseTo(
      140_000,
      0,
    );
  });

  it("sets net and payable to zero when firm debt covers all partner debt", () => {
    const groups = groupRowsByCurrency([
      row({
        id: 2,
        date: 20,
        currency: { id: 1, name: "UZS", code_chr: "UZS", exchange_rate: 1 },
        end_amount: 50_000,
      }),
      row({
        id: 1,
        date: 10,
        currency: { id: 2, name: "USD", code_chr: "USD", exchange_rate: 10_000 },
        end_amount: -10,
      }),
    ]);

    const summary = buildPartnerDebtSummary(groups, { baseCurrency: base });
    expect(summary.grossDebtBase).toBe(50_000);
    expect(summary.creditBase).toBe(100_000);
    expect(summary.netDebtBase).toBe(0);
    expect(summary.payableByKey["1"]).toBe(0);
  });
});
