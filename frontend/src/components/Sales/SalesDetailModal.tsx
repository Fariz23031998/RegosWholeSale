import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type {
  WholesaleDocument,
  WholesaleOperationLine,
  WholesalePaymentLine,
} from "@/lib/sales-api";
import styles from "./Sales.module.css";

type Props = {
  document: WholesaleDocument;
  operations: WholesaleOperationLine[];
  payments: WholesalePaymentLine[];
  loading?: boolean;
  onClose: () => void;
};

export function SalesDetailModal({
  document,
  operations,
  payments,
  loading = false,
  onClose,
}: Props) {
  const { t } = useLanguage();
  const title = t("sales.detail.title", undefined, { code: document.code || document.id });

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div className={styles.detailMeta}>
        <div>
          <span className={styles.detailLabel}>{t("common.date")}</span>
          <span>
            {document.date > 0
              ? formatDateTime(new Date(document.date * 1000).toISOString())
              : "—"}
          </span>
        </div>
        <div>
          <span className={styles.detailLabel}>{t("sales.table.partner")}</span>
          <span>{document.partner_name ?? "—"}</span>
        </div>
        <div>
          <span className={styles.detailLabel}>{t("sales.table.warehouse")}</span>
          <span>{document.stock_name ?? "—"}</span>
        </div>
        <div>
          <span className={styles.detailLabel}>{t("sales.table.attachedUser")}</span>
          <span>{document.attached_user_name ?? "—"}</span>
        </div>
        <div>
          <span className={styles.detailLabel}>{t("common.total")}</span>
          <span>{formatCurrency(document.amount ?? 0)}</span>
        </div>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>{t("sales.detail.products")}</div>
        {loading ? (
          <div className={styles.detailEmpty}>{t("common.loading")}</div>
        ) : operations.length === 0 ? (
          <div className={styles.detailEmpty}>{t("sales.detail.noProducts")}</div>
        ) : (
          <div className={styles.detailTableWrap}>
            <table className={styles.detailTable}>
              <thead>
                <tr>
                  <th>{t("sales.detail.table.code")}</th>
                  <th>{t("sales.detail.table.product")}</th>
                  <th className={styles.right}>{t("sales.detail.table.qty")}</th>
                  <th className={styles.right}>{t("sales.detail.table.price")}</th>
                  <th className={styles.right}>{t("common.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((op) => (
                  <tr key={op.id}>
                    <td className={styles.id} data-label={t("sales.detail.table.code")}>
                      {op.item_code || "—"}
                    </td>
                    <td data-label={t("sales.detail.table.product")}>
                      {op.item_name ?? t("sales.itemFallback", undefined, { id: op.item_id })}
                    </td>
                    <td className={styles.right} data-label={t("sales.detail.table.qty")}>
                      {op.quantity}
                    </td>
                    <td className={styles.right} data-label={t("sales.detail.table.price")}>
                      {formatCurrency(op.price)}
                    </td>
                    <td className={styles.right} data-label={t("common.amount")}>
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
        <div className={styles.detailSectionTitle}>{t("sales.detail.payments")}</div>
        {loading ? (
          <div className={styles.detailEmpty}>{t("common.loading")}</div>
        ) : payments.length === 0 ? (
          <div className={styles.detailEmpty}>{t("sales.detail.noPayments")}</div>
        ) : (
          <div className={styles.detailTableWrap}>
            <table className={styles.detailTable}>
              <thead>
                <tr>
                  <th>{t("sales.table.receipt")}</th>
                  <th>{t("common.date")}</th>
                  <th>{t("common.type")}</th>
                  <th className={styles.right}>{t("common.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className={styles.id} data-label={t("sales.table.receipt")}>
                      #{payment.code || payment.id}
                    </td>
                    <td data-label={t("common.date")}>
                      {payment.date > 0
                        ? formatDateTime(new Date(payment.date * 1000).toISOString())
                        : "—"}
                    </td>
                    <td data-label={t("common.type")}>{payment.payment_type_name ?? "—"}</td>
                    <td className={styles.right} data-label={t("common.amount")}>
                      {formatCurrency(payment.amount ?? 0)}
                    </td>
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
