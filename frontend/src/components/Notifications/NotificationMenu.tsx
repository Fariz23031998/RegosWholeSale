import { useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency } from "@/lib/format";
import { restorePendingSaleSnapshot } from "@/lib/pending-sale-restore";
import { retryPendingSaleSync } from "@/lib/pending-sales-sync";
import { revertStockAdjustments } from "@/lib/cart-stock";
import { useCatalog } from "@/store/catalog";
import { useNotifications, unreadFailedCount } from "@/store/notifications";
import { usePendingSales } from "@/store/pending-sales";
import type { PendingSaleRecord } from "@/types/pending-sale";
import { FailedSaleModal } from "./FailedSaleModal";
import styles from "./Notifications.module.css";

function formatTimestamp(createdAt: number): string {
  return new Date(createdAt).toLocaleString();
}

function statusLabel(
  status: PendingSaleRecord["status"],
  t: (key: string, fallback: string) => string,
): string {
  switch (status) {
    case "pending":
      return t("notifications.statusPending", "Waiting to sync");
    case "syncing":
      return t("notifications.statusSyncing", "Syncing…");
    case "failed":
      return t("notifications.statusFailed", "Failed");
  }
}

export function NotificationMenu() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [modalSnapshot, setModalSnapshot] = useState<PendingSaleRecord | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const records = usePendingSales((s) => s.records);
  const failedRecords = useMemo(
    () => records.filter((record) => record.status === "failed"),
    [records],
  );
  const unreadFailedIds = useNotifications((s) => s.unreadFailedIds);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const markRead = useNotifications((s) => s.markRead);
  const remove = usePendingSales((s) => s.remove);
  const setActiveRetryLocalId = usePendingSales((s) => s.setActiveRetryLocalId);
  const requestCheckoutRestore = usePendingSales((s) => s.requestCheckoutRestore);
  const decrementStock = useCatalog((s) => s.decrementStock);
  const incrementStock = useCatalog((s) => s.incrementStock);

  const badgeCount = unreadFailedCount(
    failedRecords.map((record) => record.localId),
    unreadFailedIds,
  );

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleOpenPanel = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) {
      markAllRead(failedRecords.map((record) => record.localId));
    }
  };

  const dismissRecord = async (record: PendingSaleRecord) => {
    if (record.stockAdjustments?.length) {
      revertStockAdjustments(record.stockAdjustments, decrementStock, incrementStock);
    }
    await remove(record.localId);
    markRead(record.localId);
  };

  const handleRetry = async (record: PendingSaleRecord) => {
    markRead(record.localId);
    await retryPendingSaleSync(record.localId);
    setOpen(false);
  };

  const handleOpen = (record: PendingSaleRecord) => {
    markRead(record.localId);
    setModalSnapshot(structuredClone(record));
    setOpen(false);
  };

  const handleCloseModal = () => {
    setModalSnapshot(null);
  };

  const resolveRecord = (localId: string): PendingSaleRecord | null =>
    records.find((record) => record.localId === localId) ?? modalSnapshot;

  const handleRestoreAndRetry = (localId: string) => {
    const record = resolveRecord(localId);
    if (!record) return;

    restorePendingSaleSnapshot(record);
    setActiveRetryLocalId(record.localId);
    setModalSnapshot(null);

    if (record.kind === "checkout" && record.paymentPayload) {
      requestCheckoutRestore({
        localId: record.localId,
        totals: record.totals,
        initialPaymentPayload: record.paymentPayload,
      });
    }

    void navigate({ to: "/" });
  };

  return (
    <>
      <div className={styles.notificationMenu} ref={rootRef}>
        <button
          type="button"
          className={styles.trigger}
          onClick={handleOpenPanel}
          aria-label={t("notifications.menuLabel", "Sync notifications")}
          aria-expanded={open}
        >
          <Bell size={18} />
          {badgeCount > 0 ? (
            <span className={styles.badge}>{badgeCount > 9 ? "9+" : badgeCount}</span>
          ) : null}
        </button>

        {open ? (
          <div className={styles.panel} role="menu">
            <div className={styles.header}>
              {t("notifications.title", "Sync failures")}
            </div>
            <div className={styles.list}>
              {records.length === 0 ? (
                <div className={styles.empty}>
                  {t("notifications.empty", "No failed sales to sync.")}
                </div>
              ) : (
                records.map((record) => {
                  const failed = record.status === "failed";
                  const unread = failed && unreadFailedIds.has(record.localId);
                  return (
                    <div
                      key={record.localId}
                      className={clsx(styles.item, unread && styles.itemUnread)}
                    >
                      <div className={styles.itemTop}>
                        <div>
                          <div className={styles.kind}>
                            {record.kind === "checkout"
                              ? t("notifications.kindCheckout", "Checkout")
                              : t("notifications.kindPostpone", "Postpone")}
                          </div>
                          <div className={styles.meta}>
                            {formatTimestamp(record.createdAt)} ·{" "}
                            {formatCurrency(record.totals.total)}
                          </div>
                        </div>
                        <div
                          className={clsx(
                            styles.status,
                            failed && styles.statusFailed,
                          )}
                        >
                          {statusLabel(record.status, t)}
                        </div>
                      </div>
                      {record.errorMessage ? (
                        <div className={styles.error}>{record.errorMessage}</div>
                      ) : null}
                      {failed ? (
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => handleOpen(record)}
                          >
                            {t("notifications.open", "Open")}
                          </button>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => void handleRetry(record)}
                          >
                            {t("notifications.retrySync", "Retry sync")}
                          </button>
                          <button
                            type="button"
                            className={clsx(styles.actionBtn, styles.actionBtnDanger)}
                            onClick={() => void dismissRecord(record)}
                          >
                            {t("notifications.dismiss", "Dismiss")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>

      {modalSnapshot ? (
        <FailedSaleModal
          record={modalSnapshot}
          onClose={handleCloseModal}
          onDismiss={() =>
            void dismissRecord(modalSnapshot).then(() => handleCloseModal())
          }
          onRestoreAndRetry={() => handleRestoreAndRetry(modalSnapshot.localId)}
        />
      ) : null}
    </>
  );
}
