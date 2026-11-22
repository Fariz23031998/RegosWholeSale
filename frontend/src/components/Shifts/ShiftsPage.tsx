import { useCallback, useEffect, useMemo, useState } from "react";
import { PaymentCreateModal } from "@/components/Payments/PaymentCreateModal";
import { ShiftAddOperationModal } from "@/components/Shifts/ShiftAddOperationModal";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePermissions } from "@/hooks/use-permissions";
import { formatAmountWithCurrency } from "@/lib/checkout-payments";
import { formatDateTime } from "@/lib/format";
import { fetchPaymentTypes } from "@/lib/payment-api";
import {
  addShiftOperation,
  closeShift,
  fetchCurrentShift,
  fetchEmployeeDebt,
  fetchShift,
  fetchShifts,
  openShift,
} from "@/lib/shifts-api";
import { fetchUsers } from "@/lib/users-api";
import { formatAuthError, useAuth } from "@/store/auth";
import type { RegosCurrencyOption } from "@/types/settings";
import type { UserDetail } from "@/types/users";
import {
  type Shift,
  type ShiftCurrencyAmount,
  type ShiftExpectedCurrencyBreakdown,
  type ShiftOperationCreateRequest,
  type ShiftStatus,
} from "@/types/shifts";
import styles from "./Shifts.module.css";

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

function money(value: string | number | null | undefined, code?: string | null, id?: number | null) {
  return formatAmountWithCurrency(toNumber(value), currencyStub(code, id));
}

function formatAmountLines(
  rows: Array<{
    amount: string | number | null | undefined;
    currency_code?: string | null;
    currency_id?: number | null;
  }>,
): string {
  const parts = rows
    .filter((row) => row.amount != null)
    .map((row) => money(row.amount, row.currency_code, row.currency_id));
  return parts.length ? parts.join(" · ") : "—";
}

function formatCurrencyAmounts(
  amounts: ShiftCurrencyAmount[],
  field: "start_amount" | "expected_amount" | "actual_amount" | "difference_amount",
): string {
  return formatAmountLines(
    amounts.map((row) => ({
      amount: row[field],
      currency_code: row.currency_code,
      currency_id: row.currency_id,
    })),
  );
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

export function ShiftsPage() {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const me = useAuth((s) => s.user);
  const { can, canAny } = usePermissions();
  const canAccess = canAny("shifts.manage", "shifts.manage_own");
  const isMaster = can("shifts.manage");
  const canCreatePayment = can("payments.create");

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [current, setCurrent] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<ShiftStatus | "">("");
  const [employeeFilter, setEmployeeFilter] = useState<number | "">("");
  const [users, setUsers] = useState<UserDetail[]>([]);
  const [debtLabel, setDebtLabel] = useState("");
  const [cashCurrencies, setCashCurrencies] = useState<RegosCurrencyOption[]>([]);

  const [openModal, setOpenModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [opModal, setOpModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [detail, setDetail] = useState<Shift | null>(null);

  const [openAmounts, setOpenAmounts] = useState<Record<number, string>>({});
  const [openNotes, setOpenNotes] = useState("");
  const [openForUserId, setOpenForUserId] = useState<number | "">("");
  const [closeAmounts, setCloseAmounts] = useState<Record<number, string>>({});
  const [closeNotes, setCloseNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const formatDebt = useCallback(
    (rows: Array<{ amount: string | number; currency_code: string | null; currency_id: number }>) => {
      if (!rows.length) return "";
      return `${t("shifts.outstandingDebt", "Outstanding debt")}: ${formatAmountLines(
        rows.map((row) => ({
          amount: row.amount,
          currency_code: row.currency_code,
          currency_id: row.currency_id,
        })),
      )}`;
    },
    [t],
  );

  const reload = useCallback(async () => {
    if (!token || !canAccess) return;
    setLoading(true);
    setError("");
    try {
      const [list, cur] = await Promise.all([
        fetchShifts(token, {
          status: statusFilter || null,
          user_id: employeeFilter === "" ? null : employeeFilter,
          limit: 100,
        }),
        fetchCurrentShift(token).catch(() => null),
      ]);
      setShifts(list.shifts);
      setCurrent(cur);
      if (isMaster && employeeFilter !== "") {
        const debt = await fetchEmployeeDebt(token, employeeFilter);
        setDebtLabel(formatDebt(debt.outstanding_debt_by_currency));
      } else if (!isMaster && me?.id) {
        const debt = await fetchEmployeeDebt(token, me.id).catch(() => null);
        setDebtLabel(debt ? formatDebt(debt.outstanding_debt_by_currency) : "");
      } else {
        setDebtLabel("");
      }
    } catch (err) {
      setError(formatAuthError(err) || t("shifts.loadError", "Failed to load shifts"));
    } finally {
      setLoading(false);
    }
  }, [canAccess, employeeFilter, formatDebt, isMaster, me?.id, statusFilter, t, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!token || !isMaster) return;
    void fetchUsers(token)
      .then((res) => setUsers(res))
      .catch(() => setUsers([]));
  }, [isMaster, token]);

  useEffect(() => {
    if (!token || !canAccess) return;
    void fetchPaymentTypes(token)
      .then((res) => {
        const currencies = cashCurrenciesFromPaymentTypes(res.payment_types);
        setCashCurrencies(currencies);
        setOpenAmounts((prev) => {
          const next: Record<number, string> = {};
          for (const c of currencies) {
            next[c.id] = prev[c.id] ?? "0";
          }
          return next;
        });
      })
      .catch(() => setCashCurrencies([]));
  }, [canAccess, token]);

  const activeShift = detail?.status === "open" ? detail : current;

  const expectedPreview = useMemo(() => {
    const preview = detail?.expected_preview || current?.expected_preview;
    return preview ?? null;
  }, [current?.expected_preview, detail?.expected_preview]);

  const operationCurrencies = useMemo(() => {
    const byId = new Map<number, RegosCurrencyOption>();
    for (const c of cashCurrencies) byId.set(c.id, c);
    for (const row of activeShift?.currency_amounts ?? []) {
      if (!byId.has(row.currency_id)) {
        byId.set(row.currency_id, currencyStub(row.currency_code, row.currency_id));
      }
    }
    for (const row of expectedPreview?.by_currency ?? []) {
      if (!byId.has(row.currency_id)) {
        byId.set(row.currency_id, currencyStub(row.currency_code, row.currency_id));
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.id - b.id);
  }, [activeShift?.currency_amounts, cashCurrencies, expectedPreview?.by_currency]);

  const availableCashByCurrency = useMemo(
    () =>
      (activeShift?.expected_preview?.by_currency ?? []).map((row) => ({
        currency_id: row.currency_id,
        currency_code: row.currency_code,
        amount: toNumber(row.expected_amount),
      })),
    [activeShift?.expected_preview?.by_currency],
  );

  const beginClose = (shift: Shift) => {
    const previewRows = shift.expected_preview?.by_currency ?? [];
    const rows: ShiftExpectedCurrencyBreakdown[] =
      previewRows.length > 0
        ? previewRows
        : shift.currency_amounts.map((row) => ({
            currency_id: row.currency_id,
            currency_code: row.currency_code,
            start_amount: row.start_amount,
            cash_from_docs: 0,
            ops_net: 0,
            expected_amount: row.start_amount,
          }));
    const next: Record<number, string> = {};
    for (const row of rows) {
      next[row.currency_id] = String(toNumber(row.expected_amount));
    }
    setCloseAmounts(next);
    setDetail(shift);
    setCloseModal(true);
  };

  const handleOpen = async () => {
    if (!token) return;
    const amounts = cashCurrencies.map((c) => ({
      currency_id: c.id,
      amount: toNumber(openAmounts[c.id] ?? "0"),
    }));
    if (!amounts.length) {
      setError(t("shifts.noCashCurrencies", "No cash currencies available."));
      return;
    }
    if (amounts.some((row) => row.amount < 0 || !Number.isFinite(row.amount))) return;
    setSaving(true);
    setError("");
    try {
      await openShift(token, {
        amounts,
        notes: openNotes.trim() || null,
        user_id: openForUserId === "" ? null : openForUserId,
      });
      setOpenModal(false);
      setOpenNotes("");
      setOpenForUserId("");
      setOpenAmounts(Object.fromEntries(cashCurrencies.map((c) => [c.id, "0"])));
      await reload();
    } catch (err) {
      setError(formatAuthError(err) || t("shifts.saveError", "Failed to save shift"));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async () => {
    if (!token || !activeShift) return;
    const amounts = Object.entries(closeAmounts).map(([currencyId, value]) => ({
      currency_id: Number(currencyId),
      amount: toNumber(value),
    }));
    if (!amounts.length || amounts.some((row) => row.amount < 0 || !Number.isFinite(row.amount))) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await closeShift(token, activeShift.id, {
        amounts,
        notes: closeNotes.trim() || null,
      });
      setCloseModal(false);
      setCloseAmounts({});
      setCloseNotes("");
      setDetail(null);
      await reload();
    } catch (err) {
      setError(formatAuthError(err) || t("shifts.saveError", "Failed to save shift"));
    } finally {
      setSaving(false);
    }
  };

  const handleAddOp = async (payload: ShiftOperationCreateRequest) => {
    if (!token || !activeShift) return;
    setSaving(true);
    setError("");
    try {
      const updated = await addShiftOperation(token, activeShift.id, payload);
      setOpModal(false);
      setDetail(updated);
      await reload();
    } catch (err) {
      setError(formatAuthError(err) || t("shifts.saveError", "Failed to save shift"));
    } finally {
      setSaving(false);
    }
  };

  const handlePaymentCreated = async () => {
    if (!token || !activeShift) {
      await reload();
      return;
    }
    try {
      const updated = await fetchShift(token, activeShift.id);
      setDetail(updated);
    } catch {
      // Still refresh list/current even if detail fetch fails.
    }
    await reload();
  };

  const openDetail = async (shift: Shift) => {
    if (!token) return;
    try {
      const full = await fetchShift(token, shift.id);
      setDetail(full);
    } catch (err) {
      setError(formatAuthError(err) || t("shifts.loadError", "Failed to load shifts"));
    }
  };

  if (!canAccess) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>{t("common.forbidden", "You do not have access.")}</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>{t("shifts.title", "Cash shifts")}</div>
          <div className={styles.subtitle}>
            {t(
              "shifts.subtitle",
              "Open and close cash shifts, record till operations, and review differences.",
            )}
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            type="button"
            onClick={() => setOpenModal(true)}
            disabled={Boolean(current) && !isMaster}
          >
            {t("shifts.open", "Open shift")}
          </Button>
        </div>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {debtLabel ? <div className={styles.muted}>{debtLabel}</div> : null}

      {current ? (
        <div className={styles.banner}>
          <div className={styles.bannerMeta}>
            <div className={styles.bannerTitle}>{t("shifts.current", "Current shift")}</div>
            <div className={styles.bannerDesc}>
              {t("shifts.startAmount", "Starting cash")}:{" "}
              {formatCurrencyAmounts(current.currency_amounts, "start_amount")} ·{" "}
              {t("shifts.openedAt", "Opened")}: {formatDateTime(current.opened_at)}
              {expectedPreview
                ? ` · ${t("shifts.expectedAmount", "Expected cash")}: ${formatAmountLines(
                    expectedPreview.by_currency.map((row) => ({
                      amount: row.expected_amount,
                      currency_code: row.currency_code,
                      currency_id: row.currency_id,
                    })),
                  )}`
                : null}
            </div>
          </div>
          <div className={styles.headerActions}>
            <Button type="button" variant="secondary" onClick={() => setOpModal(true)}>
              {t("shifts.addOperation", "Add operation")}
            </Button>
            {canCreatePayment ? (
              <Button type="button" variant="secondary" onClick={() => setPaymentModal(true)}>
                {t("payments.create.button", "New payment")}
              </Button>
            ) : null}
            <Button type="button" onClick={() => beginClose(current)}>
              {t("shifts.close", "Close shift")}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.banner}>
          <div className={styles.bannerMeta}>
            <div className={styles.bannerTitle}>{t("shifts.noOpen", "No open shift")}</div>
            <div className={styles.bannerDesc}>
              {t("shifts.requiredBanner", "Open a cash shift before checkout.")}
            </div>
          </div>
        </div>
      )}

      <div className={styles.filters}>
        <select
          className={styles.select}
          value={statusFilter}
          onChange={(e) => setStatusFilter((e.target.value || "") as ShiftStatus | "")}
        >
          <option value="">{t("shifts.filterStatus", "Status")}</option>
          <option value="open">{t("shifts.status.open", "Open")}</option>
          <option value="closed">{t("shifts.status.closed", "Closed")}</option>
        </select>
        {isMaster ? (
          <select
            className={styles.select}
            value={employeeFilter === "" ? "" : String(employeeFilter)}
            onChange={(e) =>
              setEmployeeFilter(e.target.value ? Number(e.target.value) : "")
            }
          >
            <option value="">{t("shifts.filterEmployee", "All employees")}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.empty}>{t("common.loading", "Loading…")}</div>
        ) : shifts.length === 0 ? (
          <div className={styles.empty}>{t("shifts.empty", "No shifts yet.")}</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("shifts.employee", "Employee")}</th>
                <th>{t("shifts.openedAt", "Opened")}</th>
                <th>{t("shifts.closedAt", "Closed")}</th>
                <th>{t("shifts.startAmount", "Starting cash")}</th>
                <th>{t("shifts.expectedAmount", "Expected cash")}</th>
                <th>{t("shifts.actualAmount", "Actual cash counted")}</th>
                <th>{t("shifts.difference", "Difference")}</th>
                <th>{t("shifts.filterStatus", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => {
                const hasDiff = shift.currency_amounts.some((row) => row.difference_amount != null);
                const anyNegative = shift.currency_amounts.some(
                  (row) => toNumber(row.difference_amount) < 0,
                );
                const anyPositive = shift.currency_amounts.some(
                  (row) => toNumber(row.difference_amount) > 0,
                );
                return (
                  <tr
                    key={shift.id}
                    className={styles.rowClickable}
                    onClick={() => void openDetail(shift)}
                  >
                    <td>{shift.user_display_name || `#${shift.user_id}`}</td>
                    <td>{formatDateTime(shift.opened_at)}</td>
                    <td>{shift.closed_at ? formatDateTime(shift.closed_at) : "—"}</td>
                    <td>{formatCurrencyAmounts(shift.currency_amounts, "start_amount")}</td>
                    <td>{formatCurrencyAmounts(shift.currency_amounts, "expected_amount")}</td>
                    <td>{formatCurrencyAmounts(shift.currency_amounts, "actual_amount")}</td>
                    <td
                      className={
                        !hasDiff
                          ? undefined
                          : anyNegative
                            ? styles.negative
                            : anyPositive
                              ? styles.positive
                              : undefined
                      }
                    >
                      {formatCurrencyAmounts(shift.currency_amounts, "difference_amount")}
                    </td>
                    <td>
                      {shift.status === "open"
                        ? t("shifts.status.open", "Open")
                        : t("shifts.status.closed", "Closed")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {openModal ? (
        <div className={styles.modalOverlay} onClick={() => !saving && setOpenModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>{t("shifts.open", "Open shift")}</div>
            <div className={styles.formGrid}>
              {isMaster ? (
                <label className={styles.fieldLabel}>
                  {t("shifts.employee", "Employee")}
                  <select
                    className={styles.select}
                    value={openForUserId === "" ? "" : String(openForUserId)}
                    onChange={(e) =>
                      setOpenForUserId(e.target.value ? Number(e.target.value) : "")
                    }
                  >
                    <option value="">{t("shifts.openForMe", "Myself")}</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className={styles.fieldLabel}>
                {t("shifts.startAmount", "Starting cash")}
                {cashCurrencies.length === 0 ? (
                  <div className={styles.muted}>
                    {t("shifts.noCashCurrencies", "No cash currencies available.")}
                  </div>
                ) : (
                  <div className={styles.currencyAmountList}>
                    {cashCurrencies.map((c) => (
                      <label key={c.id} className={styles.currencyAmountRow}>
                        <span>{c.code_chr || c.name}</span>
                        <input
                          className={styles.input}
                          type="number"
                          min={0}
                          step="0.01"
                          value={openAmounts[c.id] ?? "0"}
                          onChange={(e) =>
                            setOpenAmounts((prev) => ({
                              ...prev,
                              [c.id]: e.target.value,
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <label className={styles.fieldLabel}>
                {t("shifts.notes", "Notes")}
                <textarea
                  className={styles.textarea}
                  value={openNotes}
                  onChange={(e) => setOpenNotes(e.target.value)}
                />
              </label>
            </div>
            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setOpenModal(false)}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button
                type="button"
                disabled={saving || cashCurrencies.length === 0}
                onClick={() => void handleOpen()}
              >
                {t("shifts.open", "Open shift")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {closeModal && activeShift ? (
        <div
          className={`${styles.modalOverlay} ${styles.modalOverlayRaised}`}
          onClick={() => !saving && setCloseModal(false)}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>{t("shifts.close", "Close shift")}</div>
            {expectedPreview?.by_currency?.length ? (
              <div className={styles.currencyBreakdown}>
                {expectedPreview.by_currency.map((row) => (
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
                          {t("shifts.cashFromDocs", "Cash from payments")}
                        </div>
                        <div className={styles.statValue}>
                          {money(row.cash_from_docs, row.currency_code, row.currency_id)}
                        </div>
                      </div>
                      <div className={styles.stat}>
                        <div className={styles.statLabel}>
                          {t("shifts.opsNet", "Cash operations net")}
                        </div>
                        <div className={styles.statValue}>
                          {money(row.ops_net, row.currency_code, row.currency_id)}
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
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className={styles.formGrid}>
              <div className={styles.fieldLabel}>
                {t("shifts.actualAmount", "Actual cash counted")}
                <div className={styles.currencyAmountList}>
                  {Object.keys(closeAmounts).map((idStr) => {
                    const currencyId = Number(idStr);
                    const previewRow = expectedPreview?.by_currency.find(
                      (row) => row.currency_id === currencyId,
                    );
                    const amountRow = activeShift.currency_amounts.find(
                      (row) => row.currency_id === currencyId,
                    );
                    const code =
                      previewRow?.currency_code || amountRow?.currency_code || `#${currencyId}`;
                    return (
                      <label key={currencyId} className={styles.currencyAmountRow}>
                        <span>{code}</span>
                        <input
                          className={styles.input}
                          type="number"
                          min={0}
                          step="0.01"
                          value={closeAmounts[currencyId] ?? ""}
                          onChange={(e) =>
                            setCloseAmounts((prev) => ({
                              ...prev,
                              [currencyId]: e.target.value,
                            }))
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
              <label className={styles.fieldLabel}>
                {t("shifts.notes", "Notes")}
                <textarea
                  className={styles.textarea}
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                />
              </label>
            </div>
            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setCloseModal(false)}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button type="button" disabled={saving} onClick={() => void handleClose()}>
                {t("shifts.closeConfirm", "Close shift")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {activeShift ? (
        <ShiftAddOperationModal
          open={opModal}
          currencies={operationCurrencies}
          saving={saving}
          onClose={() => setOpModal(false)}
          onSubmit={handleAddOp}
        />
      ) : null}

      {canCreatePayment && activeShift?.status === "open" ? (
        <PaymentCreateModal
          open={paymentModal}
          onClose={() => setPaymentModal(false)}
          initialDirection="outcome"
          initialFirmId={activeShift.firm_id}
          cashPaymentTypesOnly
          availableCashByCurrency={availableCashByCurrency}
          onCreated={() => {
            void handlePaymentCreated();
          }}
        />
      ) : null}

      {detail ? (
        <div className={styles.modalOverlay} onClick={() => setDetail(null)}>
          <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>
              {detail.user_display_name || `#${detail.user_id}`} ·{" "}
              {detail.status === "open"
                ? t("shifts.status.open", "Open")
                : t("shifts.status.closed", "Closed")}
            </div>
            <div className={styles.currencyBreakdown}>
              {(detail.expected_preview?.by_currency?.length
                ? detail.expected_preview.by_currency.map((row) => ({
                    currency_id: row.currency_id,
                    currency_code: row.currency_code,
                    start_amount: row.start_amount,
                    expected_amount: row.expected_amount,
                    actual_amount:
                      detail.currency_amounts.find((a) => a.currency_id === row.currency_id)
                        ?.actual_amount ?? null,
                    difference_amount:
                      detail.currency_amounts.find((a) => a.currency_id === row.currency_id)
                        ?.difference_amount ?? null,
                  }))
                : detail.currency_amounts
              ).map((row) => (
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
                      <div className={styles.statLabel}>{t("shifts.difference", "Difference")}</div>
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
                {detail.operations.length === 0 ? (
                  <div className={styles.muted}>—</div>
                ) : (
                  detail.operations.map((op) => (
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
            <div className={styles.modalActions}>
              {detail.status === "open" ? (
                <>
                  <Button type="button" variant="secondary" onClick={() => setOpModal(true)}>
                    {t("shifts.addOperation", "Add operation")}
                  </Button>
                  {canCreatePayment ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setPaymentModal(true)}
                    >
                      {t("payments.create.button", "New payment")}
                    </Button>
                  ) : null}
                  <Button type="button" onClick={() => beginClose(detail)}>
                    {t("shifts.close", "Close shift")}
                  </Button>
                </>
              ) : null}
              <Button type="button" variant="secondary" onClick={() => setDetail(null)}>
                {t("common.close", "Close")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
