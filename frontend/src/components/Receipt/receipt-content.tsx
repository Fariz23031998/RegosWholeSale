import type { Sale } from "@/data/seed";
import { formatAmountWithWordsText, normalizeAmountInWordsLanguage } from "@/lib/amount-in-words";
import { currencyLabel } from "@/lib/currency-conversion";
import { formatCurrency } from "@/lib/format";
import type { ReceiptTemplate } from "@/types/receipt-templates";

export function formatAmountWithCurrency(
  amount: number,
  currency: Sale["saleCurrency"],
): string {
  const label = currencyLabel(currency);
  const formatted = formatCurrency(amount);
  return label ? `${formatted} ${label}` : formatted;
}

export function getSalePaymentState(sale: Sale) {
  const closedWithoutPayment =
    (sale.amountPaid ?? 0) <= 0 && (sale.balanceDue ?? 0) > 0;
  const currenciesDiffer =
    sale.paymentCurrency != null &&
    sale.saleCurrency != null &&
    sale.paymentCurrency.id !== sale.saleCurrency.id;

  return { closedWithoutPayment, currenciesDiffer };
}

export function getSaleTotalWithWords(
  template: Pick<ReceiptTemplate, "amount_in_words_language">,
  sale: Sale,
): string {
  const language = normalizeAmountInWordsLanguage(template.amount_in_words_language);
  if (!language) return "";
  return formatAmountWithWordsText(sale.total, sale.saleCurrency, language);
}
