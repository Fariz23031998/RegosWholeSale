import clsx from "clsx";
import { CalendarRange, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { DashboardPeriodModal } from "@/components/Dashboard/DashboardPeriodModal";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  customRangeToTimestamps,
  formatDashboardPeriodLabel,
  toDateInputValue,
  type DashboardCustomRange,
} from "@/lib/dashboard-api";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { fetchFirms, fetchPartnerBalance } from "@/lib/partners-api";
import { fetchRegosDefaults } from "@/lib/settings-api";
import { formatAuthError } from "@/store/auth";
import type { PartnerBalanceMode, PartnerBalanceRow } from "@/types/partners";
import type { RegosCurrencyOption, RegosDefaultOption } from "@/types/settings";
import styles from "./POS.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  partnerId: number;
  partnerName: string;
};

type CurrencyGroup = {
  key: string;
  currency: RegosCurrencyOption | null;
  rows: PartnerBalanceRow[];
  debitTotal: number;
  creditTotal: number;
  closingTotal: number;
};

function currentYearRange(): DashboardCustomRange {
  const year = new Date().getFullYear();
  return {
    startDate: `${year}-01-01`,
    endDate: toDateInputValue(new Date(year, 11, 31)),
  };
}

function formatUnixDateTime(ts: number): string {
  if (!ts) return "—";
  return formatDateTime(new Date(ts * 1000).toISOString());
}

function formatAmount(value: number): string {
  if (!value) return "";
  return formatCurrency(value);
}

function compareOperationsDesc(a: PartnerBalanceRow, b: PartnerBalanceRow): number {
  if (b.date !== a.date) {
    return b.date - a.date;
  }
  return b.id - a.id;
}

function groupRowsByCurrency(rows: PartnerBalanceRow[]): CurrencyGroup[] {
  const groups = new Map<string, CurrencyGroup>();

  for (const row of rows) {
    const currency = row.currency;
    const key = currency ? String(currency.id) : "none";
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      existing.debitTotal += row.debit;
      existing.creditTotal += row.credit;
      continue;
    }
    groups.set(key, {
      key,
      currency,
      rows: [row],
      debitTotal: row.debit,
      creditTotal: row.credit,
      closingTotal: 0,
    });
  }

  for (const group of groups.values()) {
    group.rows.sort(compareOperationsDesc);
    group.closingTotal = group.debitTotal - group.creditTotal;
  }

  return Array.from(groups.values()).sort((left, right) => {
    const leftRow = left.rows[0];
    const rightRow = right.rows[0];
    if (!leftRow) return 1;
    if (!rightRow) return -1;
    return compareOperationsDesc(rightRow, leftRow);
  });
}

function collectOptions<T extends { id: number; name: string }>(
  rows: PartnerBalanceRow[],
  pick: (row: PartnerBalanceRow) => T | null | undefined,
): T[] {
  const map = new Map<number, T>();
  for (const row of rows) {
    const option = pick(row);
    if (option) {
      map.set(option.id, option);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function PartnerBalanceModal({
  open,
  onClose,
  token,
  partnerId,
  partnerName,
}: Props) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<PartnerBalanceMode>("native");
  const [periodRange, setPeriodRange] = useState<DashboardCustomRange>(currentYearRange);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [firmId, setFirmId] = useState<number | null>(null);
  const [currencyId, setCurrencyId] = useState<number | null>(null);
  const [rows, setRows] = useState<PartnerBalanceRow[]>([]);
  const [firmOptions, setFirmOptions] = useState<RegosDefaultOption[]>([]);
  const [defaultsReady, setDefaultsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const resetFilters = useCallback(() => {
    setMode("native");
    setPeriodRange(currentYearRange());
    setFirmId(null);
    setCurrencyId(null);
    setRows([]);
    setFirmOptions([]);
    setDefaultsReady(false);
    setError("");
    setCollapsedGroups(new Set());
  }, []);

  const handleClose = useCallback(() => {
    resetFilters();
    onClose();
  }, [onClose, resetFilters]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const loadDefaults = async () => {
      const [defaultsResult, firmsResult] = await Promise.allSettled([
        fetchRegosDefaults(token),
        fetchFirms(token),
      ]);
      if (cancelled) return;

      if (firmsResult.status === "fulfilled") {
        setFirmOptions(firmsResult.value.firms);
      }
      const defaultFirmId =
        defaultsResult.status === "fulfilled"
          ? defaultsResult.value.defaults.firm?.id ?? null
          : null;
      setFirmId(defaultFirmId);
      setDefaultsReady(true);
    };

    void loadDefaults();
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  const fetchBalanceRows = useCallback(async () => {
    const { start_date, end_date } = customRangeToTimestamps(periodRange);
    const response = await fetchPartnerBalance(token, partnerId, {
      startDate: start_date,
      endDate: end_date,
      firmId,
      currencyId: mode === "native" ? currencyId : null,
      mode,
    });
    return [...response.rows].sort(compareOperationsDesc);
  }, [currencyId, firmId, mode, partnerId, periodRange, token]);

  const loadBalance = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await fetchBalanceRows());
    } catch (err) {
      setError(
        formatAuthError(err, t("partners.balance.errors.load", "Failed to load partner balance.")),
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [fetchBalanceRows, t]);

  useEffect(() => {
    if (!open || !defaultsReady) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    void fetchBalanceRows()
      .then((nextRows) => {
        if (!cancelled) setRows(nextRows);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          formatAuthError(err, t("partners.balance.errors.load", "Failed to load partner balance.")),
        );
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [defaultsReady, fetchBalanceRows, open, t]);

  const currencyOptions = useMemo(
    () => collectOptions(rows, (row) => row.currency),
    [rows],
  );

  const groupedRows = useMemo(() => groupRowsByCurrency(rows), [rows]);

  const periodLabel = formatDashboardPeriodLabel("custom", periodRange, t);

  const colCurrency = t("partners.balance.colCurrency", "Currency");
  const colDocumentType = t("partners.balance.colDocumentType", "Document type");
  const colDocumentCode = t("partners.balance.colDocumentCode", "Document code");
  const colDate = t("partners.balance.colDate", "Date");
  const colOpening = t("partners.balance.colOpening", "Opening balance");
  const colDebit = t("partners.balance.colDebit", "Debit");
  const colCredit = t("partners.balance.colCredit", "Credit");
  const colClosing = t("partners.balance.colClosing", "Closing balance");

  const title = t("partners.balance.title", "Reconciliation statement — {{name}}", {
    name: partnerName,
  });

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={title}
        size="xl"
        overlayClassName={styles.partnerBalanceOverlay}
        modalClassName={styles.partnerBalanceModal}
        bodyClassName={styles.partnerBalanceBody}
      >
        <p className={styles.partnerBalanceSubtitle}>
          {t("partners.balance.period", "For period: {{period}}", { period: periodLabel })}
        </p>

        <div className={styles.partnerBalanceToolbar}>
          <Button type="button" size="sm" variant="secondary" onClick={() => setPeriodModalOpen(true)}>
            <CalendarRange size={14} />
            {t("partners.balance.selectPeriod", "Select period")}
          </Button>

          <label className={styles.partnerBalanceFilter}>
            <span>{t("partners.balance.firm", "Enterprise")}</span>
            <select
              value={firmId ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setFirmId(value ? Number(value) : null);
              }}
            >
              <option value="">{t("common.all", "All")}</option>
              {firmOptions.map((firm) => (
                <option key={firm.id} value={firm.id}>
                  {firm.name}
                </option>
              ))}
            </select>
          </label>

          {mode === "native" ? (
            <label className={styles.partnerBalanceFilter}>
              <span>{t("partners.balance.currency", "Currency")}</span>
              <select
                value={currencyId ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setCurrencyId(value ? Number(value) : null);
                }}
              >
                <option value="">{t("common.all", "All")}</option>
                {currencyOptions.map((currency) => (
                  <option key={currency.id} value={currency.id}>
                    {currency.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <button
            type="button"
            className={styles.partnerBalanceRefresh}
            onClick={() => void loadBalance()}
            disabled={loading}
            aria-label={t("common.refresh", "Refresh")}
          >
            <RefreshCw size={16} className={loading ? styles.partnerBalanceSpin : undefined} />
          </button>
        </div>

        <div className={styles.partnerBalanceTabs}>
          <button
            type="button"
            className={clsx(
              styles.partnerBalanceTab,
              mode === "native" && styles.partnerBalanceTabActive,
            )}
            onClick={() => setMode("native")}
          >
            {t("partners.balance.tabNative", "Reconciliation statement")}
          </button>
          <button
            type="button"
            className={clsx(
              styles.partnerBalanceTab,
              mode === "base_currency" && styles.partnerBalanceTabActive,
            )}
            onClick={() => setMode("base_currency")}
          >
            {t("partners.balance.tabBaseCurrency", "Reconciliation statement (Base currency)")}
          </button>
        </div>

        {error ? <div className={styles.partnerModalError}>{error}</div> : null}

        <div className={styles.partnerBalanceTableWrap}>
          <table className={styles.partnerBalanceTable}>
            <thead>
              <tr>
                <th>{colCurrency}</th>
                <th>{colDocumentType}</th>
                <th>{colDocumentCode}</th>
                <th>{colDate}</th>
                <th className={styles.partnerBalanceNum}>{colOpening}</th>
                <th className={styles.partnerBalanceNum}>{colDebit}</th>
                <th className={styles.partnerBalanceNum}>{colCredit}</th>
                <th className={styles.partnerBalanceNum}>{colClosing}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className={styles.partnerBalanceEmpty}>
                    {t("partners.balance.loading", "Loading balance...")}
                  </td>
                </tr>
              ) : groupedRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className={styles.partnerBalanceEmpty}>
                    {t("partners.balance.empty", "No transactions for this period.")}
                  </td>
                </tr>
              ) : (
                groupedRows.map((group) => {
                  const currencyName = group.currency?.name ?? t("common.unknown", "Unknown");
                  const isCollapsed = collapsedGroups.has(group.key);

                  return (
                    <Fragment key={group.key}>
                      <tr className={styles.partnerBalanceGroupRow}>
                        <td colSpan={4} className={styles.partnerBalanceGroupHeading}>
                          <div className={styles.partnerBalanceGroupLabel}>
                            <span>{currencyName}</span>
                            <button
                              type="button"
                              className={styles.partnerBalanceGroupToggle}
                              onClick={() => toggleGroup(group.key)}
                              aria-expanded={!isCollapsed}
                              aria-label={
                                isCollapsed
                                  ? t("partners.balance.showOperations", "Show operations for {{currency}}", {
                                      currency: currencyName,
                                    })
                                  : t("partners.balance.hideOperations", "Hide operations for {{currency}}", {
                                      currency: currencyName,
                                    })
                              }
                            >
                              {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </div>
                        </td>
                        <td className={styles.partnerBalanceNum} data-label={colOpening} />
                        <td className={styles.partnerBalanceNum} data-label={colDebit}>
                          {formatAmount(group.debitTotal)}
                        </td>
                        <td className={styles.partnerBalanceNum} data-label={colCredit}>
                          {formatAmount(group.creditTotal)}
                        </td>
                        <td className={styles.partnerBalanceNum} data-label={colClosing}>
                          {formatAmount(group.closingTotal)}
                        </td>
                      </tr>
                      {!isCollapsed
                        ? group.rows.map((row) => (
                            <tr key={row.id || `${group.key}-${row.document_code}-${row.date}`}>
                              <td data-label={colCurrency}>{row.currency?.name ?? "—"}</td>
                              <td data-label={colDocumentType}>{row.document_type?.name ?? "—"}</td>
                              <td data-label={colDocumentCode}>{row.document_code ?? "—"}</td>
                              <td data-label={colDate}>{formatUnixDateTime(row.date)}</td>
                              <td className={styles.partnerBalanceNum} data-label={colOpening}>
                                {formatAmount(row.start_amount)}
                              </td>
                              <td className={styles.partnerBalanceNum} data-label={colDebit}>
                                {formatAmount(row.debit)}
                              </td>
                              <td className={styles.partnerBalanceNum} data-label={colCredit}>
                                {formatAmount(row.credit)}
                              </td>
                              <td className={styles.partnerBalanceNum} data-label={colClosing}>
                                {formatAmount(row.end_amount)}
                              </td>
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Modal>

      <DashboardPeriodModal
        open={periodModalOpen}
        onClose={() => setPeriodModalOpen(false)}
        initialRange={periodRange}
        onApply={setPeriodRange}
      />
    </>
  );
}
