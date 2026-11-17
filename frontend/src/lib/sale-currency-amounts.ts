import { amountInSaleCurrency } from "@/lib/currency-conversion";
import type { RegosCurrencyOption } from "@/types/settings";

export function convertPriceAmount(
  amount: number,
  priceCurrency: RegosCurrencyOption | null | undefined,
  saleCurrency: RegosCurrencyOption | null | undefined,
): number {
  return amountInSaleCurrency(amount, priceCurrency, saleCurrency);
}

/** Convert cart totals for display / payment UI. Checkout line items stay in price-type currency. */
export function convertCartTotalsForSaleCurrency(
  totals: { subtotal: number; discount: number; total: number },
  priceCurrency: RegosCurrencyOption | null | undefined,
  saleCurrency: RegosCurrencyOption | null | undefined,
): { subtotal: number; discount: number; total: number } {
  return {
    subtotal: convertPriceAmount(totals.subtotal, priceCurrency, saleCurrency),
    discount: convertPriceAmount(totals.discount, priceCurrency, saleCurrency),
    total: convertPriceAmount(totals.total, priceCurrency, saleCurrency),
  };
}
