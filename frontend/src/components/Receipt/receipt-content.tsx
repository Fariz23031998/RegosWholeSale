import type { Sale } from "@/data/seed";
import { currencyLabel } from "@/lib/currency-conversion";
import { formatCurrency } from "@/lib/format";

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
