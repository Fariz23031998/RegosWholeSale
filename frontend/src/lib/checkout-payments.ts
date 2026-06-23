import {
  currencyLabel,
  paymentAmountFromSaleAmount,
  saleAmountFromPaymentAmount,
  sameCurrency,
} from "@/lib/currency-conversion";
import { formatCurrency } from "@/lib/format";
import type { PaymentType } from "@/types/payment";
import type { RegosCurrencyOption } from "@/types/settings";

export type PaymentTotals = { total: number };

export function resolveAmountPaid(
  paymentType: PaymentType,
  totals: PaymentTotals,
  tenderedNum: number,
  debtAmount: number,
  saleCurrency: RegosCurrencyOption | null,
  paymentCurrency: RegosCurrencyOption | null | undefined,
): number {
  const convertInput = (paymentAmount: number) => {
    if (sameCurrency(saleCurrency, paymentCurrency)) {
      return paymentAmount;
    }
    return saleAmountFromPaymentAmount(paymentAmount, saleCurrency, paymentCurrency);
  };

  if (paymentType.is_cash) {
    const paidInSale = convertInput(tenderedNum);
    return Math.min(Math.max(paidInSale, 0), totals.total);
  }
  if (paymentType.allows_debt) {
    const paidInSale = convertInput(debtAmount);
    return Math.min(Math.max(paidInSale, 0), totals.total);
  }
  return totals.total;
}

export function formatAmountWithCurrency(
  amount: number,
  currency: RegosCurrencyOption | null | undefined,
): string {
  const label = currencyLabel(currency);
  const formatted = formatCurrency(amount);
  return label ? `${formatted} ${label}` : formatted;
}

export function isClosingWithoutPayment(amountPaid: number): boolean {
  return amountPaid <= 0.009;
}

export function paymentLineAmountInSaleCurrency(
  amountInPaymentCurrency: number,
  paymentCurrency: RegosCurrencyOption | null | undefined,
  saleCurrency: RegosCurrencyOption | null,
): number {
  if (sameCurrency(saleCurrency, paymentCurrency)) {
    return amountInPaymentCurrency;
  }
  return saleAmountFromPaymentAmount(amountInPaymentCurrency, saleCurrency, paymentCurrency);
}

export function remainingBalanceInPaymentCurrency(
  balanceInSaleCurrency: number,
  saleCurrency: RegosCurrencyOption | null,
  paymentCurrency: RegosCurrencyOption | null | undefined,
): number {
  if (balanceInSaleCurrency <= 0.009) return 0;
  if (sameCurrency(saleCurrency, paymentCurrency)) {
    return balanceInSaleCurrency;
  }
  return paymentAmountFromSaleAmount(balanceInSaleCurrency, saleCurrency, paymentCurrency);
}

export type PaymentPanelMode = "sale" | "return";

type TranslateFn = (
  key: string,
  fallback?: string,
  params?: Record<string, string | number>,
) => string;

export function paymentPanelLabels(mode: PaymentPanelMode, t: TranslateFn) {
  const prefix = mode === "return" ? "checkout.labels.return" : "checkout.labels.sale";
  return {
    amountPayingNow: t(`${prefix}.amountPayingNow`, mode === "return" ? "Amount refunding" : "Amount paying now"),
    payingNow: t(`${prefix}.payingNow`, mode === "return" ? "Refunding now" : "Paying now"),
    closeWithout: t(`${prefix}.closeWithout`, mode === "return" ? "Close without refund" : "Close without payment"),
    closingWithout: t(`${prefix}.closingWithout`, mode === "return" ? "Closing without refund" : "Closing without payment"),
    closingWithoutProcessing: t(
      `${prefix}.closingWithoutProcessing`,
      mode === "return" ? "Closing without refund…" : "Closing without payment…",
    ),
    noPaymentNotice: t(`${prefix}.noPaymentNotice`, mode === "return" ? "Closing without refund" : "Closing without payment"),
    noPaymentDescription: t(
      `${prefix}.noPaymentDescription`,
      mode === "return"
        ? "No refund will be recorded in Regos. Customer account credit will be"
        : "No payment will be recorded in Regos. Customer debt will be",
    ),
    charge: t(`${prefix}.charge`, mode === "return" ? "Process refund" : "Charge"),
    processing: t(`${prefix}.processing`, mode === "return" ? "Processing refund…" : "Processing…"),
    cashHint: t(
      `${prefix}.cashHint`,
      mode === "return"
        ? "Enter the refund amount in payment currency, or leave at 0 to credit the full amount to the customer account."
        : "Enter the amount received in payment currency, or leave at 0 to close without payment.",
    ),
    cashHintSame: t(
      `${prefix}.cashHintSame`,
      mode === "return"
        ? "Enter the refund amount now, or leave at 0 to credit the full amount to the customer account."
        : "Enter the amount received now, or leave at 0 to close without payment.",
    ),
    cardPrompt: t(`${prefix}.cardPrompt`, mode === "return" ? "Tap Process refund to confirm" : "Tap Charge to confirm"),
    postingToRegos: t(
      `${prefix}.postingToRegos`,
      mode === "return" ? "Posting return to Regos" : "Posting sale to Regos",
    ),
  };
}
