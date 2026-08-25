import { useLanguage } from "@/contexts/LanguageContext";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { formatCurrency } from "@/lib/format";
import type { PendingSaleRecord } from "@/types/pending-sale";
import styles from "./Notifications.module.css";

type Props = {
  record: PendingSaleRecord;
  onClose: () => void;
  onDismiss: () => void;
  onRestoreAndRetry: () => void;
};

export function FailedSaleModal({
  record,
  onClose,
  onDismiss,
  onRestoreAndRetry,
}: Props) {
  const { t } = useLanguage();
  const itemPreview = record.cartItems
    .slice(0, 3)
    .map((item) => `${item.name} × ${item.qty}`)
    .join(", ");
  const moreCount = Math.max(0, record.cartItems.length - 3);

  return (
    <Modal
      open
      onClose={onClose}
      title={t("notifications.failedSaleTitle", "Failed sale")}
      bodyClassName={styles.modalBody}
    >
      <div className={styles.summary}>
        <div className={styles.summaryRow}>
          <span>{t("common.type", "Type")}</span>
          <strong>
            {record.kind === "checkout"
              ? t("notifications.kindCheckout", "Checkout")
              : t("notifications.kindPostpone", "Postpone")}
          </strong>
        </div>
        <div className={styles.summaryRow}>
          <span>{t("common.total", "Total")}</span>
          <strong>{formatCurrency(record.totals.total)}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>{t("common.date", "Date")}</span>
          <strong>{new Date(record.createdAt).toLocaleString()}</strong>
        </div>
      </div>

      {record.errorMessage ? (
        <div className={styles.errorBox}>{record.errorMessage}</div>
      ) : null}

      <div className={styles.itemsPreview}>
        {itemPreview}
        {moreCount > 0
          ? ` ${t("notifications.moreItems", "+{{count}} more", { count: moreCount })}`
          : ""}
      </div>

      {record.kind === "checkout" && record.paymentPayload ? (
        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span>{t("notifications.paymentAmount", "Payment amount")}</span>
            <strong>{formatCurrency(record.paymentPayload.amount_paid)}</strong>
          </div>
        </div>
      ) : null}

      <div className={styles.footerActions}>
        <Button variant="secondary" onClick={onClose}>
          {t("common.close", "Close")}
        </Button>
        <Button variant="secondary" onClick={onDismiss}>
          {t("notifications.dismiss", "Dismiss")}
        </Button>
        <Button onClick={onRestoreAndRetry}>
          {t("notifications.restoreRetry", "Restore & retry")}
        </Button>
      </div>
    </Modal>
  );
}
