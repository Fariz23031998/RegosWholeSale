import type { Sale } from "@/data/seed";
import { formatCurrency, formatDateTime } from "@/lib/format";
import styles from "./Receipt.module.css";

export function ReceiptView({ sale }: { sale: Sale }) {
  const closedWithoutPayment = (sale.amountPaid ?? 0) <= 0 && (sale.balanceDue ?? 0) > 0;

  return (
    <div className={styles.receipt}>
      <div className={styles.brand}>
        <div className={styles.brandName}>PULSE POS</div>
        <div className={styles.brandSub}>123 Market Street · (555) 010-2030</div>
      </div>
      <div className={styles.meta}>
        {formatDateTime(sale.createdAt)} · #{sale.id}
        <br />
        Cashier: {sale.cashierName}
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
        <span>Subtotal</span>
        <span>{formatCurrency(sale.subtotal)}</span>
      </div>
      {sale.discount > 0 && (
        <div className={styles.row}>
          <span>Discount</span>
          <span>−{formatCurrency(sale.discount)}</span>
        </div>
      )}
      <div className={`${styles.row} ${styles.totalRow}`}>
        <span>TOTAL</span>
        <span>{formatCurrency(sale.total)}</span>
      </div>
      {closedWithoutPayment && (
        <div className={styles.closedWithoutPayment}>
          <div className={styles.closedWithoutPaymentTitle}>Closed without payment</div>
          <div className={styles.closedWithoutPaymentDebt}>
            Customer debt is {formatCurrency(sale.balanceDue ?? sale.total)}.
          </div>
        </div>
      )}
      {!closedWithoutPayment && (sale.balanceDue ?? 0) > 0 && (
        <>
          <div className={styles.row}>
            <span>Paid</span>
            <span>{formatCurrency(sale.amountPaid ?? 0)}</span>
          </div>
          <div className={`${styles.row} ${styles.debtRow}`}>
            <span>Balance due</span>
            <span>{formatCurrency(sale.balanceDue ?? 0)}</span>
          </div>
        </>
      )}
      <hr className={styles.divider} />
      <div className={styles.row}>
        <span>Payment</span>
        <span>{closedWithoutPayment ? "None" : sale.paymentTypeName}</span>
      </div>
      {sale.isCash && !closedWithoutPayment && (
        <>
          <div className={styles.row}>
            <span>Tendered</span>
            <span>{formatCurrency(sale.tendered ?? 0)}</span>
          </div>
          <div className={styles.row}>
            <span>Change</span>
            <span>{formatCurrency(sale.change ?? 0)}</span>
          </div>
        </>
      )}
      <div className={styles.thanks}>Thank you for your purchase!</div>
    </div>
  );
}
