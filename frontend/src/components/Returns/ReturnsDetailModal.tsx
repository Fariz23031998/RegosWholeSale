import { Modal } from "@/components/posui/Modal";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type {
  WholesaleOperationLine,
  WholesalePaymentLine,
  WholesaleReturnDocument,
} from "@/lib/sales-api";
import styles from "./Returns.module.css";

type Props = {
  document: WholesaleReturnDocument;
  operations: WholesaleOperationLine[];
  payments: WholesalePaymentLine[];
  loading?: boolean;
  onClose: () => void;
};

export function ReturnsDetailModal({
  document,
  operations,
  payments,
  loading = false,
  onClose,
}: Props) {
  const title = `Return #${document.code || document.id}`;

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div className={styles.detailMeta}>
        <div>
          <span className={styles.detailLabel}>Date</span>
          <span>
            {document.date > 0
              ? formatDateTime(new Date(document.date * 1000).toISOString())
              : "—"}
          </span>
        </div>
        <div>
          <span className={styles.detailLabel}>Original sale</span>
          <span>
            {document.wholesale_doc_id ? `#${document.wholesale_doc_id}` : "—"}
          </span>
        </div>
        <div>
          <span className={styles.detailLabel}>Partner</span>
          <span>{document.partner_name ?? "—"}</span>
        </div>
        <div>
          <span className={styles.detailLabel}>Warehouse</span>
          <span>{document.stock_name ?? "—"}</span>
        </div>
        <div>
          <span className={styles.detailLabel}>Attached user</span>
          <span>{document.attached_user_name ?? "—"}</span>
        </div>
        <div>
          <span className={styles.detailLabel}>Reason</span>
          <span>{document.reason || "—"}</span>
        </div>
        <div>
          <span className={styles.detailLabel}>Total</span>
          <span>{formatCurrency(document.amount ?? 0)}</span>
        </div>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Products</div>
        {loading ? (
          <div className={styles.detailEmpty}>Loading…</div>
        ) : operations.length === 0 ? (
          <div className={styles.detailEmpty}>No product lines.</div>
        ) : (
          <div className={styles.detailTableWrap}>
            <table className={styles.detailTable}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Product</th>
                  <th className={styles.right}>Qty</th>
                  <th className={styles.right}>Price</th>
                  <th className={styles.right}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((op) => (
                  <tr key={op.id}>
                    <td className={styles.id}>{op.item_code || "—"}</td>
                    <td>{op.item_name ?? `Item #${op.item_id}`}</td>
                    <td className={styles.right}>{op.quantity}</td>
                    <td className={styles.right}>{formatCurrency(op.price)}</td>
                    <td className={styles.right}>
                      {formatCurrency(op.amount ?? op.price * op.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Payments</div>
        {loading ? (
          <div className={styles.detailEmpty}>Loading…</div>
        ) : payments.length === 0 ? (
          <div className={styles.detailEmpty}>No payments recorded.</div>
        ) : (
          <div className={styles.detailTableWrap}>
            <table className={styles.detailTable}>
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th className={styles.right}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className={styles.id}>#{payment.code || payment.id}</td>
                    <td>
                      {payment.date > 0
                        ? formatDateTime(new Date(payment.date * 1000).toISOString())
                        : "—"}
                    </td>
                    <td>{payment.payment_type_name ?? "—"}</td>
                    <td className={styles.right}>{formatCurrency(payment.amount ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
