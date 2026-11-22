import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PaymentCreateModal } from "@/components/Payments/PaymentCreateModal";
import { ShiftAddOperationModal } from "@/components/Shifts/ShiftAddOperationModal";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePermissions } from "@/hooks/use-permissions";
import { formatAmountWithCurrency } from "@/lib/checkout-payments";
import { formatDateTime } from "@/lib/format";
import { fetchPaymentTypes } from "@/lib/payment-api";
import { addShiftOperation, fetchCurrentShift } from "@/lib/shifts-api";
import { formatAuthError, useAuth } from "@/store/auth";
import type { RegosCurrencyOption } from "@/types/settings";
import type { Shift, ShiftOperationCreateRequest } from "@/types/shifts";
import styles from "./Shifts.module.css";

type CurrentShiftModalProps = {
  open: boolean;
  onClose: () => void;
};

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function currencyStub(code: string | null | undefined, id?: number | null): RegosCurrencyOption {
  return {
    id: id ?? 0,
    name: code || "",
    code_chr: code || null,
    exchange_rate: null,
  };
}

function money(
  value: string | number | null | undefined,
  code?: string | null,
  id?: number | null,
) {
  return formatAmountWithCurrency(toNumber(value), currencyStub(code, id));
}

function cashCurrenciesFromPaymentTypes(
  paymentTypes: Array<{ is_cash: boolean; currency?: RegosCurrencyOption | null }>,
): RegosCurrencyOption[] {
  const byId = new Map<number, RegosCurrencyOption>();
  for (const pt of paymentTypes) {
    if (!pt.is_cash || !pt.currency || typeof pt.currency.id !== "number") continue;
    if (pt.currency.id < 1) continue;
    byId.set(pt.currency.id, pt.currency);
  }
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

export function CurrentShiftModal({ open, onClose }: CurrentShiftModalProps) {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const { can } = usePermissions();
  const canCreatePayment = can("payments.create");
  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cashCurrencies, setCashCurrencies] = useState<RegosCurrencyOption[]>([]);
  const [opModal, setOpModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const current = await fetchCurrentShift(token);
      setShift(current);
    } catch (err) {
      setShift(null);
      setError(formatAuthError(err) || t("shifts.loadError", "Failed to load shifts"));
    } finally {
      setLoading(false);
    }
  }, [t, token]);

  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchCurrentShift(token)
      .then((current) => {
        if (!cancelled) setShift(current);
      })
      .catch((err) => {
        if (!cancelled) {
          setShift(null);
          setError(
            formatAuthError(err) || t("shifts.loadError", "Failed to load shifts"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, t, token]);

  useEffect(() => {
    if (!open || !token) return;
    void fetchPaymentTypes(token)
      .then((res) => setCashCurrencies(cashCurrenciesFromPaymentTypes(res.payment_types)))
      .catch(() => setCashCurrencies([]));
  }, [open, token]);

  useEffect(() => {
    if (!open) {
      setOpModal(false);
      setPaymentModal(false);
    }
  }, [open]);

  const operationCurrencies = useMemo(() => {
    const byId = new Map<number, RegosCurrencyOption>();
    for (const c of cashCurrencies) byId.set(c.id, c);
    for (const row of shift?.currency_amounts ?? []) {
      if (!byId.has(row.currency_id)) {
        byId.set(row.currency_id, currencyStub(row.currency_code, row.currency_id));
      }
    }
    for (const row of shift?.expected_preview?.by_currency ?? []) {
      if (!byId.has(row.currency_id)) {
        byId.set(row.currency_id, currencyStub(row.currency_code, row.currency_id));
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.id - b.id);
  }, [cashCurrencies, shift?.currency_amounts, shift?.expected_preview?.by_currency]);

  const availableCashByCurrency = useMemo(
    () =>
      (shift?.expected_preview?.by_currency ?? []).map((row) => ({
        currency_id: row.currency_id,
        currency_code: row.currency_code,
        amount: toNumber(row.expected_amount),
      })),
    [shift?.expected_preview?.by_currency],
  );

  const handleAddOp = async (payload: ShiftOperationCreateRequest) => {
    if (!token || !shift) return;
    setSaving(true);
    setError("");
    try {
      const updated = await addShiftOperation(token, shift.id, payload);
      setShift(updated);
      setOpModal(false);
    } catch (err) {
      setError(formatAuthError(err) || t("shifts.saveError", "Failed to save shift"));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const detailRows =
    shift?.expected_preview?.by_currency?.length
      ? shift.expected_preview.by_currency.map((row) => ({
          currency_id: row.currency_id,
          currency_code: row.currency_code,
          start_amount: row.start_amount,
          expected_amount: row.expected_amount,
          actual_amount:
            shift.currency_amounts.find((a) => a.currency_id === row.currency_id)
              ?.actual_amount ?? null,
          difference_amount:
            shift.currency_amounts.find((a) => a.currency_id === row.currency_id)
              ?.difference_amount ?? null,
        }))
      : (shift?.currency_amounts ?? []);

  const isOpenShift = shift?.status === "open";

  return (
    <>
      <div className={styles.modalOverlay} onClick={onClose}>
        <div
          className={`${styles.modal} ${styles.modalWide}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.modalTitle}>
            {t("shifts.current", "Current shift")}
            {shift
              ? ` · ${shift.user_display_name || `#${shift.user_id}`}`
              : null}
          </div>

          {loading ? (
            <div className={styles.muted}>{t("common.loading", "Loading…")}</div>
          ) : error ? (
            <div className={styles.error}>{error}</div>
          ) : !shift ? (
            <div className={styles.muted}>
              {t("shifts.noOpen", "No open shift")}{" "}
              <Link to="/shifts">{t("shifts.openCta", "Open shift")}</Link>
            </div>
          ) : (
            <>
              <div className={styles.muted}>
                {t("shifts.openedAt", "Opened")}: {formatDateTime(shift.opened_at)}
              </div>
              <div className={styles.currencyBreakdown}>
                {detailRows.map((row) => (
                  <div key={row.currency_id} className={styles.currencyCard}>
                    <div className={styles.bannerTitle}>
                      {row.currency_code || `#${row.currency_id}`}
                    </div>
                    <div className={styles.detailGrid}>
                      <div className={styles.stat}>
                        <div className={styles.statLabel}>
                          {t("shifts.startAmount", "Starting cash")}
                        </div>
                        <div className={styles.statValue}>
                          {money(row.start_amount, row.currency_code, row.currency_id)}
                        </div>
                      </div>
                      <div className={styles.stat}>
                        <div className={styles.statLabel}>
                          {t("shifts.expectedAmount", "Expected cash")}
                        </div>
                        <div className={styles.statValue}>
                          {money(row.expected_amount, row.currency_code, row.currency_id)}
                        </div>
                      </div>
                      <div className={styles.stat}>
                        <div className={styles.statLabel}>
                          {t("shifts.actualAmount", "Actual cash counted")}
                        </div>
                        <div className={styles.statValue}>
                          {row.actual_amount != null
                            ? money(row.actual_amount, row.currency_code, row.currency_id)
                            : "—"}
                        </div>
                      </div>
                      <div className={styles.stat}>
                        <div className={styles.statLabel}>
                          {t("shifts.difference", "Difference")}
                        </div>
                        <div className={styles.statValue}>
                          {row.difference_amount != null
                            ? money(row.difference_amount, row.currency_code, row.currency_id)
                            : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <div className={styles.bannerTitle}>{t("shifts.operations", "Operations")}</div>
                <div className={styles.opsList}>
                  {shift.operations.length === 0 ? (
                    <div className={styles.muted}>—</div>
                  ) : (
                    shift.operations.map((op) => (
                      <div key={op.id} className={styles.opRow}>
                        <div>
                          {t(`shifts.ops.${op.operation_type}`, op.operation_type)}
                          {op.note ? ` · ${op.note}` : ""}
                          <div className={styles.muted}>{formatDateTime(op.created_at)}</div>
                        </div>
                        <div>{money(op.amount, op.currency_code, op.currency_id)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          <div className={styles.modalActions}>
            {isOpenShift ? (
              <>
                <Button type="button" variant="secondary" onClick={() => setOpModal(true)}>
                  {t("shifts.addOperation", "Add operation")}
                </Button>
                {canCreatePayment ? (
                  <Button type="button" variant="secondary" onClick={() => setPaymentModal(true)}>
                    {t("payments.create.button", "New payment")}
                  </Button>
                ) : null}
              </>
            ) : null}
            <Link to="/shifts">
              <Button type="button" variant="secondary">
                {t("shifts.title", "Cash shifts")}
              </Button>
            </Link>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t("common.close", "Close")}
            </Button>
          </div>
        </div>
      </div>

      {shift && isOpenShift ? (
        <ShiftAddOperationModal
          open={opModal}
          currencies={operationCurrencies}
          saving={saving}
          onClose={() => setOpModal(false)}
          onSubmit={handleAddOp}
        />
      ) : null}

      {canCreatePayment && shift && isOpenShift ? (
        <PaymentCreateModal
          open={paymentModal}
          onClose={() => setPaymentModal(false)}
          initialDirection="outcome"
          initialFirmId={shift.firm_id}
          cashPaymentTypesOnly
          availableCashByCurrency={availableCashByCurrency}
          onCreated={() => {
            void reload();
          }}
        />
      ) : null}
    </>
  );
}
