import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PartnerPickerModal } from "@/components/POS/PartnerPickerModal";
import { PaymentDateTimeField } from "@/components/Payments/PaymentDateTimeField";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import { createPayment } from "@/lib/payments-api";
import { fetchFirms } from "@/lib/partners-api";
import { loadPaymentTypes } from "@/lib/payment-service";
import { fromDatetimeRuValue, nowDatetimeRuValue } from "@/lib/stock-doc-form";
import { formatAuthError, useAuth } from "@/store/auth";
import type { PaymentDirection, PaymentDocument } from "@/types/payments";
import type { Partner } from "@/types/partners";
import styles from "./Payments.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (payment: PaymentDocument) => void;
  initialDirection?: PaymentDirection;
};

export function PaymentCreateModal({
  open,
  onClose,
  onCreated,
  initialDirection = "income",
}: Props) {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const companyId = useAuth((s) => s.user?.company_id ?? null);

  const [direction, setDirection] = useState<PaymentDirection>(initialDirection);
  const [dateTimeValue, setDateTimeValue] = useState(nowDatetimeRuValue);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [firmId, setFirmId] = useState<number | null>(null);
  const [paymentTypeId, setPaymentTypeId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [description, setDescription] = useState("");
  const [partnerPickerOpen, setPartnerPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { data: firms = [] } = useQuery({
    queryKey: ["firms", token],
    queryFn: async () => {
      if (!token) return [];
      const response = await fetchFirms(token);
      return response.firms;
    },
    enabled: open && Boolean(token),
  });

  const { data: paymentTypesData } = useQuery({
    queryKey: ["payment-types", token, companyId],
    queryFn: () => loadPaymentTypes(token as string, companyId),
    enabled: open && Boolean(token) && companyId != null,
  });
  const paymentTypes = paymentTypesData?.payment_types ?? [];

  const selectedPaymentType = useMemo(
    () => paymentTypes.find((type) => type.id === paymentTypeId) ?? null,
    [paymentTypeId, paymentTypes],
  );

  useEffect(() => {
    if (!open) return;
    setDirection(initialDirection);
    setDateTimeValue(nowDatetimeRuValue());
    setPartner(null);
    setAmount("");
    setDescription("");
    setError("");
    setFirmId(firms[0]?.id ?? null);
    setPaymentTypeId(paymentTypes[0]?.id ?? null);
    const rate = paymentTypes[0]?.currency?.exchange_rate;
    setExchangeRate(rate != null ? String(rate) : "");
  }, [firms, initialDirection, open, paymentTypes]);

  useEffect(() => {
    if (!selectedPaymentType) return;
    const rate = selectedPaymentType.currency?.exchange_rate;
    setExchangeRate(rate != null ? String(rate) : "");
  }, [selectedPaymentType]);

  const canSubmit =
    Boolean(token) &&
    partner != null &&
    firmId != null &&
    paymentTypeId != null &&
    Number(amount) > 0 &&
    !submitting;

  const handleSubmit = async () => {
    if (!token || !partner || firmId == null || paymentTypeId == null) return;
    const parsedAmount = Number(amount);
    if (!(parsedAmount > 0)) {
      setError(t("payments.create.invalidAmount", "Enter a valid amount."));
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
    setSubmitting(true);
    setError("");
    try {
      const parsedRate = Number(exchangeRate);
      const payment = await createPayment(token, {
        firm_id: firmId,
        partner_id: partner.id,
        direction,
        payment_type_id: paymentTypeId,
        amount: parsedAmount,
        exchange_rate: Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : undefined,
        description: description.trim() || undefined,
        date,
      });
      toast.success(t("payments.create.success", "Payment created."));
      onCreated(payment);
      onClose();
    } catch (err: unknown) {
      setError(formatAuthError(err, t("payments.create.error", "Failed to create payment.")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t("payments.create.title", "New payment")}
        size="md"
      >
        <div className={styles.form}>
          <div className={styles.field}>
            <label>{t("payments.direction", "Direction")}</label>
            <select
              value={direction}
              onChange={(event) => setDirection(event.target.value as PaymentDirection)}
            >
              <option value="income">{t("payments.income", "Income")}</option>
              <option value="outcome">{t("payments.outcome", "Outcome")}</option>
            </select>
          </div>

          <PaymentDateTimeField
            label={t("payments.table.date", "Date")}
            value={dateTimeValue}
            onChange={setDateTimeValue}
          />

          <div className={styles.field}>
            <label>{t("payments.partner", "Partner")}</label>
            <button
              type="button"
              className={styles.partnerBtn}
              onClick={() => setPartnerPickerOpen(true)}
            >
              {partner?.name ?? t("payments.create.selectPartner", "Select partner")}
            </button>
          </div>

          <div className={styles.field}>
            <label>{t("payments.firm", "Enterprise")}</label>
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
            </select>
          </div>

          <div className={styles.field}>
            <label>{t("payments.paymentType", "Payment type")}</label>
            <select
              value={paymentTypeId ?? ""}
              onChange={(event) =>
                setPaymentTypeId(event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">{t("payments.create.selectPaymentType", "Select payment type")}</option>
              {paymentTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                  {type.currency?.code_chr ? ` (${type.currency.code_chr})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label>{t("payments.amount", "Amount")}</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label>{t("payments.exchangeRate", "Exchange rate")}</label>
            <input
              type="number"
              min="0"
              step="0.0001"
              value={exchangeRate}
              onChange={(event) => setExchangeRate(event.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label>{t("payments.description", "Description")}</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}

          <div className={styles.formActions}>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
              {submitting
                ? t("payments.create.processing", "Creating…")
                : t("payments.create.submit", "Create payment")}
            </Button>
          </div>
        </div>
      </Modal>

      {token ? (
        <PartnerPickerModal
          open={partnerPickerOpen}
          onClose={() => setPartnerPickerOpen(false)}
          token={token}
          selectedPartnerId={partner?.id ?? null}
          onSelect={(selected) => {
            setPartner(selected);
            setPartnerPickerOpen(false);
          }}
          onPartnersChanged={async () => undefined}
        />
      ) : null}
    </>
  );
}
