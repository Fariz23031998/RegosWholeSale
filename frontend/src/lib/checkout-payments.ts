import {
  currencyLabel,
  paymentAmountFromSaleAmountCeil,
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
  return paymentAmountFromSaleAmountCeil(balanceInSaleCurrency, saleCurrency, paymentCurrency);
}

export function requiredPaymentAmountInPaymentCurrency(
  saleAmount: number,
  saleCurrency: RegosCurrencyOption | null,
  paymentCurrency: RegosCurrencyOption | null | undefined,
): number {
  if (saleAmount <= 0.009) return 0;
  if (sameCurrency(saleCurrency, paymentCurrency)) {
    return saleAmount;
  }
  return paymentAmountFromSaleAmountCeil(saleAmount, saleCurrency, paymentCurrency);
}

export function cashChangeInPaymentCurrency(
  tenderedNum: number,
  coveredSaleAmount: number,
  saleCurrency: RegosCurrencyOption | null,
  paymentCurrency: RegosCurrencyOption | null | undefined,
): number {
  if (tenderedNum <= 0) return 0;
  const required = requiredPaymentAmountInPaymentCurrency(
    coveredSaleAmount,
    saleCurrency,
    paymentCurrency,
  );
  return Math.max(0, tenderedNum - required);
}

const SPLIT_PAYMENT_ROUNDING_TOLERANCE_PER_LINE = 100;

export function splitPaymentRoundingTolerance(lineCount: number): number {
  const lines = Math.max(lineCount, 1);
  return Math.max(1, lines * SPLIT_PAYMENT_ROUNDING_TOLERANCE_PER_LINE);
}

export function isSplitPaymentSettled(
  paidInSaleCurrency: number,
  total: number,
  lineCount: number,
): boolean {
  if (paidInSaleCurrency <= 0.009) return false;
  const tolerance = splitPaymentRoundingTolerance(lineCount);
  return (
    paidInSaleCurrency >= total - tolerance &&
    paidInSaleCurrency <= total + tolerance
  );
}

export function canSubmitSplitPayment(
  paidInSaleCurrency: number,
  total: number,
  lineCount: number,
): boolean {
  if (paidInSaleCurrency <= 0.009) return false;
  return paidInSaleCurrency <= total + splitPaymentRoundingTolerance(lineCount);
}

export type SplitPaymentLineInSaleCurrency = {
  payment_type_id: number;
  amount_paid: number;
};

export function capSplitPaymentLinesInSaleCurrency(
  lines: SplitPaymentLineInSaleCurrency[],
  total: number,
): SplitPaymentLineInSaleCurrency[] {
  const capped = lines.map((line) => ({
    ...line,
    amount_paid: Math.round(line.amount_paid * 100) / 100,
  }));
  let sum = Math.round(capped.reduce((acc, line) => acc + line.amount_paid, 0) * 100) / 100;
  if (sum <= total + 0.001) {
    return capped;
  }

  let excess = Math.round((sum - total) * 100) / 100;
  for (let i = capped.length - 1; i >= 0 && excess > 0.001; i--) {
    const reduction = Math.min(capped[i].amount_paid, excess);
    capped[i] = {
      ...capped[i],
      amount_paid: Math.round((capped[i].amount_paid - reduction) * 100) / 100,
    };
    excess = Math.round((excess - reduction) * 100) / 100;
  }
  return capped;
}

export function splitPaymentAmountPaid(
  lines: SplitPaymentLineInSaleCurrency[],
  total: number,
): number {
  const sum = Math.round(lines.reduce((acc, line) => acc + line.amount_paid, 0) * 100) / 100;
  return Math.min(sum, total);
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
