import { useLanguage } from "@/contexts/LanguageContext";
import type { ReceiptPrintContext } from "@/lib/receipt-print-context";
import type { ReceiptTemplate } from "@/types/receipt-templates";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import {
  formatAmountWithCurrency,
  getSalePaymentState,
} from "./receipt-content";
import styles from "./InvoiceA4.module.css";

type Props = {
  template: ReceiptTemplate;
  context: ReceiptPrintContext;
};

export function InvoiceA4Layout({ template, context }: Props) {
  const { t } = useLanguage();
  const { sale } = context;
  const { sections, header, footer_text: footerText, invoice_title: invoiceTitle } =
    template;
  const { closedWithoutPayment, currenciesDiffer } = getSalePaymentState(sale);
  const docId = context.document_code ?? sale.id;

  return (
    <div className={styles.invoice}>
      {sections.header && (
        <header className={styles.header}>
          <div className={styles.seller}>
            {header.company_name && (
              <div className={styles.companyName}>{header.company_name}</div>
            )}
            {header.address && <div className={styles.sellerLine}>{header.address}</div>}
            {header.phone && (
              <div className={styles.sellerLine}>
                {t("receipt.labels.tel", "Tel:")} {header.phone}
              </div>
            )}
            {header.tax_id && (
              <div className={styles.sellerLine}>
                {t("receipt.labels.taxId", "Tax ID:")} {header.tax_id}
              </div>
            )}
          </div>
          {invoiceTitle && <div className={styles.invoiceTitle}>{invoiceTitle}</div>}
        </header>
      )}

      <div className={styles.infoGrid}>
        {sections.meta && (
          <div className={styles.infoBlock}>
            <div className={styles.infoLabel}>
              {t("receipt.labels.document", "Document")}
            </div>
            <div>#{docId}</div>
            <div>{formatDate(sale.createdAt)}</div>
            <div>{formatDateTime(sale.createdAt)}</div>
            <div>
              {t("receipt.labels.cashier", "Cashier:")} {sale.cashierName}
            </div>
            {context.stock_name && (
              <div>
                {t("receipt.labels.warehouse", "Warehouse:")} {context.stock_name}
              </div>
            )}
          </div>
        )}
        {sections.partner && context.partner_name && (
          <div className={styles.infoBlock}>
            <div className={styles.infoLabel}>
              {t("receipt.labels.billTo", "Bill to")}
            </div>
            <div className={styles.partnerName}>{context.partner_name}</div>
          </div>
        )}
      </div>

      {sections.items && (
        <table className={styles.itemsTable}>
          <thead>
            <tr>
              <th className={styles.colItem}>{t("receipt.labels.item", "Item")}</th>
              <th className={styles.colQty}>{t("receipt.labels.qty", "Qty")}</th>
              <th className={styles.colPrice}>
                {t("receipt.labels.unitPrice", "Unit price")}
              </th>
              <th className={styles.colAmount}>
                {t("receipt.labels.amount", "Amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item) => (
              <tr key={item.productId}>
                <td>{item.name}</td>
                <td className={styles.numCell}>{item.qty}</td>
                <td className={styles.numCell}>{formatCurrency(item.price)}</td>
                <td className={styles.numCell}>
                  {formatCurrency(item.price * item.qty)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={styles.totals}>
        {sections.subtotal && (
          <div className={styles.totalRow}>
            <span>{t("receipt.labels.subtotal", "Subtotal")}</span>
            <span>{formatAmountWithCurrency(sale.subtotal, sale.saleCurrency)}</span>
          </div>
        )}
        {sections.discount && sale.discount > 0 && (
          <div className={styles.totalRow}>
            <span>{t("receipt.labels.discount", "Discount")}</span>
            <span>−{formatAmountWithCurrency(sale.discount, sale.saleCurrency)}</span>
          </div>
        )}
        {sections.total && (
          <div className={`${styles.totalRow} ${styles.grandTotal}`}>
            <span>{t("receipt.sections.total", "Total")}</span>
            <span>{formatAmountWithCurrency(sale.total, sale.saleCurrency)}</span>
          </div>
        )}
      </div>

      {sections.closed_without_payment && closedWithoutPayment && (
        <div className={styles.notice}>
          {t("receipt.invoice.closedWithoutDebt", "Closed without payment — customer debt: {{amount}}", {
            amount: formatAmountWithCurrency(
              sale.balanceDue ?? sale.total,
              sale.saleCurrency,
            ),
          })}
        </div>
      )}

      {sections.balance_due &&
        !closedWithoutPayment &&
        (sale.balanceDue ?? 0) > 0 && (
          <div className={styles.payments}>
            <div className={styles.totalRow}>
              <span>{t("receipt.labels.paid", "Paid")}</span>
              <span>
                {formatAmountWithCurrency(sale.amountPaid ?? 0, sale.saleCurrency)}
              </span>
            </div>
            <div className={`${styles.totalRow} ${styles.debtRow}`}>
              <span>{t("receipt.labels.balanceDue", "Balance due")}</span>
              <span>
                {formatAmountWithCurrency(sale.balanceDue ?? 0, sale.saleCurrency)}
              </span>
            </div>
          </div>
        )}

      {sections.payments && (
        <div className={styles.payments}>
          {sale.payments && sale.payments.length > 1 ? (
            sale.payments.map((payment, index) => (
              <div key={`${payment.paymentTypeId}-${index}`} className={styles.totalRow}>
                <span>{payment.paymentTypeName}</span>
                <span>
                  {formatAmountWithCurrency(payment.amountPaid, sale.saleCurrency)}
                </span>
              </div>
            ))
          ) : (
            <div className={styles.totalRow}>
              <span>{t("receipt.labels.payment", "Payment")}</span>
              <span>
                {closedWithoutPayment
                  ? t("receipt.labels.none", "None")
                  : sale.paymentTypeName}
              </span>
            </div>
          )}
          {!closedWithoutPayment &&
            currenciesDiffer &&
            sale.paymentAmount != null &&
            !sale.payments?.length && (
              <div className={styles.totalRow}>
                <span>{t("receipt.labels.paidAmount", "Paid amount")}</span>
                <span>
                  {formatAmountWithCurrency(sale.paymentAmount, sale.paymentCurrency)}
                </span>
              </div>
            )}
        </div>
      )}

      {sections.tendered_change && sale.isCash && !closedWithoutPayment && (
        <div className={styles.payments}>
          <div className={styles.totalRow}>
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
          <div className={styles.totalRow}>
            <span>{t("receipt.labels.change", "Change")}</span>
            <span>
              {formatAmountWithCurrency(sale.change ?? 0, sale.saleCurrency)}
            </span>
          </div>
        </div>
      )}

      {sections.footer && footerText && (
        <footer className={styles.footer}>{footerText}</footer>
      )}
    </div>
  );
}
