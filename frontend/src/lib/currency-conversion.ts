import type { RegosCurrencyOption } from "@/types/settings";

function parseExchangeRate(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return value;
}

export function currencyWithExchangeRate(
  currency: RegosCurrencyOption | null | undefined,
  knownCurrencies: Iterable<RegosCurrencyOption | null | undefined>,
): RegosCurrencyOption | null {
  if (!currency) return null;
  if (currency.exchange_rate != null && currency.exchange_rate > 0) {
    return currency;
  }
  for (const known of knownCurrencies) {
    if (
      known?.id === currency.id &&
      known.exchange_rate != null &&
      known.exchange_rate > 0
    ) {
      return { ...currency, exchange_rate: known.exchange_rate };
    }
  }
  return currency;
}

export function collectKnownCurrencies(
  ...groups: Array<Iterable<RegosCurrencyOption | null | undefined>>
): RegosCurrencyOption[] {
  const byId = new Map<number, RegosCurrencyOption>();
  for (const group of groups) {
    for (const currency of group) {
      if (
        currency?.id &&
        currency.exchange_rate != null &&
        currency.exchange_rate > 0
      ) {
        byId.set(currency.id, currency);
      }
    }
  }
  return [...byId.values()];
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

export function paymentAmountFromSaleAmountCeil(
  saleAmount: number,
  saleCurrency: RegosCurrencyOption | null | undefined,
  paymentCurrency: RegosCurrencyOption | null | undefined,
): number {
  if (sameCurrency(saleCurrency, paymentCurrency)) {
    return saleAmount;
  }
  const saleRate = parseExchangeRate(saleCurrency?.exchange_rate);
  const paymentRate = parseExchangeRate(paymentCurrency?.exchange_rate);
  let amount = Math.ceil((saleAmount * saleRate) / paymentRate * 100) / 100;
  while (
    amount < 1_000_000_000 &&
    saleAmountFromPaymentAmount(amount, saleCurrency, paymentCurrency) < saleAmount - 0.001
  ) {
    amount = Math.round((amount + 0.01) * 100) / 100;
  }
  return amount;
}

export function currencyLabel(currency: RegosCurrencyOption | null | undefined): string {
  if (!currency) return "";
  return currency.code_chr?.trim() || currency.name;
}

export function operativeOperationPrice(
  price: number,
  price2: number | null | undefined,
  _currency?: RegosCurrencyOption | null | undefined,
): number {
  return price;
}

export function listOperationPrice(
  price: number,
  price2: number | null | undefined,
  _currency?: RegosCurrencyOption | null | undefined,
): number {
  return price2 ?? price;
}
