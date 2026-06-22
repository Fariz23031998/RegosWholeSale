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

export function paymentPanelLabels(mode: PaymentPanelMode) {
  if (mode === "return") {
    return {
      amountPayingNow: "Amount refunding",
      payingNow: "Refunding now",
      closeWithout: "Close without refund",
      closingWithout: "Closing without refund",
      closingWithoutProcessing: "Closing without refund…",
      noPaymentNotice: "Closing without refund",
      noPaymentDescription: "No refund will be recorded in Regos. Customer account credit will be",
      charge: "Process refund",
      processing: "Processing refund…",
      cashHint:
        "Enter the refund amount in payment currency, or leave at 0 to credit the full amount to the customer account.",
      cashHintSame:
        "Enter the refund amount now, or leave at 0 to credit the full amount to the customer account.",
      cardPrompt: "Tap Process refund to confirm",
      postingToRegos: "Posting return to Regos",
    };
  }
  return {
    amountPayingNow: "Amount paying now",
    payingNow: "Paying now",
    closeWithout: "Close without payment",
    closingWithout: "Closing without payment",
    closingWithoutProcessing: "Closing without payment…",
    noPaymentNotice: "Closing without payment",
    noPaymentDescription: "No payment will be recorded in Regos. Customer debt will be",
    charge: "Charge",
    processing: "Processing…",
    cashHint:
      "Enter the amount received in payment currency, or leave at 0 to close without payment.",
    cashHintSame: "Enter the amount received now, or leave at 0 to close without payment.",
    cardPrompt: "Tap Charge to confirm",
    postingToRegos: "Posting sale to Regos",
  };
}
