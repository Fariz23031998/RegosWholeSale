import type { Sale } from "@/data/seed";
import { useLanguage } from "@/contexts/LanguageContext";
import { currencyLabel } from "@/lib/currency-conversion";
import { formatCurrency, formatDateTime } from "@/lib/format";
import styles from "./Receipt.module.css";

function formatAmountWithCurrency(
  amount: number,
  currency: Sale["saleCurrency"],
): string {
  const label = currencyLabel(currency);
  const formatted = formatCurrency(amount);
  return label ? `${formatted} ${label}` : formatted;
}

export function ReceiptView({ sale }: { sale: Sale }) {
  const { t } = useLanguage();
  const closedWithoutPayment = (sale.amountPaid ?? 0) <= 0 && (sale.balanceDue ?? 0) > 0;
  const currenciesDiffer =
    sale.paymentCurrency != null &&
    sale.saleCurrency != null &&
    sale.paymentCurrency.id !== sale.saleCurrency.id;

  return (
    <div className={styles.receipt}>
      <div className={styles.brand}>
        <div className={styles.brandName}>Regos Optom</div>
        <div className={styles.brandSub}>123 Market Street · (555) 010-2030</div>
      </div>
      <div className={styles.meta}>
        {formatDateTime(sale.createdAt)} · #{sale.id}
        <br />
        {t("receipt.labels.cashier", "Cashier:")} {sale.cashierName}
      </div>
      <hr className={styles.divider} />
      {sale.items.map((i) => (
        <div key={i.productId} className={styles.line}>
          <div>
            <div className={styles.lineName}>{i.name}</div>
            <div className={styles.lineQty}>
              {i.qty} × {formatCurrency(i.price)}
            </div>
          </div>
          <div className={styles.lineAmt}>
            {formatCurrency(i.price * i.qty)}
          </div>
        </div>
      ))}
      <hr className={styles.divider} />
      <div className={styles.row}>
        <span>{t("receipt.labels.subtotal", "Subtotal")}</span>
        <span>{formatAmountWithCurrency(sale.subtotal, sale.saleCurrency)}</span>
      </div>
      {sale.discount > 0 && (
        <div className={styles.row}>
          <span>{t("receipt.labels.discount", "Discount")}</span>
          <span>−{formatAmountWithCurrency(sale.discount, sale.saleCurrency)}</span>
        </div>
      )}
      <div className={`${styles.row} ${styles.totalRow}`}>
        <span>{t("receipt.labels.total", "TOTAL")}</span>
        <span>{formatAmountWithCurrency(sale.total, sale.saleCurrency)}</span>
      </div>
      {closedWithoutPayment && (
        <div className={styles.closedWithoutPayment}>
          <div className={styles.closedWithoutPaymentTitle}>
            {t("receipt.closedWithoutPayment", "Closed without payment")}
          </div>
          <div className={styles.closedWithoutPaymentDebt}>
            {t("receipt.labels.customerDebt", "Customer debt is {{amount}}", {
              amount: formatAmountWithCurrency(
                sale.balanceDue ?? sale.total,
                sale.saleCurrency,
              ),
            })}
          </div>
        </div>
      )}
      {!closedWithoutPayment && (sale.balanceDue ?? 0) > 0 && (
        <>
          <div className={styles.row}>
            <span>{t("receipt.labels.paid", "Paid")}</span>
            <span>
              {sale.payments && sale.payments.length > 1
                ? formatAmountWithCurrency(sale.amountPaid ?? 0, sale.saleCurrency)
                : currenciesDiffer && sale.paymentAmount != null
                  ? formatAmountWithCurrency(sale.paymentAmount, sale.paymentCurrency)
                  : formatAmountWithCurrency(sale.amountPaid ?? 0, sale.saleCurrency)}
            </span>
          </div>
          <div className={`${styles.row} ${styles.debtRow}`}>
            <span>{t("receipt.labels.balanceDue", "Balance due")}</span>
            <span>{formatAmountWithCurrency(sale.balanceDue ?? 0, sale.saleCurrency)}</span>
          </div>
        </>
      )}
      <hr className={styles.divider} />
      {sale.payments && sale.payments.length > 1 ? (
        sale.payments.map((payment, index) => {
          const lineCurrenciesDiffer =
            payment.paymentCurrency != null &&
            sale.saleCurrency != null &&
            payment.paymentCurrency.id !== sale.saleCurrency.id;
          return (
            <div key={`${payment.paymentTypeId}-${index}`} className={styles.row}>
              <span>{payment.paymentTypeName}</span>
              <span>
                {lineCurrenciesDiffer && payment.paymentAmount != null
                  ? formatAmountWithCurrency(payment.paymentAmount, payment.paymentCurrency)
                  : formatAmountWithCurrency(payment.amountPaid, sale.saleCurrency)}
              </span>
            </div>
          );
        })
      ) : (
        <div className={styles.row}>
          <span>{t("receipt.labels.payment", "Payment")}</span>
          <span>
            {closedWithoutPayment
              ? t("receipt.labels.none", "None")
              : sale.paymentTypeName}
          </span>
        </div>
      )}
      {!closedWithoutPayment && currenciesDiffer && sale.paymentAmount != null && !sale.payments?.length && (
        <div className={styles.row}>
          <span>{t("receipt.labels.paidAmount", "Paid amount")}</span>
          <span>{formatAmountWithCurrency(sale.paymentAmount, sale.paymentCurrency)}</span>
        </div>
      )}
      {sale.isCash && !closedWithoutPayment && (
        <>
          <div className={styles.row}>
            <span>{t("receipt.labels.tendered", "Tendered")}</span>
            <span>
              {currenciesDiffer && sale.tenderedInPaymentCurrency != null
                ? formatAmountWithCurrency(
                    sale.tenderedInPaymentCurrency,
                    sale.paymentCurrency,
                  )
                : formatCurrency(sale.tendered ?? 0)}
            </span>
          </div>
          <div className={styles.row}>
            <span>{t("receipt.labels.change", "Change")}</span>
            <span>
              {currenciesDiffer && sale.changeInPaymentCurrency != null ? (
                <>
                  {formatAmountWithCurrency(sale.changeInPaymentCurrency, sale.paymentCurrency)}
                  {" · "}
                  {formatAmountWithCurrency(sale.change ?? 0, sale.saleCurrency)}
                </>
              ) : (
                formatAmountWithCurrency(sale.change ?? 0, sale.saleCurrency)
              )}
            </span>
          </div>
        </>
      )}
      <div className={styles.thanks}>
        {t("receipt.labels.thanks", "Thank you for your purchase!")}
      </div>
    </div>
  );
}
