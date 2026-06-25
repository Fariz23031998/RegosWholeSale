import { useLanguage } from "@/contexts/LanguageContext";
import type { ReceiptPrintContext } from "@/lib/receipt-print-context";
import type { ReceiptTemplate } from "@/types/receipt-templates";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  formatAmountWithCurrency,
  getSalePaymentState,
  getSaleTotalWithWords,
} from "./receipt-content";
import { ReceiptLogos } from "./ReceiptLogos";
import styles from "./Receipt.module.css";

type Props = {
  template: ReceiptTemplate;
  context: ReceiptPrintContext;
};

export function Receipt80mmLayout({ template, context }: Props) {
  const { t } = useLanguage();
  const { sale } = context;
  const { sections, header, footer_text: footerText } = template;
  const { closedWithoutPayment, currenciesDiffer } = getSalePaymentState(sale);
  const docId = context.document_code ?? sale.id;
  const totalWithWords = getSaleTotalWithWords(template, sale);

  return (
    <div className={styles.receipt}>
      {sections.header && (
        <div className={styles.brand}>
          <ReceiptLogos logos={template.logos} variant="80mm" />
          {header.company_name && (
            <div className={styles.brandName}>{header.company_name}</div>
          )}
          {(header.address || header.phone) && (
            <div className={styles.brandSub}>
              {[header.address, header.phone].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      )}
      {sections.meta && (
        <div className={styles.meta}>
          {formatDateTime(sale.createdAt)} · #{docId}
          <br />
          {t("receipt.labels.cashier", "Cashier:")} {sale.cashierName}
          {context.stock_name ? (
            <>
              <br />
              {t("receipt.labels.warehouse", "Warehouse:")} {context.stock_name}
            </>
          ) : null}
        </div>
      )}
      {(sections.header || sections.meta) && (sections.items || sections.subtotal) && (
        <hr className={styles.divider} />
      )}
      {sections.items &&
        sale.items.map((i) => (
          <div key={i.productId} className={styles.line}>
            <div>
              <div className={styles.lineName}>{i.name}</div>
              <div className={styles.lineQty}>
                {i.qty} × {formatCurrency(i.price)}
              </div>
            </div>
            <div className={styles.lineAmt}>{formatCurrency(i.price * i.qty)}</div>
          </div>
        ))}
      {(sections.subtotal || sections.discount || sections.total) && (
        <hr className={styles.divider} />
      )}
      {sections.subtotal && (
        <div className={styles.row}>
          <span>{t("receipt.labels.subtotal", "Subtotal")}</span>
          <span>{formatAmountWithCurrency(sale.subtotal, sale.saleCurrency)}</span>
        </div>
      )}
      {sections.discount && sale.discount > 0 && (
        <div className={styles.row}>
          <span>{t("receipt.labels.discount", "Discount")}</span>
          <span>−{formatAmountWithCurrency(sale.discount, sale.saleCurrency)}</span>
        </div>
      )}
      {sections.total && (
        <div className={`${styles.row} ${styles.totalRow}`}>
          <span>{t("receipt.labels.total", "TOTAL")}</span>
          <span>{formatAmountWithCurrency(sale.total, sale.saleCurrency)}</span>
        </div>
      )}
      {sections.total && totalWithWords ? (
        <div className={styles.totalInWords}>{totalWithWords}</div>
      ) : null}
      {sections.closed_without_payment && closedWithoutPayment && (
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
      {sections.balance_due &&
        !closedWithoutPayment &&
        (sale.balanceDue ?? 0) > 0 && (
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
              <span>
                {formatAmountWithCurrency(sale.balanceDue ?? 0, sale.saleCurrency)}
              </span>
            </div>
          </>
        )}
      {(sections.payments || sections.tendered_change) && (
        <hr className={styles.divider} />
      )}
      {sections.payments &&
        (sale.payments && sale.payments.length > 1 ? (
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
                    ? formatAmountWithCurrency(
                        payment.paymentAmount,
                        payment.paymentCurrency,
                      )
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
        ))}
      {sections.payments &&
        !closedWithoutPayment &&
        currenciesDiffer &&
        sale.paymentAmount != null &&
        !sale.payments?.length && (
          <div className={styles.row}>
            <span>{t("receipt.labels.paidAmount", "Paid amount")}</span>
            <span>
              {formatAmountWithCurrency(sale.paymentAmount, sale.paymentCurrency)}
            </span>
          </div>
        )}
      {sections.tendered_change && sale.isCash && !closedWithoutPayment && (
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
                  {formatAmountWithCurrency(
                    sale.changeInPaymentCurrency,
                    sale.paymentCurrency,
                  )}
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
      {sections.footer && footerText && (
        <div className={styles.thanks}>{footerText}</div>
      )}
    </div>
  );
}
