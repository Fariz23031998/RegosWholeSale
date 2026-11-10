import { describe, expect, it } from "vitest";
import { visiblePartnerDebtLines } from "@/lib/partner-debt";
import type { PartnerDebtLine } from "@/types/partners";

const lines: PartnerDebtLine[] = [
  {
    firm_id: 1,
    firm_name: "Tash",
    currency_id: 1,
    currency_code: "UZS",
    currency_name: "Sum",
    exchange_rate: 1,
    amount: 150000,
  },
  {
    firm_id: 1,
    firm_name: "Tash",
    currency_id: 2,
    currency_code: "USD",
    currency_name: "Dollar",
    exchange_rate: 11987,
    amount: -25.5,
  },
  {
    firm_id: 2,
    firm_name: "Sam",
    currency_id: 1,
    currency_code: "UZS",
    currency_name: "Sum",
    exchange_rate: 1,
    amount: 0,
  },
];

describe("visiblePartnerDebtLines", () => {
  it("drops zero closings and keeps both signs by default", () => {
    expect(visiblePartnerDebtLines(lines, false).map((line) => line.amount)).toEqual([
      150000, -25.5,
    ]);
  });

  it("keeps only negative closings when requested", () => {
    const visible = visiblePartnerDebtLines(lines, true);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.currency_code).toBe("USD");
    expect(visible[0]?.amount).toBe(-25.5);
  });
});
