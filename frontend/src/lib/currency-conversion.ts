import type { RegosCurrencyOption } from "@/types/settings";

function parseExchangeRate(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return value;
}

export function sameCurrency(
  a: RegosCurrencyOption | null | undefined,
  b: RegosCurrencyOption | null | undefined,
): boolean {
  if (!a?.id || !b?.id) return true;
  return a.id === b.id;
}

export function convertBetweenRates(
  amount: number,
  fromRate: number | null | undefined,
  toRate: number | null | undefined,
): number {
  const from = parseExchangeRate(fromRate);
  const to = parseExchangeRate(toRate);
  return Math.round((amount * from) / to * 100) / 100;
}

export function saleAmountFromPaymentAmount(
  paymentAmount: number,
  saleCurrency: RegosCurrencyOption | null | undefined,
  paymentCurrency: RegosCurrencyOption | null | undefined,
): number {
  const saleRate = parseExchangeRate(saleCurrency?.exchange_rate);
  const paymentRate = parseExchangeRate(paymentCurrency?.exchange_rate);
  return Math.round((paymentAmount * paymentRate) / saleRate * 100) / 100;
}

export function paymentAmountFromSaleAmount(
  saleAmount: number,
  saleCurrency: RegosCurrencyOption | null | undefined,
  paymentCurrency: RegosCurrencyOption | null | undefined,
): number {
  return convertBetweenRates(
    saleAmount,
    saleCurrency?.exchange_rate,
    paymentCurrency?.exchange_rate,
  );
}

export function currencyLabel(currency: RegosCurrencyOption | null | undefined): string {
  if (!currency) return "";
  return currency.code_chr?.trim() || currency.name;
}
