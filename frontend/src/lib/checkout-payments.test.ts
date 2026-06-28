import { describe, expect, it } from "vitest";
import {
  canSubmitSplitPayment,
  capSplitPaymentLinesInSaleCurrency,
  cashChangeInPaymentCurrency,
  isSplitPaymentSettled,
  paymentLineAmountInSaleCurrency,
  remainingBalanceInPaymentCurrency,
  requiredPaymentAmountInPaymentCurrency,
  splitPaymentAmountPaid,
} from "./checkout-payments";
import type { RegosCurrencyOption } from "@/types/settings";

const uzs: RegosCurrencyOption = {
  id: 1,
  name: "UZS",
  code_chr: "UZS",
  exchange_rate: 1,
};

const usd: RegosCurrencyOption = {
  id: 2,
  name: "USD",
  code_chr: "USD",
  exchange_rate: 12200,
};

const rub: RegosCurrencyOption = {
  id: 3,
  name: "Rubl",
  code_chr: "R",
  exchange_rate: 160.53,
};

describe("cross-currency checkout helpers", () => {
  const saleTotal = 3_824_950;

  it("uses ceiled payment amounts for exact single payments", () => {
    const exact = requiredPaymentAmountInPaymentCurrency(saleTotal, uzs, usd);
    expect(exact).toBe(313.53);
  });

  it("rounds split remaining balances up enough to cover the sale amount", () => {
    const remaining = remainingBalanceInPaymentCurrency(776_000, uzs, rub);
    const paidInSale = paymentLineAmountInSaleCurrency(remaining, rub, uzs);
    expect(paidInSale).toBeGreaterThanOrEqual(776_000);
  });

  it("returns no change when tendered matches the ceiled exact amount", () => {
    const exact = requiredPaymentAmountInPaymentCurrency(saleTotal, uzs, usd);
    expect(cashChangeInPaymentCurrency(exact, saleTotal, uzs, usd)).toBe(0);
  });

  it("returns change when tendered exceeds the required payment amount", () => {
    const exact = requiredPaymentAmountInPaymentCurrency(saleTotal, uzs, usd);
    expect(cashChangeInPaymentCurrency(exact + 1, saleTotal, uzs, usd)).toBe(1);
  });
});

describe("split payment rounding", () => {
  it("allows charging when converted lines slightly exceed the total", () => {
    expect(canSubmitSplitPayment(1_020_000.04, 1_020_000, 2)).toBe(true);
    expect(canSubmitSplitPayment(1_452_000.27, 1_452_000, 2)).toBe(true);
    expect(canSubmitSplitPayment(1_452_002, 1_452_000, 2)).toBe(false);
  });

  it("treats tiny conversion drift as settled", () => {
    expect(isSplitPaymentSettled(1_020_000.04, 1_020_000, 2)).toBe(true);
    expect(isSplitPaymentSettled(1_452_000.27, 1_452_000, 2)).toBe(true);
    expect(isSplitPaymentSettled(1_019_998.81, 1_020_000, 2)).toBe(false);
  });

  it("caps split payment lines before posting to the backend", () => {
    const capped = capSplitPaymentLinesInSaleCurrency(
      [
        { payment_type_id: 1, amount_paid: 610_000 },
        { payment_type_id: 2, amount_paid: 410_000.04 },
      ],
      1_020_000,
    );
    expect(capped[1].amount_paid).toBe(410_000);
    expect(splitPaymentAmountPaid(capped, 1_020_000)).toBe(1_020_000);
  });
});
