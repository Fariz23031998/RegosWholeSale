import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  currencyLabel,
  paymentAmountFromSaleAmount,
  sameCurrency,
} from "@/lib/currency-conversion";
import { formatCurrency } from "@/lib/format";
import type { PartnerDebtSummary } from "@/lib/partner-balance";
import { payPartnerDebt } from "@/lib/partners-api";
import { loadPaymentTypes } from "@/lib/payment-service";
import { formatAuthError, useAuth } from "@/store/auth";
import type { PaymentType } from "@/types/payment";
import type { RegosCurrencyOption } from "@/types/settings";
import styles from "./POS.module.css";

type PaymentMode = "per_currency" | "single_currency";

type DebtPaymentEntry = {
  id: string;
  amount: string;
  paymentTypeId: number;
};

type DebtGroupState = {
  key: string;
  currencyId: number;
  currencyName: string;
  currencyCode: string | null;
  exchangeRate: number | null;
  debtAmount: number;
  payableAmount: number;
  payments: DebtPaymentEntry[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  token: string;
  partnerId: number;
  partnerName: string;
  firmId: number;
  firmName?: string;
  debtSummary: PartnerDebtSummary;
  baseCurrency?: RegosCurrencyOption | null;
};

let paymentEntrySeq = 0;
function nextPaymentEntryId(): string {
  paymentEntrySeq += 1;
  return `pay-${paymentEntrySeq}`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseAmount(value: string): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function pickPaymentTypeForCurrency(
  paymentTypes: PaymentType[],
  currencyId: number,
  preferredId?: number,
): PaymentType | null {
  if (preferredId != null) {
    const preferred = paymentTypes.find((type) => type.id === preferredId);
    if (preferred) return preferred;
  }
  const matching = paymentTypes.find((type) => type.currency?.id === currencyId);
  if (matching) return matching;
  return paymentTypes.find((type) => type.is_cash) ?? paymentTypes[0] ?? null;
}

function groupPaidTotal(group: DebtGroupState): number {
  return roundMoney(group.payments.reduce((sum, entry) => sum + parseAmount(entry.amount), 0));
}

export function PartnerPayDebtModal({
  open,
  onClose,
  onSuccess,
  token,
  partnerId,
  partnerName,
  firmId,
  firmName,
  debtSummary,
  baseCurrency = null,
}: Props) {
  const { t } = useLanguage();
  const companyId = useAuth((s) => s.user?.company_id ?? null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("per_currency");
  const [singlePaymentTypeId, setSinglePaymentTypeId] = useState<number | null>(null);
  const [groups, setGroups] = useState<DebtGroupState[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const paymentTypesQuery = useQuery({
    queryKey: ["payment-types", token, companyId],
    queryFn: () => loadPaymentTypes(token, companyId),
    enabled: open && Boolean(token),
  });
  const paymentTypes = paymentTypesQuery.data?.payment_types ?? [];

  useEffect(() => {
    if (!open) return;
    setPaymentMode("per_currency");
    setError("");
    setSubmitting(false);
  }, [open]);

  useEffect(() => {
    if (!open || paymentTypes.length === 0) return;

    const nextGroups: DebtGroupState[] = debtSummary.debts
      .filter((debt) => debt.currencyId != null && debt.amount > 0)
      .map((debt) => {
        const currencyId = debt.currencyId as number;
        const type = pickPaymentTypeForCurrency(paymentTypes, currencyId);
        const payable = debtSummary.payableByKey[debt.key] ?? debt.amount;
        return {
          key: debt.key,
          currencyId,
          currencyName: debt.currency?.name ?? String(currencyId),
          currencyCode: debt.currency?.code_chr ?? null,
          exchangeRate: debt.currency?.exchange_rate ?? null,
          debtAmount: debt.amount,
          payableAmount: payable,
          payments: [
            {
              id: nextPaymentEntryId(),
              // Leave empty so partial payment is explicit — not pre-filled to full debt.
              amount: "",
              paymentTypeId: type?.id ?? 0,
            },
          ],
        };
      })
      .filter((group) => group.payableAmount > 0);

    setGroups(nextGroups);

    const firstType = paymentTypes.find((type) => type.is_cash) ?? paymentTypes[0] ?? null;
    setSinglePaymentTypeId(firstType?.id ?? null);
  }, [open, debtSummary, paymentTypes]);

  const singlePaymentType = useMemo(
    () => paymentTypes.find((type) => type.id === singlePaymentTypeId) ?? null,
    [paymentTypes, singlePaymentTypeId],
  );

  const updatePayment = (
    groupKey: string,
    paymentId: string,
    patch: Partial<DebtPaymentEntry>,
  ) => {
    setGroups((current) =>
      current.map((group) => {
        if (group.key !== groupKey) return group;
        return {
          ...group,
          payments: group.payments.map((payment) =>
            payment.id === paymentId ? { ...payment, ...patch } : payment,
          ),
        };
      }),
    );
  };

  const addPayment = (groupKey: string) => {
    setGroups((current) =>
      current.map((group) => {
        if (group.key !== groupKey) return group;
        const usedIds = new Set(group.payments.map((payment) => payment.paymentTypeId));
        const unused =
          paymentTypes.find((type) => !usedIds.has(type.id)) ??
          pickPaymentTypeForCurrency(paymentTypes, group.currencyId);
        const remaining = Math.max(0, roundMoney(group.debtAmount - groupPaidTotal(group)));
        return {
          ...group,
          payments: [
            ...group.payments,
            {
              id: nextPaymentEntryId(),
              amount: remaining > 0 ? String(remaining) : "",
              paymentTypeId: unused?.id ?? 0,
            },
          ],
        };
      }),
    );
  };

  const removePayment = (groupKey: string, paymentId: string) => {
    setGroups((current) =>
      current.map((group) => {
        if (group.key !== groupKey || group.payments.length <= 1) return group;
        return {
          ...group,
          payments: group.payments.filter((payment) => payment.id !== paymentId),
        };
      }),
    );
  };

  const fillSuggested = (groupKey: string, paymentId: string) => {
    setGroups((current) =>
      current.map((group) => {
        if (group.key !== groupKey) return group;
        const otherPaid = roundMoney(
          group.payments.reduce((sum, payment) => {
            if (payment.id === paymentId) return sum;
            return sum + parseAmount(payment.amount);
          }, 0),
        );
        const suggested = Math.max(
          0,
          roundMoney(Math.min(group.payableAmount, group.debtAmount) - otherPaid),
        );
        return {
          ...group,
          payments: group.payments.map((payment) =>
            payment.id === paymentId
              ? { ...payment, amount: suggested > 0 ? String(suggested) : "" }
              : payment,
          ),
        };
      }),
    );
  };

  const canSubmit = useMemo(() => {
    if (submitting || paymentTypes.length === 0 || groups.length === 0) return false;
    if (paymentMode === "single_currency" && !singlePaymentTypeId) return false;

    let hasPositive = false;
    for (const group of groups) {
      if (groupPaidTotal(group) > group.debtAmount + 0.001) return false;

      const entries =
        paymentMode === "single_currency"
          ? group.payments.slice(0, 1)
          : group.payments;

      for (const entry of entries) {
        const amount = parseAmount(entry.amount);
        if (amount < 0) return false;
        if (amount <= 0) continue;
        const typeId =
          paymentMode === "single_currency" ? singlePaymentTypeId : entry.paymentTypeId;
        if (!typeId) return false;
        hasPositive = true;
      }
    }
    return hasPositive;
  }, [groups, paymentMode, paymentTypes.length, singlePaymentTypeId, submitting]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const payments = groups.flatMap((group) => {
        const entries =
          paymentMode === "single_currency" ? group.payments.slice(0, 1) : group.payments;
        return entries
          .map((entry) => {
            const amount = roundMoney(parseAmount(entry.amount));
            if (amount <= 0) return null;
            const paymentTypeId =
              paymentMode === "single_currency"
                ? (singlePaymentTypeId as number)
                : entry.paymentTypeId;
            return {
              currency_id: group.currencyId,
              amount,
              payment_type_id: paymentTypeId,
              exchange_rate: group.exchangeRate,
              currency_name: group.currencyName,
              currency_code: group.currencyCode,
            };
          })
          .filter((line): line is NonNullable<typeof line> => line != null);
      });

      if (payments.length === 0) {
        setError(t("partners.balance.payDebt.noAmount", "Enter a payment amount."));
        return;
      }

      for (const group of groups) {
        const paid = payments
          .filter((payment) => payment.currency_id === group.currencyId)
          .reduce((sum, payment) => sum + payment.amount, 0);
        if (roundMoney(paid) > group.debtAmount + 0.001) {
          setError(
            t(
              "partners.balance.payDebt.exceedsDebt",
              "Payment exceeds debt for {{currency}}.",
              { currency: group.currencyName },
            ),
          );
          return;
        }
      }

      await payPartnerDebt(token, partnerId, {
        firm_id: firmId,
        payments,
      });
      toast.success(
        t("partners.balance.payDebt.success", "Payment recorded."),
      );
      onSuccess();
      onClose();
    } catch (err) {
      const message = formatAuthError(
        err,
        t("partners.balance.payDebt.error", "Failed to take payment."),
      );
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const title = t("partners.balance.payDebt.title", "Take a payment — {{name}}", {
    name: partnerName,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      elevated
      overlayClassName={styles.partnerBalanceOverlay}
      modalClassName={styles.partnerPayDebtModal}
      bodyClassName={styles.partnerPayDebtBody}
    >
      {firmName ? (
        <p className={styles.partnerBalanceSubtitle}>
          {t("partners.balance.firm", "Enterprise")}: {firmName}
        </p>
      ) : null}

      <div className={styles.partnerPayDebtOffsetSummary}>
        <div>
          {t("partners.balance.debtTotalBase", "Total debt")}:{" "}
          <strong>
            {formatCurrency(debtSummary.grossDebtBase)}
            {baseCurrency ? ` ${currencyLabel(baseCurrency)}` : ""}
          </strong>
        </div>
        {debtSummary.creditBase > 0 ? (
          <>
            <div>
              {t("partners.balance.creditOffsetBase", "Credit offset")}:{" "}
              <strong>
                {formatCurrency(debtSummary.creditBase)}
                {baseCurrency ? ` ${currencyLabel(baseCurrency)}` : ""}
              </strong>
            </div>
            {debtSummary.credits.length > 0 ? (
              <ul className={styles.partnerPayDebtCreditList}>
                {debtSummary.credits.map((credit) => (
                  <li key={credit.key}>
                    {formatCurrency(credit.amount)}
                    {credit.currency ? ` ${currencyLabel(credit.currency)}` : ""}
                    {" ≈ "}
                    {formatCurrency(credit.amountBase)}
                    {baseCurrency ? ` ${currencyLabel(baseCurrency)}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={styles.partnerDebtNet}>
              {t("partners.balance.netDebtBase", "Net to pay")}:{" "}
              {formatCurrency(debtSummary.netDebtBase)}
              {baseCurrency ? ` ${currencyLabel(baseCurrency)}` : ""}
            </div>
            <p className={styles.partnerPayDebtOffsetHint}>
              {t(
                "partners.balance.payDebt.creditOffsetHint",
                "Negative balances in other currencies (firm debt) reduce the suggested payment amounts.",
              )}
            </p>
          </>
        ) : null}
        <p className={styles.partnerPayDebtOffsetHint}>
          {t(
            "partners.balance.payDebt.partialHint",
            "You can take any amount up to the debt. Full payment is not required.",
          )}
        </p>
      </div>

      <div className={styles.partnerPayDebtModes} role="group">
        <button
          type="button"
          className={
            paymentMode === "per_currency"
              ? styles.partnerPayDebtModeActive
              : styles.partnerPayDebtMode
          }
          onClick={() => setPaymentMode("per_currency")}
        >
          {t("partners.balance.payDebt.modePerCurrency", "Per currency")}
        </button>
        <button
          type="button"
          className={
            paymentMode === "single_currency"
              ? styles.partnerPayDebtModeActive
              : styles.partnerPayDebtMode
          }
          onClick={() => setPaymentMode("single_currency")}
        >
          {t("partners.balance.payDebt.modeSingleCurrency", "One currency")}
        </button>
      </div>

      {paymentMode === "single_currency" ? (
        <label className={styles.partnerPayDebtField}>
          <span>{t("partners.balance.payDebt.paymentType", "Payment type")}</span>
          <select
            value={singlePaymentTypeId ?? ""}
            onChange={(event) =>
              setSinglePaymentTypeId(event.target.value ? Number(event.target.value) : null)
            }
            disabled={paymentTypesQuery.isPending || paymentTypes.length === 0}
          >
            {paymentTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
                {type.currency ? ` (${currencyLabel(type.currency)})` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {paymentTypesQuery.isPending ? (
        <div className={styles.partnerBalanceEmpty}>
          {t("checkout.loadingTypes", "Loading payment types…")}
        </div>
      ) : paymentTypes.length === 0 ? (
        <div className={styles.partnerModalError}>
          {t("checkout.noPaymentTypes", "No payment types configured in Regos.")}
        </div>
      ) : groups.length === 0 ? (
        <div className={styles.partnerBalanceEmpty}>
          {debtSummary.debts.length > 0 && debtSummary.netDebtBase <= 0
            ? t(
                "partners.balance.payDebt.fullyCovered",
                "Firm debt balances cover the partner debt.",
              )
            : t("partners.balance.payDebt.noDebt", "No debt to collect.")}
        </div>
      ) : (
        <div className={styles.partnerPayDebtLines}>
          {groups.map((group) => {
            const debtCurrency = {
              id: group.currencyId,
              name: group.currencyName,
              code_chr: group.currencyCode ?? undefined,
              exchange_rate: group.exchangeRate ?? undefined,
            };
            const paid = groupPaidTotal(group);
            const remaining = Math.max(0, roundMoney(group.debtAmount - paid));
            const offsetApplied = group.payableAmount < group.debtAmount - 0.001;
            const entries =
              paymentMode === "single_currency" ? group.payments.slice(0, 1) : group.payments;

            return (
              <div key={group.key} className={styles.partnerPayDebtLine}>
                <div className={styles.partnerPayDebtLineHeader}>
                  <strong>{group.currencyName}</strong>
                  <span>
                    {t("partners.balance.payDebt.owed", "Owed")}:{" "}
                    {formatCurrency(group.debtAmount)} {currencyLabel(debtCurrency)}
                    {offsetApplied
                      ? ` → ${formatCurrency(group.payableAmount)} ${currencyLabel(debtCurrency)}`
                      : ""}
                  </span>
                </div>

                <div className={styles.partnerPayDebtPayments}>
                  {entries.map((entry) => {
                    const lineType =
                      paymentMode === "single_currency"
                        ? singlePaymentType
                        : (paymentTypes.find((type) => type.id === entry.paymentTypeId) ??
                          null);
                    const amountNum = parseAmount(entry.amount);
                    const converted =
                      lineType?.currency &&
                      amountNum > 0 &&
                      !sameCurrency(debtCurrency, lineType.currency)
                        ? paymentAmountFromSaleAmount(
                            amountNum,
                            debtCurrency,
                            lineType.currency,
                          )
                        : null;

                    return (
                      <div key={entry.id} className={styles.partnerPayDebtPayment}>
                        <div className={styles.partnerPayDebtLineFields}>
                          <label className={styles.partnerPayDebtField}>
                            <span>{t("partners.balance.payDebt.amount", "Amount")}</span>
                            <input
                              type="number"
                              min={0}
                              max={group.debtAmount}
                              step="0.01"
                              value={entry.amount}
                              placeholder="0.00"
                              onChange={(event) =>
                                updatePayment(group.key, entry.id, {
                                  amount: event.target.value,
                                })
                              }
                            />
                          </label>
                          {paymentMode === "per_currency" ? (
                            <label className={styles.partnerPayDebtField}>
                              <span>
                                {t("partners.balance.payDebt.paymentType", "Payment type")}
                              </span>
                              <select
                                value={entry.paymentTypeId || ""}
                                onChange={(event) =>
                                  updatePayment(group.key, entry.id, {
                                    paymentTypeId: event.target.value
                                      ? Number(event.target.value)
                                      : 0,
                                  })
                                }
                              >
                                {paymentTypes.map((type) => (
                                  <option key={type.id} value={type.id}>
                                    {type.name}
                                    {type.currency
                                      ? ` (${currencyLabel(type.currency)})`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          <div className={styles.partnerPayDebtPaymentActions}>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => fillSuggested(group.key, entry.id)}
                            >
                              {t("partners.balance.payDebt.fillSuggested", "Suggested")}
                            </Button>
                            {paymentMode === "per_currency" && group.payments.length > 1 ? (
                              <button
                                type="button"
                                className={styles.partnerPayDebtRemove}
                                onClick={() => removePayment(group.key, entry.id)}
                                aria-label={t(
                                  "partners.balance.payDebt.removePayment",
                                  "Remove payment",
                                )}
                              >
                                <Trash2 size={16} />
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {converted != null && lineType?.currency ? (
                          <p className={styles.partnerPayDebtConverted}>
                            {t(
                              "partners.balance.payDebt.converted",
                              "≈ {{amount}} in payment currency",
                              {
                                amount: `${formatCurrency(converted)} ${currencyLabel(lineType.currency)}`,
                              },
                            )}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {paymentMode === "per_currency" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => addPayment(group.key)}
                    disabled={remaining <= 0.001}
                  >
                    <Plus size={14} />
                    {t("partners.balance.payDebt.addPayment", "Add payment")}
                  </Button>
                ) : null}

                <div className={styles.partnerPayDebtSummary}>
                  <span>
                    {t("partners.balance.payDebt.payingNow", "Taking now")}:{" "}
                    {formatCurrency(paid)} {currencyLabel(debtCurrency)}
                  </span>
                  <span>
                    {t("partners.balance.payDebt.remaining", "Remaining")}:{" "}
                    {formatCurrency(remaining)} {currencyLabel(debtCurrency)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error ? <div className={styles.partnerModalError}>{error}</div> : null}

      <div className={styles.partnerPayDebtActions}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
          {submitting
            ? t("partners.balance.payDebt.processing", "Processing…")
            : t("partners.balance.payDebt.confirm", "Take a payment")}
        </Button>
      </div>
    </Modal>
  );
}
