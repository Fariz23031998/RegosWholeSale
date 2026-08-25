import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PartnerPickerModal } from "@/components/POS/PartnerPickerModal";
import { PaymentDateTimeField } from "@/components/Payments/PaymentDateTimeField";
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
import { fetchFirms } from "@/lib/partners-api";
import { loadPaymentTypes } from "@/lib/payment-service";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import { fromDatetimeRuValue, toDatetimeRuValue } from "@/lib/stock-doc-form";
import { formatAuthError, useAuth } from "@/store/auth";
import type { PaymentDocument } from "@/types/payments";
import type { Partner } from "@/types/partners";
import styles from "./Payments.module.css";

type Props = {
  open: boolean;
  payment: PaymentDocument | null;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onChanged: (updated?: PaymentDocument) => void;
};

function syncFormFromPayment(payment: PaymentDocument) {
  return {
    amount: payment.amount != null ? String(payment.amount) : "",
    description: payment.description ?? "",
    dateTimeValue: toDatetimeRuValue(
      payment.date > 0 ? payment.date : Math.floor(Date.now() / 1000),
    ),
    partnerId: payment.partner_id,
    partnerName: payment.partner_name,
    firmId: payment.firm_id,
    paymentTypeId: payment.payment_type_id,
    categoryId: payment.category_id,
    exchangeRate: payment.exchange_rate != null ? String(payment.exchange_rate) : "",
  };
}

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
  const companyId = useAuth((s) => s.user?.company_id ?? null);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [dateTimeValue, setDateTimeValue] = useState("");
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [firmId, setFirmId] = useState<number | null>(null);
  const [paymentTypeId, setPaymentTypeId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [exchangeRate, setExchangeRate] = useState("");
  const [partnerPickerOpen, setPartnerPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data: firms = [] } = useQuery({
    queryKey: ["firms", token],
    queryFn: async () => {
      if (!token) return [];
      const response = await fetchFirms(token);
      return response.firms;
    },
    enabled: open && editing && Boolean(token),
  });

  const { data: paymentTypesData } = useQuery({
    queryKey: ["payment-types", token, companyId],
    queryFn: () => loadPaymentTypes(token as string, companyId),
    enabled: open && editing && Boolean(token) && companyId != null,
  });
  const paymentTypes = paymentTypesData?.payment_types ?? [];

  const { data: referenceOptions } = useQuery({
    queryKey: ["regos-reference-options", token, "payments-edit"],
    queryFn: () => fetchRegosReferenceOptions(token as string),
    enabled: open && editing && Boolean(token),
  });

  const categoryOptions = useMemo(() => {
    if (!referenceOptions) return [];
    return payment?.payment_direction === "outcome"
      ? referenceOptions.refund_payment_categories
      : referenceOptions.payment_categories;
  }, [payment?.payment_direction, referenceOptions]);

  const categorySelectOptions = useMemo(() => {
    if (!payment) return categoryOptions;
    if (
      payment.category_id != null &&
      !categoryOptions.some((item) => item.id === payment.category_id)
    ) {
      return [
        {
          id: payment.category_id,
          name: payment.category_name ?? `#${payment.category_id}`,
        },
        ...categoryOptions,
      ];
    }
    return categoryOptions;
  }, [categoryOptions, payment]);

  useEffect(() => {
    if (!payment) return;
    setEditing(false);
    setPartnerPickerOpen(false);
    setError("");
    const next = syncFormFromPayment(payment);
    setAmount(next.amount);
    setDescription(next.description);
    setDateTimeValue(next.dateTimeValue);
    setPartnerId(next.partnerId);
    setPartnerName(next.partnerName);
    setFirmId(next.firmId);
    setPaymentTypeId(next.paymentTypeId);
    setCategoryId(next.categoryId);
    setExchangeRate(next.exchangeRate);
  }, [payment]);

  if (!payment) return null;

  const showActions = canEdit || canDelete;

  const resetForm = () => {
    const next = syncFormFromPayment(payment);
    setAmount(next.amount);
    setDescription(next.description);
    setDateTimeValue(next.dateTimeValue);
    setPartnerId(next.partnerId);
    setPartnerName(next.partnerName);
    setFirmId(next.firmId);
    setPaymentTypeId(next.paymentTypeId);
    setCategoryId(next.categoryId);
    setExchangeRate(next.exchangeRate);
    setError("");
  };

  const handlePaymentTypeChange = (nextTypeId: number | null) => {
    setPaymentTypeId(nextTypeId);
    const selected = paymentTypes.find((type) => type.id === nextTypeId);
    const rate = selected?.currency?.exchange_rate;
    setExchangeRate(rate != null ? String(rate) : "");
  };

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
    if (partnerId == null) {
      setError(t("payments.create.selectPartner", "Select partner"));
      return;
    }
    if (firmId == null) {
      setError(t("payments.create.selectFirm", "Select enterprise"));
      return;
    }
    if (paymentTypeId == null) {
      setError(t("payments.create.selectPaymentType", "Select payment type"));
      return;
    }
    const date = fromDatetimeRuValue(dateTimeValue);
    if (date == null) {
      setError(
        t(
          "stock.errors.invalidDate",
          "Enter a valid date and time (dd.MM.yyyy HH:MM)",
        ),
      );
      return;
    }
    const parsedRate = Number(exchangeRate);
    setBusy(true);
    setError("");
    try {
      const updated = await editPayment(token, payment.id, {
        partner_id: partnerId,
        firm_id: firmId,
        payment_type_id: paymentTypeId,
        category_id: categoryId,
        amount: parsedAmount,
        exchange_rate: Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : undefined,
        description: description.trim() || "",
        date,
      });
      toast.success(t("payments.detail.editSuccess", "Payment updated."));
      setEditing(false);
      onChanged(updated);
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
    <>
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
          <div className={styles.detailValue}>
            {editing ? (
              <PaymentDateTimeField
                value={dateTimeValue}
                onChange={setDateTimeValue}
              />
            ) : (
              formatDateTime(new Date(payment.date * 1000).toISOString())
            )}
          </div>

          <div className={styles.detailLabel}>{t("payments.direction", "Direction")}</div>
          <div>{directionLabel}</div>

          <div className={styles.detailLabel}>{t("payments.partner", "Partner")}</div>
          <div className={styles.detailValue}>
            {editing ? (
              <button
                type="button"
                className={styles.partnerBtn}
                onClick={() => setPartnerPickerOpen(true)}
              >
                {partnerName ?? t("payments.create.selectPartner", "Select partner")}
              </button>
            ) : (
              payment.partner_name ?? "—"
            )}
          </div>

          <div className={styles.detailLabel}>{t("payments.firm", "Enterprise")}</div>
          <div className={styles.detailValue}>
            {editing ? (
              <select
                value={firmId ?? ""}
                onChange={(event) =>
                  setFirmId(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">{t("payments.create.selectFirm", "Select enterprise")}</option>
                {firms.map((firm) => (
                  <option key={firm.id} value={firm.id}>
                    {firm.name}
                  </option>
                ))}
                {firmId != null && !firms.some((firm) => firm.id === firmId) ? (
                  <option value={firmId}>{payment.firm_name ?? `#${firmId}`}</option>
                ) : null}
              </select>
            ) : (
              payment.firm_name ?? "—"
            )}
          </div>

          <div className={styles.detailLabel}>{t("payments.paymentType", "Payment type")}</div>
          <div className={styles.detailValue}>
            {editing ? (
              <select
                value={paymentTypeId ?? ""}
                onChange={(event) =>
                  handlePaymentTypeChange(
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
              >
                <option value="">
                  {t("payments.create.selectPaymentType", "Select payment type")}
                </option>
                {paymentTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                    {type.currency?.code_chr ? ` (${type.currency.code_chr})` : ""}
                  </option>
                ))}
                {paymentTypeId != null &&
                !paymentTypes.some((type) => type.id === paymentTypeId) ? (
                  <option value={paymentTypeId}>
                    {payment.payment_type_name ?? `#${paymentTypeId}`}
                  </option>
                ) : null}
              </select>
            ) : (
              payment.payment_type_name ?? "—"
            )}
          </div>

          <div className={styles.detailLabel}>{t("payments.category", "Category")}</div>
          <div className={styles.detailValue}>
            {editing ? (
              <select
                value={categoryId ?? ""}
                onChange={(event) =>
                  setCategoryId(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">{t("payments.create.selectCategory", "Select category")}</option>
                {categorySelectOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            ) : (
              payment.category_name ?? "—"
            )}
          </div>

          <div className={styles.detailLabel}>{t("sales.table.attachedUser", "Attached user")}</div>
          <div>{payment.attached_user_name ?? "—"}</div>

          <div className={styles.detailLabel}>{t("payments.amount", "Amount")}</div>
          <div className={styles.detailValue}>
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
          <div className={styles.detailValue}>
            {editing ? (
              <input
                type="number"
                min="0"
                step="0.0001"
                value={exchangeRate}
                onChange={(event) => setExchangeRate(event.target.value)}
              />
            ) : (
              payment.exchange_rate ?? "—"
            )}
          </div>

          <div className={styles.detailLabel}>{t("payments.description", "Description")}</div>
          <div className={styles.detailValue}>
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
                  onClick={() => {
                    resetForm();
                    setEditing(false);
                  }}
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

      {token ? (
        <PartnerPickerModal
          open={partnerPickerOpen}
          onClose={() => setPartnerPickerOpen(false)}
          token={token}
          selectedPartnerId={partnerId}
          onSelect={(selected: Partner) => {
            setPartnerId(selected.id);
            setPartnerName(selected.name);
            setPartnerPickerOpen(false);
          }}
          onPartnersChanged={async () => undefined}
        />
      ) : null}
    </>
  );
}
