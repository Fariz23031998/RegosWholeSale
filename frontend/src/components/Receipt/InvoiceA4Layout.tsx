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
            {header.phone && <div className={styles.sellerLine}>Tel: {header.phone}</div>}
            {header.tax_id && (
              <div className={styles.sellerLine}>Tax ID: {header.tax_id}</div>
            )}
          </div>
          {invoiceTitle && <div className={styles.invoiceTitle}>{invoiceTitle}</div>}
        </header>
      )}

      <div className={styles.infoGrid}>
        {sections.meta && (
          <div className={styles.infoBlock}>
            <div className={styles.infoLabel}>Document</div>
            <div>#{docId}</div>
            <div>{formatDate(sale.createdAt)}</div>
            <div>{formatDateTime(sale.createdAt)}</div>
            <div>Cashier: {sale.cashierName}</div>
            {context.stock_name && <div>Warehouse: {context.stock_name}</div>}
          </div>
        )}
        {sections.partner && context.partner_name && (
          <div className={styles.infoBlock}>
            <div className={styles.infoLabel}>Bill to</div>
            <div className={styles.partnerName}>{context.partner_name}</div>
          </div>
        )}
      </div>

      {sections.items && (
        <table className={styles.itemsTable}>
          <thead>
            <tr>
              <th className={styles.colItem}>Item</th>
              <th className={styles.colQty}>Qty</th>
              <th className={styles.colPrice}>Unit price</th>
              <th className={styles.colAmount}>Amount</th>
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
            <span>Subtotal</span>
            <span>{formatAmountWithCurrency(sale.subtotal, sale.saleCurrency)}</span>
          </div>
        )}
        {sections.discount && sale.discount > 0 && (
          <div className={styles.totalRow}>
            <span>Discount</span>
            <span>−{formatAmountWithCurrency(sale.discount, sale.saleCurrency)}</span>
          </div>
        )}
        {sections.total && (
          <div className={`${styles.totalRow} ${styles.grandTotal}`}>
            <span>Total</span>
            <span>{formatAmountWithCurrency(sale.total, sale.saleCurrency)}</span>
          </div>
        )}
      </div>

      {sections.closed_without_payment && closedWithoutPayment && (
        <div className={styles.notice}>
          Closed without payment — customer debt:{" "}
          {formatAmountWithCurrency(sale.balanceDue ?? sale.total, sale.saleCurrency)}
        </div>
      )}

      {sections.balance_due &&
        !closedWithoutPayment &&
        (sale.balanceDue ?? 0) > 0 && (
          <div className={styles.payments}>
            <div className={styles.totalRow}>
              <span>Paid</span>
              <span>
                {formatAmountWithCurrency(sale.amountPaid ?? 0, sale.saleCurrency)}
              </span>
            </div>
            <div className={`${styles.totalRow} ${styles.debtRow}`}>
              <span>Balance due</span>
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
              <span>Payment</span>
              <span>{closedWithoutPayment ? "None" : sale.paymentTypeName}</span>
            </div>
          )}
          {!closedWithoutPayment &&
            currenciesDiffer &&
            sale.paymentAmount != null &&
            !sale.payments?.length && (
              <div className={styles.totalRow}>
                <span>Paid amount</span>
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
            <span>Tendered</span>
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
            <span>Change</span>
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
