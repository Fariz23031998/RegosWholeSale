import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import clsx from "clsx";
import { ArrowLeft, CalendarRange, Download, RefreshCw, Search } from "lucide-react";
import { DataTable } from "@/components/DataTable/DataTable";
import { ReconciliationTable } from "@/components/DataTable/ReconciliationTable";
import { DashboardPeriodModal } from "@/components/Dashboard/DashboardPeriodModal";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import paymentStyles from "@/components/Payments/Payments.module.css";
import posStyles from "@/components/POS/POS.module.css";
import stockStyles from "@/components/StockDocs/StockDocs.module.css";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  formatDashboardPeriodLabel,
  getPeriodLabel,
  presetToCustomRange,
  resolveDashboardPeriodParams,
  toDateInputValue,
  type DashboardCustomRange,
  type DashboardPeriodPreset,
} from "@/lib/dashboard-api";
import { currencyLabel } from "@/lib/currency-conversion";
import { exportPartnerDocumentToExcel } from "@/lib/export-partner-document";
import { exportPartnerPaymentsToExcel } from "@/lib/export-partner-payments";
import { exportPartnerReconciliationToExcel } from "@/lib/export-partner-reconciliation";
import { formatDateTime } from "@/lib/format";
import {
  buildPartnerDebtSummary,
  compareOperationsDesc,
  groupRowsByCurrency,
  toPartnerPerspectiveRow,
} from "@/lib/partner-balance";
import {
  fetchPartnerDocument,
  fetchPartnerDocuments,
  fetchPartnerOrder,
  fetchPartnerOrders,
  fetchPartnerPayments,
  fetchPartnerReconciliation,
  type PartnerDocumentLine,
  type PartnerDocumentSummary,
  type PartnerPayment,
} from "@/lib/partner-telegram-api";
import type { PartnerBalanceRow } from "@/types/partners";
import { formatAuthError } from "@/store/auth";
import { PartnerBalanceTotal } from "./PartnerBalanceTotal";
import { usePartnerSession } from "./PartnerSession";
import { formatAmount } from "./partner-format";
import styles from "./PartnerPortal.module.css";

type PresetPeriod = Exclude<DashboardPeriodPreset, "custom">;
type PaymentDirection = "income" | "outcome";

export function PartnerPaymentsPage() {
  const { t } = useLanguage();
  const { token } = usePartnerSession();
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("week");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [direction, setDirection] = useState<PaymentDirection>("income");
  const [search, setSearch] = useState("");
  const [payments, setPayments] = useState<PartnerPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { startDate, endDate } = useMemo(
    () => periodDateRange(periodPreset, customRange),
    [customRange, periodPreset],
  );
  const periodModalRange = useMemo(() => {
    if (periodPreset === "custom" && customRange) return customRange;
    if (periodPreset !== "custom") return presetToCustomRange(periodPreset);
    return presetToCustomRange("week");
  }, [customRange, periodPreset]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchPartnerPayments(token, startDate, endDate)
      .then((response) => {
        if (!cancelled) {
          setPayments(response.payments.filter((payment) => Boolean(payment.performed)));
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(formatAuthError(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endDate, startDate, token]);

  const query = search.trim().toLowerCase();
  const visible = payments.filter((payment) => {
    if (payment.payment_direction && payment.payment_direction !== direction) return false;
    if (!query) return true;
    return [payment.code, payment.payment_type_name, payment.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const amountTotal = visible.reduce((sum, payment) => sum + (payment.amount ?? 0), 0);
  const periodLabel = formatDashboardPeriodLabel(periodPreset, customRange, t);
  const subtitle = t("partnerApp.paymentsSubtitle", "{{count}} payments · {{total}} · {{period}}", {
    count: visible.length,
    total: formatAmount(amountTotal),
    period: periodLabel,
  });

  const statusLabel = (payment: PartnerPayment) =>
    payment.performed ? t("payments.status.performed", "Performed") : t("payments.status.draft", "Draft");

  const statusClass = (payment: PartnerPayment) =>
    clsx(
      paymentStyles.badge,
      payment.performed ? (direction === "income" ? paymentStyles.income : paymentStyles.outcome) : paymentStyles.draft,
    );

  const paymentColumns = useMemo<ColumnDef<PartnerPayment, any>[]>(
    () => [
      {
        id: "code",
        accessorFn: (payment) => payment.code || String(payment.id),
        header: t("payments.table.code", "Code"),
        meta: { cellClassName: paymentStyles.code },
        cell: ({ row }) => row.original.code || row.original.id,
      },
      {
        id: "date",
        accessorFn: (payment) => payment.date ?? 0,
        header: t("payments.table.date", "Date"),
        cell: ({ row }) => documentWhen(row.original.date),
      },
      {
        id: "paymentType",
        accessorFn: (payment) => payment.payment_type_name ?? "",
        header: t("payments.paymentType", "Payment type"),
        cell: ({ getValue }) => getValue<string>() || "—",
      },
      {
        id: "description",
        accessorFn: (payment) => payment.description ?? "",
        header: t("payments.description", "Description"),
        size: 220,
        cell: ({ row }) => (row.original.description.trim() ? row.original.description : "—"),
      },
      {
        id: "status",
        accessorFn: (payment) => (payment.performed ? 1 : 0),
        header: t("payments.status", "Status"),
        cell: ({ row }) => <span className={statusClass(row.original)}>{statusLabel(row.original)}</span>,
      },
      {
        id: "amount",
        accessorFn: (payment) => payment.amount ?? 0,
        header: t("payments.amount", "Amount"),
        meta: {
          align: "right",
          cellClassName: paymentStyles.right,
          headerClassName: paymentStyles.right,
        },
        cell: ({ row }) => formatAmount(row.original.amount ?? 0),
      },
    ],
    [direction, t],
  );

  return (
    <div className={styles.stockBleed}>
      <div className={clsx(paymentStyles.page, styles.paymentsTable)}>
        <div className={paymentStyles.header}>
          <div>
            <h1 className={paymentStyles.title}>{t("partnerApp.payments", "Payments")}</h1>
            <div className={paymentStyles.subtitle}>
              {loading ? t("common.loadingFromRegos", "Loading from Regos…") : subtitle}
            </div>
          </div>
          <div className={paymentStyles.headerActions}>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={loading || visible.length === 0}
              onClick={() =>
                exportPartnerPaymentsToExcel({
                  title: t("partnerApp.payments", "Payments"),
                  subtitle,
                  payments: visible,
                  statusLabel,
                  t,
                })
              }
            >
              <Download size={14} />
              {t("partnerApp.exportExcel", "Export to Excel")}
            </Button>
            <div className={dashboardStyles.filters}>
              {(["today", "week", "month", "all"] as PresetPeriod[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={clsx(dashboardStyles.filter, periodPreset === value && dashboardStyles.filterActive)}
                  onClick={() => {
                    setPeriodPreset(value);
                    setCustomRange(null);
                  }}
                >
                  {getPeriodLabel(value, t)}
                </button>
              ))}
              <button
                type="button"
                className={clsx(
                  dashboardStyles.filter,
                  dashboardStyles.filterMenu,
                  periodPreset === "custom" && dashboardStyles.filterActive,
                )}
                onClick={() => setPeriodModalOpen(true)}
              >
                <CalendarRange size={14} />
                {t("dashboard.period", "Period")}
              </button>
            </div>
          </div>
        </div>

        <div className={paymentStyles.tabs}>
          <button
            type="button"
            className={clsx(paymentStyles.tab, direction === "income" && paymentStyles.tabActive)}
            onClick={() => setDirection("income")}
          >
            {t("payments.income", "Income")}
          </button>
          <button
            type="button"
            className={clsx(paymentStyles.tab, direction === "outcome" && paymentStyles.tabActive)}
            onClick={() => setDirection("outcome")}
          >
            {t("payments.outcome", "Outcome")}
          </button>
        </div>

        <div className={dashboardStyles.productsToolbar}>
          <div className={dashboardStyles.productsSearch}>
            <Search size={16} className={dashboardStyles.productsSearchIcon} />
            <input
              className={dashboardStyles.productsSearchInput}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("partnerApp.paymentSearch", "Search by code or type…")}
              aria-label={t("payments.searchAria", "Search payments")}
            />
          </div>
        </div>

        {error ? <div className={paymentStyles.empty}>{error}</div> : null}

        <div className={paymentStyles.table}>
          <DataTable
            tableKey="partner.payments"
            data={visible}
            columns={paymentColumns}
            className={paymentStyles.tbl}
            getRowId={(payment) => String(payment.id)}
            isLoading={loading && visible.length === 0}
            emptyMessage={
              loading
                ? t("payments.loading", "Loading payments…")
                : t("payments.empty", "No payments match these filters.")
            }
          />
          <div className={paymentStyles.cardList}>
            {loading ? (
              <div className={paymentStyles.empty}>{t("payments.loading", "Loading payments…")}</div>
            ) : visible.length === 0 ? (
              <div className={paymentStyles.empty}>{t("payments.empty", "No payments match these filters.")}</div>
            ) : (
              visible.map((payment) => (
                <article key={payment.id} className={paymentStyles.paymentCard}>
                  <div className={paymentStyles.paymentCardTop}>
                    <span className={paymentStyles.code}>{payment.code || payment.id}</span>
                    <span className={statusClass(payment)}>{statusLabel(payment)}</span>
                  </div>
                  <div className={paymentStyles.paymentCardDate}>{documentWhen(payment.date)}</div>
                  <div className={paymentStyles.paymentCardPartner}>{payment.payment_type_name || "—"}</div>
                  {payment.description.trim() ? (
                    <div className={paymentStyles.paymentCardMeta}>{payment.description}</div>
                  ) : null}
                  <div className={paymentStyles.paymentCardAmount}>{formatAmount(payment.amount ?? 0)}</div>
                </article>
              ))
            )}
          </div>
        </div>

        <DashboardPeriodModal
          open={periodModalOpen}
          onClose={() => setPeriodModalOpen(false)}
          initialRange={periodModalRange}
          onApply={(range) => {
            setCustomRange(range);
            setPeriodPreset("custom");
          }}
        />
      </div>
    </div>
  );
}

function currentYearRange(): DashboardCustomRange {
  const year = new Date().getFullYear();
  return {
    startDate: `${year}-01-01`,
    endDate: toDateInputValue(new Date(year, 11, 31)),
  };
}

function statementAmount(value: number): string {
  if (!value) return "";
  return formatAmount(value);
}

export function PartnerReconciliationPage() {
  const { t } = useLanguage();
  const { token, account } = usePartnerSession();
  const [periodRange, setPeriodRange] = useState<DashboardCustomRange>(currentYearRange);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [rows, setRows] = useState<PartnerBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchPartnerReconciliation(token, periodRange.startDate, periodRange.endDate);
      setRows([...response.rows].sort(compareOperationsDesc));
    } catch (loadError) {
      setError(formatAuthError(loadError, t("partners.balance.errors.load", "Failed to load partner balance.")));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [periodRange.endDate, periodRange.startDate, t, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const partnerRows = useMemo(() => rows.map(toPartnerPerspectiveRow), [rows]);
  const partnerGroupedRows = useMemo(() => groupRowsByCurrency(partnerRows), [partnerRows]);
  const debtSummary = useMemo(() => buildPartnerDebtSummary(partnerGroupedRows), [partnerGroupedRows]);
  const debts = debtSummary.debts;
  const credits = debtSummary.credits;
  const periodLabel = formatDashboardPeriodLabel("custom", periodRange, t);
  const partnerName = account.partner_name || account.first_name || "";
  const title = partnerName
    ? t("partners.balance.title", "Reconciliation statement — {{name}}", { name: partnerName })
    : t("partnerApp.reconciliation", "Reconciliation");

  const colCurrency = t("partners.balance.colCurrency", "Currency");
  const colDocumentType = t("partners.balance.colDocumentType", "Document type");
  const colDocumentCode = t("partners.balance.colDocumentCode", "Document code");
  const colDate = t("partners.balance.colDate", "Date");
  const colOpening = t("partners.balance.colOpening", "Opening balance");
  const colDebit = t("partners.balance.colDebit", "Debit");
  const colCredit = t("partners.balance.colCredit", "Credit");
  const colClosing = t("partners.balance.colClosing", "Closing balance");

  return (
    <section className={styles.reconciliationPage}>
      <h1 className={styles.reconciliationTitle}>{title}</h1>
      <p className={posStyles.partnerBalanceSubtitle}>
        {t("partners.balance.period", "For period: {{period}}", { period: periodLabel })}
      </p>

      <div className={posStyles.partnerBalanceToolbar}>
        <Button type="button" size="sm" variant="secondary" onClick={() => setPeriodModalOpen(true)}>
          <CalendarRange size={14} />
          {t("partners.balance.selectPeriod", "Select period")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={loading || rows.length === 0}
          onClick={() =>
            exportPartnerReconciliationToExcel({
              title,
              periodLabel,
              rows: partnerRows,
              t,
            })
          }
        >
          <Download size={14} />
          {t("partnerApp.exportExcel", "Export to Excel")}
        </Button>
        <button
          type="button"
          className={posStyles.partnerBalanceRefresh}
          onClick={() => void load()}
          disabled={loading}
          aria-label={t("common.refresh", "Refresh")}
        >
          <RefreshCw size={16} className={loading ? posStyles.partnerBalanceSpin : undefined} />
        </button>
      </div>

      {error ? <div className={posStyles.partnerModalError}>{error}</div> : null}

      {debts.length > 0 || credits.length > 0 ? (
        <div
          className={clsx(
            posStyles.partnerDebtBanner,
            debts.length === 0 && credits.length > 0 && posStyles.partnerDebtBannerFirmOnly,
          )}
        >
          <div className={posStyles.partnerDebtSummary}>
            {debts.length > 0 ? (
              <>
                <span className={posStyles.partnerDebtLabel}>{t("partners.balance.debt", "Debt")}</span>
                <ul className={posStyles.partnerDebtList}>
                  {debts.map((debt) => (
                    <li key={debt.key}>
                      {formatAmount(debt.amount)}
                      {debt.currency ? ` ${currencyLabel(debt.currency)}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {credits.length > 0 ? (
              <>
                <span className={posStyles.partnerFirmDebtLabel}>{t("partners.balance.firmDebt", "Firm debt")}</span>
                <ul className={posStyles.partnerFirmDebtList}>
                  {credits.map((credit) => (
                    <li key={credit.key}>
                      {formatAmount(credit.amount)}
                      {credit.currency ? ` ${currencyLabel(credit.currency)}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          <PartnerBalanceTotal groups={partnerGroupedRows} />
        </div>
      ) : null}

      <div className={clsx(posStyles.partnerBalanceTableWrap, styles.reconciliationTable)}>
        <ReconciliationTable
          tableKey="partner.reconciliation"
          groups={partnerGroupedRows}
          collapsed={collapsedGroups}
          onToggle={toggleGroup}
          loading={loading && rows.length === 0}
          loadingMessage={t("partners.balance.loading", "Loading balance...")}
          emptyMessage={t("partners.balance.empty", "No transactions for this period.")}
          className={posStyles.partnerBalanceTable}
          numClassName={posStyles.partnerBalanceNum}
          groupRowClassName={posStyles.partnerBalanceGroupRow}
          groupHeadingClassName={posStyles.partnerBalanceGroupHeading}
          groupLabelClassName={posStyles.partnerBalanceGroupLabel}
          groupToggleClassName={posStyles.partnerBalanceGroupToggle}
          emptyClassName={posStyles.partnerBalanceEmpty}
          headers={{
            currency: colCurrency,
            documentType: colDocumentType,
            documentCode: colDocumentCode,
            date: colDate,
            opening: colOpening,
            debit: colDebit,
            credit: colCredit,
            closing: colClosing,
          }}
          formatAmount={statementAmount}
          formatDate={documentWhen}
          rowCurrency={(row) => (row.currency ? currencyLabel(row.currency) || "—" : "—")}
          groupCurrency={(group) =>
            group.currency
              ? currencyLabel(group.currency) || t("common.unknown", "Unknown")
              : t("common.unknown", "Unknown")
          }
        />
      </div>

      <DashboardPeriodModal
        open={periodModalOpen}
        onClose={() => setPeriodModalOpen(false)}
        initialRange={periodRange}
        onApply={setPeriodRange}
      />
    </section>
  );
}

const ORDER_STATUSES: Record<number, { key: string; fallback: string; done: boolean }> = {
  1: { key: "partnerApp.orderStatus.new", fallback: "New", done: false },
  2: { key: "partnerApp.orderStatus.approved", fallback: "Approved", done: true },
  3: { key: "partnerApp.orderStatus.processing", fallback: "Processing", done: true },
  4: { key: "partnerApp.orderStatus.finished", fallback: "Finished", done: true },
  5: { key: "partnerApp.orderStatus.canceled", fallback: "Canceled", done: false },
};

function orderStatus(
  document: PartnerDocumentSummary,
  t: (key: string, fallback?: string) => string,
): { label: string; done: boolean } {
  const known = document.status_id != null ? ORDER_STATUSES[document.status_id] : undefined;
  if (known) return { label: t(known.key, known.fallback), done: known.done };
  const done = Boolean(document.performed);
  return {
    label: done ? t("stock.status.performed", "Performed") : t("stock.status.draft", "Draft"),
    done,
  };
}

export function PartnerOrdersPage({ placed }: { placed?: string }) {
  const { t } = useLanguage();
  const { token } = usePartnerSession();
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("week");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [orders, setOrders] = useState<PartnerDocumentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<PartnerDocumentSummary | null>(null);
  const [lines, setLines] = useState<PartnerDocumentLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [lineQuery, setLineQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { startDate, endDate } = useMemo(
    () => periodDateRange(periodPreset, customRange),
    [customRange, periodPreset],
  );
  const periodModalRange = useMemo(() => {
    if (periodPreset === "custom" && customRange) return customRange;
    if (periodPreset !== "custom") return presetToCustomRange(periodPreset);
    return presetToCustomRange("week");
  }, [customRange, periodPreset]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchPartnerOrders(token, startDate, endDate)
      .then((response) => {
        if (!cancelled) setOrders(response.orders);
      })
      .catch((loadError) => {
        if (!cancelled) setError(formatAuthError(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endDate, startDate, token]);

  const open = (order: PartnerDocumentSummary) => {
    setSelectedId(order.id);
    setSelected(order);
    setLines([]);
    setLineQuery("");
    setLinesLoading(true);
    void fetchPartnerOrder(token, order.id)
      .then((detail) => {
        setSelected(detail.order);
        setLines(detail.operations);
      })
      .catch((loadError) => setError(formatAuthError(loadError)))
      .finally(() => setLinesLoading(false));
  };

  const query = search.trim().toLowerCase();
  const visible = query
    ? orders.filter((order) => String(order.code || order.id).toLowerCase().includes(query))
    : orders;
  const periodLabel = formatDashboardPeriodLabel(periodPreset, customRange, t);
  const subtitle = t("stock.purchase.subtitle", "{{count}} documents · {{period}} · {{warehouses}}", {
    count: visible.length,
    period: periodLabel,
    warehouses: "",
  })
    .replace(/[\s·•]+$/u, "")
    .trim();

  const orderColumns = useMemo<ColumnDef<PartnerDocumentSummary, any>[]>(
    () => [
      {
        id: "code",
        accessorFn: (order) => order.code || String(order.id),
        header: t("stock.table.code", "Code"),
        cell: ({ row }) => `#${row.original.code || row.original.id}`,
        meta: { cellClassName: stockStyles.id },
      },
      {
        id: "date",
        accessorFn: (order) => order.date ?? 0,
        header: t("common.date", "Date"),
        cell: ({ row }) => documentWhen(row.original.date),
      },
      {
        id: "warehouse",
        accessorFn: (order) => order.stock_name ?? "",
        header: t("stock.table.warehouse", "Warehouse"),
        cell: ({ getValue }) => getValue<string>() || "—",
      },
      {
        id: "description",
        accessorFn: (order) => order.description ?? "",
        header: t("common.description", "Description"),
        size: 220,
        meta: { cellClassName: stockStyles.descriptionCell },
        cell: ({ row }) => (row.original.description.trim() ? row.original.description : "—"),
      },
      {
        id: "status",
        accessorFn: (order) => orderStatus(order, t).label,
        header: t("stock.table.status", "Status"),
        cell: ({ row }) => {
          const status = orderStatus(row.original, t);
          return (
            <span className={`${stockStyles.badge} ${status.done ? stockStyles.badgeDone : stockStyles.badgeDraft}`}>
              {status.label}
            </span>
          );
        },
      },
      {
        id: "amount",
        accessorFn: (order) => order.amount ?? 0,
        header: t("common.amount", "Amount"),
        meta: { align: "right", cellClassName: stockStyles.right, headerClassName: stockStyles.right },
        cell: ({ row }) => documentAmount(row.original.amount),
      },
    ],
    [t],
  );

  if (selectedId && selected) {
    const status = orderStatus(selected, t);
    return (
      <div className={styles.stockBleed}>
        <StockDocumentView
          title={t("stock.detail.title", "Document #{{code}}", { code: selected.code || selected.id })}
          document={selected}
          lines={lines}
          loading={linesLoading}
          lineQuery={lineQuery}
          statusLabel={status.label}
          onLineQuery={setLineQuery}
          onBack={() => {
            setSelectedId(null);
            setSelected(null);
            setLines([]);
            setLineQuery("");
          }}
        />
      </div>
    );
  }

  return (
    <div className={styles.stockBleed}>
      <div className={stockStyles.page}>
        <div className={stockStyles.header}>
          <div>
            <h1 className={stockStyles.title}>{t("partnerApp.orders", "My orders")}</h1>
            <div className={stockStyles.subtitle}>
              {loading ? t("common.loadingFromRegos", "Loading from Regos…") : subtitle}
            </div>
          </div>
        </div>

        {placed ? (
          <p className={styles.orderPlaced}>{t("partnerApp.orderPlaced", "Order {{code}} was sent.", { code: placed })}</p>
        ) : null}

        <div className={stockStyles.filters}>
          <div className={stockStyles.searchWrap}>
            <Search size={16} className={stockStyles.searchIcon} />
            <input
              className={stockStyles.searchInput}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("stock.searchPlaceholder", "Search by number…")}
            />
          </div>
          <button
            type="button"
            className={`${dashboardStyles.filter} ${dashboardStyles.filterMenu}`}
            onClick={() => setPeriodModalOpen(true)}
          >
            <CalendarRange size={14} />
            {periodLabel}
          </button>
        </div>

        {error ? <div className={stockStyles.error}>{error}</div> : null}

        <div className={stockStyles.table}>
          {loading && orders.length === 0 ? (
            <div className={stockStyles.empty}>{t("common.loading", "Loading...")}</div>
          ) : visible.length === 0 ? (
            <div className={stockStyles.empty}>{t("common.nothing", "Nothing found")}</div>
          ) : (
            <>
              <DataTable
                tableKey="partner.orders"
                data={visible}
                columns={orderColumns}
                className={stockStyles.tbl}
                getRowId={(order) => String(order.id)}
                onRowClick={open}
              />
              <div className={stockStyles.cardList}>
                {visible.map((order) => {
                  const status = orderStatus(order, t);
                  return (
                    <div key={order.id} className={stockStyles.docCard}>
                      <button type="button" className={stockStyles.docCardMain} onClick={() => open(order)}>
                        <div className={stockStyles.docCardTop}>
                          <span className={stockStyles.id}>#{order.code || order.id}</span>
                          <span className={`${stockStyles.badge} ${status.done ? stockStyles.badgeDone : stockStyles.badgeDraft}`}>
                            {status.label}
                          </span>
                        </div>
                        <div className={stockStyles.docCardDate}>{documentWhen(order.date)}</div>
                        <div className={stockStyles.docCardPlace}>{order.stock_name || "—"}</div>
                        {order.description.trim() ? (
                          <div className={stockStyles.docCardDescription}>{order.description}</div>
                        ) : null}
                        <div className={stockStyles.docCardAmount}>{documentAmount(order.amount)}</div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <DashboardPeriodModal
          open={periodModalOpen}
          onClose={() => setPeriodModalOpen(false)}
          initialRange={periodModalRange}
          onApply={(range) => {
            setCustomRange(range);
            setPeriodPreset("custom");
          }}
        />
      </div>
    </div>
  );
}

function documentWhen(date: number | null): string {
  if (!date || date <= 0) return "—";
  return formatDateTime(new Date(date * 1000).toISOString());
}

function documentAmount(amount: number | null): string {
  return amount != null ? formatAmount(amount) : "—";
}

function periodDateRange(
  preset: DashboardPeriodPreset,
  customRange: DashboardCustomRange | null,
): { startDate: string; endDate: string } {
  const params = resolveDashboardPeriodParams(preset, customRange);
  return {
    startDate: params.start_date != null ? toDateInputValue(new Date(params.start_date * 1000)) : "",
    endDate: params.end_date != null ? toDateInputValue(new Date(params.end_date * 1000)) : "",
  };
}

export function PartnerStockDocumentPage({
  kind,
  titleKey,
  titleFallback,
  documentId,
  onOpen,
  onBack,
}: {
  kind: string;
  titleKey: string;
  titleFallback: string;
  documentId?: number;
  onOpen: (id: number) => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const { token } = usePartnerSession();
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("week");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [documents, setDocuments] = useState<PartnerDocumentSummary[]>([]);
  const [selected, setSelected] = useState<PartnerDocumentSummary | null>(null);
  const [lines, setLines] = useState<PartnerDocumentLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [lineQuery, setLineQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { startDate, endDate } = useMemo(
    () => periodDateRange(periodPreset, customRange),
    [customRange, periodPreset],
  );
  const periodModalRange = useMemo(() => {
    if (periodPreset === "custom" && customRange) return customRange;
    if (periodPreset !== "custom") return presetToCustomRange(periodPreset);
    return presetToCustomRange("week");
  }, [customRange, periodPreset]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchPartnerDocuments(token, kind, startDate, endDate)
      .then((response) => {
        if (!cancelled) {
          setDocuments(response.documents.filter((document) => Boolean(document.performed)));
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(formatAuthError(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endDate, kind, startDate, token]);

  useEffect(() => {
    if (!documentId) {
      setSelected(null);
      setLines([]);
      setLineQuery("");
      return;
    }
    const known = documents.find((item) => item.id === documentId) ?? null;
    setSelected(
      known ?? {
        id: documentId,
        code: null,
        date: null,
        amount: null,
        description: "",
        status_id: null,
        performed: null,
      },
    );
    setLinesLoading(true);
    void fetchPartnerDocument(token, kind, documentId)
      .then((detail) => {
        setSelected(detail.document);
        setLines(detail.operations);
      })
      .catch((loadError) => setError(formatAuthError(loadError)))
      .finally(() => setLinesLoading(false));
  }, [documentId, documents, kind, token]);

  const query = search.trim().toLowerCase();
  const visible = query
    ? documents.filter((document) => String(document.code || document.id).toLowerCase().includes(query))
    : documents;
  const periodLabel = formatDashboardPeriodLabel(periodPreset, customRange, t);
  const subtitle = t("stock.purchase.subtitle", "{{count}} documents · {{period}} · {{warehouses}}", {
    count: visible.length,
    period: periodLabel,
    warehouses: "",
  })
    .replace(/[\s·•]+$/u, "")
    .trim();

  const documentColumns = useMemo<ColumnDef<PartnerDocumentSummary, any>[]>(
    () => [
      {
        id: "code",
        accessorFn: (document) => document.code || String(document.id),
        header: t("stock.table.code", "Code"),
        cell: ({ row }) => `#${row.original.code || row.original.id}`,
        meta: { cellClassName: stockStyles.id },
      },
      {
        id: "date",
        accessorFn: (document) => document.date ?? 0,
        header: t("common.date", "Date"),
        cell: ({ row }) => documentWhen(row.original.date),
      },
      {
        id: "warehouse",
        accessorFn: (document) => document.stock_name ?? "",
        header: t("stock.table.warehouse", "Warehouse"),
        cell: ({ getValue }) => getValue<string>() || "—",
      },
      {
        id: "description",
        accessorFn: (document) => document.description ?? "",
        header: t("common.description", "Description"),
        size: 220,
        meta: { cellClassName: stockStyles.descriptionCell },
        cell: ({ row }) => (row.original.description.trim() ? row.original.description : "—"),
      },
      {
        id: "status",
        accessorFn: (document) => (document.performed ? 1 : 0),
        header: t("stock.table.status", "Status"),
        cell: ({ row }) => {
          const done = Boolean(row.original.performed);
          return (
            <span className={`${stockStyles.badge} ${done ? stockStyles.badgeDone : stockStyles.badgeDraft}`}>
              {done ? t("stock.status.performed", "Performed") : t("stock.status.draft", "Draft")}
            </span>
          );
        },
      },
      {
        id: "amount",
        accessorFn: (document) => document.amount ?? 0,
        header: t("common.amount", "Amount"),
        meta: { align: "right", cellClassName: stockStyles.right, headerClassName: stockStyles.right },
        cell: ({ row }) => documentAmount(row.original.amount),
      },
    ],
    [t],
  );

  if (documentId && selected) {
    return (
      <div className={styles.stockBleed}>
        <StockDocumentView
          title={t("stock.detail.title", "Document #{{code}}", { code: selected.code || selected.id })}
          document={selected}
          lines={lines}
          loading={linesLoading}
          lineQuery={lineQuery}
          onLineQuery={setLineQuery}
          onBack={onBack}
        />
      </div>
    );
  }

  return (
    <div className={styles.stockBleed}>
      <div className={stockStyles.page}>
        <div className={stockStyles.header}>
          <div>
            <h1 className={stockStyles.title}>{t(titleKey, titleFallback)}</h1>
            <div className={stockStyles.subtitle}>
              {loading ? t("common.loadingFromRegos", "Loading from Regos…") : subtitle}
            </div>
          </div>
        </div>

        <div className={stockStyles.filters}>
          <div className={stockStyles.searchWrap}>
            <Search size={16} className={stockStyles.searchIcon} />
            <input
              className={stockStyles.searchInput}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("stock.searchPlaceholder", "Search by number…")}
            />
          </div>
          <button
            type="button"
            className={`${dashboardStyles.filter} ${dashboardStyles.filterMenu}`}
            onClick={() => setPeriodModalOpen(true)}
          >
            <CalendarRange size={14} />
            {periodLabel}
          </button>
        </div>

        {error ? <div className={stockStyles.error}>{error}</div> : null}

        <div className={stockStyles.table}>
          {loading && documents.length === 0 ? (
            <div className={stockStyles.empty}>{t("common.loading", "Loading...")}</div>
          ) : visible.length === 0 ? (
            <div className={stockStyles.empty}>{t("common.nothing", "Nothing found")}</div>
          ) : (
            <>
              <DataTable
                tableKey="partner.stockDocs"
                data={visible}
                columns={documentColumns}
                className={stockStyles.tbl}
                getRowId={(document) => String(document.id)}
                onRowClick={(document) => onOpen(document.id)}
              />
              <div className={stockStyles.cardList}>
                {visible.map((document) => {
                  const done = Boolean(document.performed);
                  return (
                    <div key={document.id} className={stockStyles.docCard}>
                      <button type="button" className={stockStyles.docCardMain} onClick={() => onOpen(document.id)}>
                        <div className={stockStyles.docCardTop}>
                          <span className={stockStyles.id}>#{document.code || document.id}</span>
                          <span className={`${stockStyles.badge} ${done ? stockStyles.badgeDone : stockStyles.badgeDraft}`}>
                            {done
                              ? t("stock.status.performed", "Performed")
                              : t("stock.status.draft", "Draft")}
                          </span>
                        </div>
                        <div className={stockStyles.docCardDate}>{documentWhen(document.date)}</div>
                        <div className={stockStyles.docCardPlace}>{document.stock_name || "—"}</div>
                        {document.description.trim() ? (
                          <div className={stockStyles.docCardDescription}>{document.description}</div>
                        ) : null}
                        <div className={stockStyles.docCardAmount}>{documentAmount(document.amount)}</div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <DashboardPeriodModal
          open={periodModalOpen}
          onClose={() => setPeriodModalOpen(false)}
          initialRange={periodModalRange}
          onApply={(range) => {
            setCustomRange(range);
            setPeriodPreset("custom");
          }}
        />
      </div>
    </div>
  );
}

function StockDocumentView({
  title,
  document,
  lines,
  loading,
  lineQuery,
  statusLabel,
  onLineQuery,
  onBack,
}: {
  title: string;
  document: PartnerDocumentSummary;
  lines: PartnerDocumentLine[];
  loading: boolean;
  lineQuery: string;
  statusLabel?: string;
  onLineQuery: (value: string) => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const done = Boolean(document.performed);
  const query = lineQuery.trim().toLowerCase();
  const visible = query
    ? lines.filter((line) => {
        const name = line.item_name.toLowerCase();
        const code = (line.item_code ?? "").toLowerCase();
        return name.includes(query) || code.includes(query);
      })
    : lines;

  const lineColumns = useMemo<ColumnDef<PartnerDocumentLine, any>[]>(
    () => [
      {
        id: "code",
        accessorFn: (line) => line.item_code ?? "",
        header: t("stock.detail.table.code", "Code"),
        cell: ({ row }) => row.original.item_code || "—",
        meta: { cellClassName: stockStyles.id },
      },
      {
        id: "product",
        accessorFn: (line) => line.item_name,
        header: t("stock.detail.table.product", "Product"),
        size: 240,
      },
      {
        id: "qty",
        accessorFn: (line) => line.quantity,
        header: t("stock.detail.table.qty", "Qty"),
        meta: { align: "right", cellClassName: stockStyles.right, headerClassName: stockStyles.right },
      },
      {
        id: "price",
        accessorFn: (line) => line.price,
        header: t("stock.detail.table.price", "Price"),
        meta: { align: "right", cellClassName: stockStyles.right, headerClassName: stockStyles.right },
        cell: ({ row }) => formatAmount(row.original.price),
      },
      {
        id: "amount",
        accessorFn: (line) => line.total,
        header: t("common.amount", "Amount"),
        meta: { align: "right", cellClassName: stockStyles.right, headerClassName: stockStyles.right },
        cell: ({ row }) => formatAmount(row.original.total),
      },
    ],
    [t],
  );

  return (
    <div className={stockStyles.page}>
      <div className={`${stockStyles.header} ${stockStyles.detailHeader}`}>
        <div className={stockStyles.detailHeaderMain}>
          <button type="button" className={stockStyles.backLink} onClick={onBack} aria-label={t("common.back", "Back")}>
            <ArrowLeft size={18} />
          </button>
          <h1 className={stockStyles.title}>{title}</h1>
        </div>
      </div>

      <div className={stockStyles.detailMeta}>
        <div>
          <span className={stockStyles.detailLabel}>{t("common.date", "Date")}</span>
          <span>{documentWhen(document.date)}</span>
        </div>
        <div>
          <span className={stockStyles.detailLabel}>{t("stock.table.warehouse", "Warehouse")}</span>
          <span>{document.stock_name || "—"}</span>
        </div>
        <div>
          <span className={stockStyles.detailLabel}>{t("common.description", "Description")}</span>
          <span>{document.description.trim() ? document.description : "—"}</span>
        </div>
        <div>
          <span className={stockStyles.detailLabel}>{t("stock.table.status", "Status")}</span>
          <span>
            {statusLabel ?? (done ? t("stock.status.performed", "Performed") : t("stock.status.draft", "Draft"))}
          </span>
        </div>
        <div>
          <span className={stockStyles.detailLabel}>{t("common.total", "Total")}</span>
          <span>{documentAmount(document.amount)}</span>
        </div>
      </div>

      <div className={stockStyles.detailActions}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={loading || lines.length === 0}
          onClick={() =>
            exportPartnerDocumentToExcel({
              title,
              document,
              lines,
              statusLabel:
                statusLabel ??
                (done ? t("stock.status.performed", "Performed") : t("stock.status.draft", "Draft")),
              t,
            })
          }
        >
          <Download size={14} />
          {t("partnerApp.exportExcel", "Export to Excel")}
        </Button>
        <div className={stockStyles.detailActionsSearch}>
          <Search size={16} className={stockStyles.searchIcon} aria-hidden />
          <input
            className={stockStyles.searchInput}
            value={lineQuery}
            onChange={(event) => onLineQuery(event.target.value)}
            placeholder={t("stock.detail.searchLines", "Search lines…")}
            aria-label={t("stock.detail.searchLines", "Search lines…")}
          />
        </div>
      </div>

      <div className={stockStyles.detailSection}>
        <div className={stockStyles.detailSectionTitle}>{t("stock.detail.lines", "Lines")}</div>
        {loading ? (
          <div className={stockStyles.detailEmpty}>{t("common.loading", "Loading...")}</div>
        ) : lines.length === 0 ? (
          <div className={stockStyles.detailEmpty}>{t("stock.detail.noLines", "No lines")}</div>
        ) : visible.length === 0 ? (
          <div className={stockStyles.detailEmpty}>{t("stock.detail.noMatchingLines", "No matching lines")}</div>
        ) : (
          <>
            <div className={stockStyles.detailTableWrap}>
              <DataTable
                tableKey="partner.stockDocLines"
                data={visible}
                columns={lineColumns}
                className={stockStyles.detailTable}
                getRowId={(line, index) => `${line.item_code ?? ""}-${line.item_name}-${index}`}
              />
            </div>
            <div className={stockStyles.lineCards}>
              {visible.map((line, index) => (
                <div key={`${line.item_name}-${index}`} className={stockStyles.lineCard}>
                  <div className={stockStyles.lineCardTop}>
                    <div className={stockStyles.lineCardName}>{line.item_name}</div>
                    <div className={stockStyles.lineCardAmount}>{formatAmount(line.total)}</div>
                  </div>
                  <div className={stockStyles.lineCardMeta}>
                    {[
                      line.item_code || null,
                      `${t("stock.detail.table.qty", "Qty")}: ${line.quantity}`,
                      `${t("stock.detail.table.price", "Price")}: ${formatAmount(line.price)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

