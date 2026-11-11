import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import clsx from "clsx";
import { Download, Search } from "lucide-react";
import { DataTable } from "@/components/DataTable/DataTable";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import paymentStyles from "@/components/Payments/Payments.module.css";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatDateTime } from "@/lib/format";
import { exportPartnerDashboardPaymentsToExcel } from "@/lib/export-partner-dashboard-payments";
import type { PartnerPayment } from "@/lib/partner-telegram-api";
import { formatAmount } from "./partner-format";
import { usePartnerExcelExport } from "./usePartnerExcelExport";

type PaymentDirection = "income" | "outcome";

function paymentWhen(date: number | null): string {
  if (!date || date <= 0) return "—";
  return formatDateTime(new Date(date * 1000).toISOString());
}

function paymentMatchesSearch(payment: PartnerPayment, query: string): boolean {
  if (!query) return true;
  return [payment.code, String(payment.id), payment.payment_type_name, payment.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function PartnerDashboardPaymentTable({
  payments,
  direction,
}: {
  payments: PartnerPayment[];
  direction: PaymentDirection;
}) {
  const { t } = useLanguage();

  const statusLabel = (payment: PartnerPayment) =>
    payment.performed ? t("payments.status.performed", "Performed") : t("payments.status.draft", "Draft");

  const statusClass = (payment: PartnerPayment) =>
    clsx(
      paymentStyles.badge,
      payment.performed
        ? direction === "income"
          ? paymentStyles.income
          : paymentStyles.outcome
        : paymentStyles.draft,
    );

  const columns = useMemo<ColumnDef<PartnerPayment, any>[]>(
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
        cell: ({ row }) => paymentWhen(row.original.date),
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
    <div className={dashboardStyles.paymentTableWrap}>
      <DataTable
        tableKey={`partner.dashboard.payments.${direction}`}
        data={payments}
        columns={columns}
        className={paymentStyles.tbl}
        getRowId={(payment) => String(payment.id)}
      />
    </div>
  );
}

export function PartnerDashboardPaymentsPanel({
  periodLabel,
  payments,
  loading,
  error,
}: {
  periodLabel: string;
  payments: PartnerPayment[];
  loading: boolean;
  error: string;
}) {
  const { t } = useLanguage();
  const { exporting, exportLabel, runExport } = usePartnerExcelExport();
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<PaymentDirection>("income");
  const query = search.trim().toLowerCase();

  const incomePayments = useMemo(
    () =>
      payments.filter(
        (payment) =>
          (!payment.payment_direction || payment.payment_direction === "income") &&
          paymentMatchesSearch(payment, query),
      ),
    [payments, query],
  );
  const outcomePayments = useMemo(
    () =>
      payments.filter(
        (payment) => payment.payment_direction === "outcome" && paymentMatchesSearch(payment, query),
      ),
    [payments, query],
  );

  const incomeTotal = incomePayments.reduce((sum, payment) => sum + (payment.amount ?? 0), 0);
  const outcomeTotal = outcomePayments.reduce((sum, payment) => sum + (payment.amount ?? 0), 0);
  const activePayments = direction === "income" ? incomePayments : outcomePayments;
  const activeTotal = direction === "income" ? incomeTotal : outcomeTotal;
  const loadedCount = payments.length;
  const activeCount = activePayments.length;

  const statusLabel = (payment: PartnerPayment) =>
    payment.performed ? t("payments.status.performed", "Performed") : t("payments.status.draft", "Draft");

  const directionLabel =
    direction === "income"
      ? t("partnerApp.income", "Incoming")
      : t("partnerApp.outcome", "Outgoing");

  return (
    <div
      id="dashboard-panel-payments"
      role="tabpanel"
      aria-labelledby="dashboard-tab-payments"
      className={dashboardStyles.dashboardPanel}
    >
      <div className={dashboardStyles.cardTitle}>{t("partnerApp.payments", "Payments")}</div>
      <div className={dashboardStyles.cardSub}>
        {periodLabel}
        {loadedCount > 0
          ? query
            ? ` · ${t("partnerApp.dashboard.shown", "{{n}} of {{m}}", {
                n: activeCount,
                m: loadedCount,
              })}`
            : ` · ${loadedCount}`
          : ""}
      </div>

      <div
        className={dashboardStyles.dashboardTabs}
        role="tablist"
        aria-label={t("partnerApp.payments", "Payments")}
      >
        <button
          type="button"
          role="tab"
          id="dashboard-payments-tab-income"
          className={clsx(
            dashboardStyles.dashboardTab,
            direction === "income" && dashboardStyles.dashboardTabActive,
          )}
          aria-selected={direction === "income"}
          aria-controls="dashboard-payments-panel-direction"
          onClick={() => setDirection("income")}
        >
          {t("partnerApp.income", "Incoming")}
        </button>
        <button
          type="button"
          role="tab"
          id="dashboard-payments-tab-outcome"
          className={clsx(
            dashboardStyles.dashboardTab,
            direction === "outcome" && dashboardStyles.dashboardTabActive,
          )}
          aria-selected={direction === "outcome"}
          aria-controls="dashboard-payments-panel-direction"
          onClick={() => setDirection("outcome")}
        >
          {t("partnerApp.outcome", "Outgoing")}
        </button>
      </div>

      {loadedCount > 0 ? (
        <div className={dashboardStyles.productsToolbar}>
          <div className={dashboardStyles.productsSearch}>
            <Search size={16} className={dashboardStyles.productsSearchIcon} />
            <input
              className={dashboardStyles.productsSearchInput}
              type="search"
              placeholder={t("partnerApp.dashboard.searchPayments", "Search payments…")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t("partnerApp.dashboard.searchPayments", "Search payments…")}
            />
          </div>
          <button
            type="button"
            className={dashboardStyles.exportButton}
            disabled={loading || exporting || incomePayments.length + outcomePayments.length === 0}
            onClick={() =>
              void runExport(() =>
                exportPartnerDashboardPaymentsToExcel({
                  incomePayments,
                  outcomePayments,
                  incomeTotal,
                  outcomeTotal,
                  periodLabel,
                  statusLabel,
                  t,
                }),
              )
            }
          >
            <Download size={14} />
            {exportLabel}
          </button>
        </div>
      ) : null}

      {error ? <div className={dashboardStyles.empty}>{error}</div> : null}

      <div
        id="dashboard-payments-panel-direction"
        role="tabpanel"
        aria-labelledby={`dashboard-payments-tab-${direction}`}
        className={clsx(dashboardStyles.card, dashboardStyles.paymentsSection)}
      >
        <div className={dashboardStyles.cardTitle}>{directionLabel}</div>
        <div className={dashboardStyles.cardSub}>
          {t("partnerApp.dashboard.paymentCount", "{{n}} payments", { n: activeCount })}
          {activeCount > 0 ? ` · ${formatAmount(activeTotal)}` : ""}
        </div>
        {activeCount === 0 && !loading && !error ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
            {query
              ? t("partnerApp.dashboard.emptySearch", "No matches for this search.")
              : t("partnerApp.emptyPayments", "No payments in this period.")}
          </div>
        ) : loading && payments.length === 0 ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
            {t("common.loadingFromRegos", "Loading from Regos…")}
          </div>
        ) : activeCount === 0 ? null : (
          <PartnerDashboardPaymentTable payments={activePayments} direction={direction} />
        )}
      </div>
    </div>
  );
}
