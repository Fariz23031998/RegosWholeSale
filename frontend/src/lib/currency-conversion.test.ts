import { describe, expect, it } from "vitest";
import {
  amountInSaleCurrency,
  paymentAmountFromSaleAmount,
  paymentAmountFromSaleAmountCeil,
  saleAmountFromPaymentAmount,
} from "./currency-conversion";
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

describe("amountInSaleCurrency", () => {
  it("converts from price currency into sale currency", () => {
    expect(amountInSaleCurrency(12200, uzs, usd)).toBe(1);
  });

  it("returns the original amount when currencies match", () => {
    expect(amountInSaleCurrency(500, uzs, uzs)).toBe(500);
  });
});

describe("paymentAmountFromSaleAmountCeil", () => {
  it("rounds converted payment amounts up to cover the sale total", () => {
    const saleTotal = 3_824_950;
    const rounded = paymentAmountFromSaleAmount(saleTotal, uzs, usd);
    const ceiled = paymentAmountFromSaleAmountCeil(saleTotal, uzs, usd);

    expect(rounded).toBe(313.52);
    expect(ceiled).toBeGreaterThanOrEqual(rounded);
    expect(saleAmountFromPaymentAmount(ceiled, uzs, usd)).toBeGreaterThanOrEqual(saleTotal);
  });

  it("returns the sale amount when currencies match", () => {
    expect(paymentAmountFromSaleAmountCeil(100, uzs, uzs)).toBe(100);
  });
});

describe("paymentAmountFromSaleAmountCeil coverage", () => {
  const rub: RegosCurrencyOption = {
    id: 3,
    name: "Rubl",
    code_chr: "R",
    exchange_rate: 160.53,
  };

  it("covers the sale amount after round-trip conversion", () => {
    const amount = paymentAmountFromSaleAmountCeil(776_000, uzs, rub);
    expect(saleAmountFromPaymentAmount(amount, uzs, rub)).toBeGreaterThanOrEqual(776_000);
    expect(amount).toBeGreaterThanOrEqual(paymentAmountFromSaleAmount(776_000, uzs, rub));
  });
});
