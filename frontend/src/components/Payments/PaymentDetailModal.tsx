import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  deleteMarkPayment,
  deletePayment,
  editPayment,
  performCancelPayment,
  performPayment,
} from "@/lib/payments-api";
import { formatAuthError, useAuth } from "@/store/auth";
import type { PaymentDocument } from "@/types/payments";
import styles from "./Payments.module.css";

type Props = {
  open: boolean;
  payment: PaymentDocument | null;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => void;
};

export function PaymentDetailModal({
  open,
  payment,
  canEdit,
  canDelete,
  onClose,
  onChanged,
}: Props) {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!payment) return;
    setEditing(false);
    setAmount(payment.amount != null ? String(payment.amount) : "");
    setDescription(payment.description ?? "");
    setError("");
  }, [payment]);

  if (!payment) return null;

  const showActions = canEdit || canDelete;

  const runAction = async (action: () => Promise<unknown>, successKey: string, fallback: string) => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await action();
      toast.success(t(successKey, fallback));
      onChanged();
      onClose();
    } catch (err: unknown) {
      setError(formatAuthError(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!token) return;
    const parsedAmount = Number(amount);
    if (!(parsedAmount > 0)) {
      setError(t("payments.create.invalidAmount", "Enter a valid amount."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await editPayment(token, payment.id, {
        amount: parsedAmount,
        description: description.trim() || "",
      });
      toast.success(t("payments.detail.editSuccess", "Payment updated."));
      setEditing(false);
      onChanged();
    } catch (err: unknown) {
      setError(formatAuthError(err, t("payments.detail.editError", "Failed to update payment.")));
    } finally {
      setBusy(false);
    }
  };

  const directionLabel =
    payment.payment_direction === "outcome"
      ? t("payments.outcome", "Outcome")
      : payment.payment_direction === "income"
        ? t("payments.income", "Income")
        : "—";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("payments.detail.title", "Payment {{code}}", { code: payment.code })}
      size="lg"
    >
      <div className={styles.detailGrid}>
        <div className={styles.detailLabel}>{t("payments.table.code", "Code")}</div>
        <div>{payment.code}</div>
        <div className={styles.detailLabel}>{t("payments.table.date", "Date")}</div>
        <div>{formatDateTime(new Date(payment.date * 1000).toISOString())}</div>
        <div className={styles.detailLabel}>{t("payments.direction", "Direction")}</div>
        <div>{directionLabel}</div>
        <div className={styles.detailLabel}>{t("payments.partner", "Partner")}</div>
        <div>{payment.partner_name ?? "—"}</div>
        <div className={styles.detailLabel}>{t("payments.firm", "Enterprise")}</div>
        <div>{payment.firm_name ?? "—"}</div>
        <div className={styles.detailLabel}>{t("payments.paymentType", "Payment type")}</div>
        <div>{payment.payment_type_name ?? "—"}</div>
        <div className={styles.detailLabel}>{t("payments.category", "Category")}</div>
        <div>{payment.category_name ?? "—"}</div>
        <div className={styles.detailLabel}>{t("sales.table.attachedUser", "Attached user")}</div>
        <div>{payment.attached_user_name ?? "—"}</div>
        <div className={styles.detailLabel}>{t("payments.amount", "Amount")}</div>
        <div>
          {editing ? (
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          ) : (
            <>
              {formatCurrency(payment.amount ?? 0)}
              {payment.currency?.code_chr ? ` ${payment.currency.code_chr}` : ""}
            </>
          )}
        </div>
        <div className={styles.detailLabel}>{t("payments.exchangeRate", "Exchange rate")}</div>
        <div>{payment.exchange_rate ?? "—"}</div>
        <div className={styles.detailLabel}>{t("payments.description", "Description")}</div>
        <div>
          {editing ? (
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          ) : (
            payment.description || "—"
          )}
        </div>
        <div className={styles.detailLabel}>{t("payments.status", "Status")}</div>
        <div>
          {payment.deleted_mark
            ? t("payments.status.deletedMark", "Marked for deletion")
            : payment.performed
              ? t("payments.status.performed", "Performed")
              : t("payments.status.draft", "Draft")}
        </div>
      </div>

      {error ? <div className={styles.error} style={{ margin: "0 20px 16px" }}>{error}</div> : null}

      {showActions ? (
        <div className={styles.detailActions}>
          {editing ? (
            <>
              <Button type="button" onClick={() => void handleSaveEdit()} disabled={busy}>
                {t("common.save", "Save")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                {t("common.cancel", "Cancel")}
              </Button>
            </>
          ) : (
            <>
              {canEdit && !payment.performed && !payment.deleted_mark ? (
                <>
                  <Button type="button" variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
                    {t("payments.actions.edit", "Edit")}
                  </Button>
                  <Button
                    type="button"
                    onClick={() =>
                      void runAction(
                        () => performPayment(token as string, payment.id),
                        "payments.actions.performSuccess",
                        "Payment performed.",
                      )
                    }
                    disabled={busy}
                  >
                    {t("payments.actions.perform", "Perform")}
                  </Button>
                </>
              ) : null}
              {canEdit && payment.performed && !payment.deleted_mark ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    void runAction(
                      () => performCancelPayment(token as string, payment.id),
                      "payments.actions.performCancelSuccess",
                      "Payment perform canceled.",
                    )
                  }
                  disabled={busy}
                >
                  {t("payments.actions.performCancel", "Cancel perform")}
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    void runAction(
                      () => deleteMarkPayment(token as string, payment.id),
                      "payments.actions.deleteMarkSuccess",
                      "Delete mark toggled.",
                    )
                  }
                  disabled={busy}
                >
                  {payment.deleted_mark
                    ? t("payments.actions.unmark", "Remove delete mark")
                    : t("payments.actions.deleteMark", "Mark for deletion")}
                </Button>
              ) : null}
              {canDelete && payment.deleted_mark ? (
                <Button
                  type="button"
                  onClick={() =>
                    void runAction(
                      () => deletePayment(token as string, payment.id),
                      "payments.actions.deleteSuccess",
                      "Payment deleted.",
                    )
                  }
                  disabled={busy}
                >
                  {t("payments.actions.delete", "Delete permanently")}
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
