import { describe, expect, it } from "vitest";
import { groupRowsByCurrency, toBalanceAmount } from "./partner-balance";
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
