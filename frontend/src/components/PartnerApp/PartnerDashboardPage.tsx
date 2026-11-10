import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CalendarRange, RefreshCw } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardPeriodModal } from "@/components/Dashboard/DashboardPeriodModal";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import paymentStyles from "@/components/Payments/Payments.module.css";
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
import {
  fetchPartnerDashboard,
  fetchPartnerDashboardProducts,
  fetchPartnerPayments,
  fetchPartnerReconciliation,
  type PartnerDashboardProductRow,
  type PartnerDashboardProductTotals,
  type PartnerDashboardSummary,
  type PartnerPayment,
} from "@/lib/partner-telegram-api";
import {
  groupRowsByCurrency,
  toPartnerPerspectiveRow,
} from "@/lib/partner-balance";
import type { PartnerBalanceRow } from "@/types/partners";
import { formatAuthError } from "@/store/auth";
import { PartnerBalanceTotal } from "./PartnerBalanceTotal";
import { PartnerDashboardPaymentsPanel } from "./PartnerDashboardPaymentsPanel";
import { PartnerDashboardProductsPanel } from "./PartnerDashboardProductsPanel";
import { usePartnerSession } from "./PartnerSession";
import { formatAmount } from "./partner-format";
import styles from "./PartnerPortal.module.css";

type PresetPeriod = Exclude<DashboardPeriodPreset, "custom">;
type DashboardTab = "totals" | "purchases" | "shipments" | "payments";

const DASHBOARD_TABS: DashboardTab[] = ["totals", "purchases", "shipments", "payments"];

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

function formatDayLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  return `${match[2]}.${match[3]}`;
}

const EMPTY_PRODUCT_TOTALS: PartnerDashboardProductTotals = {
  sold_quantity: 0,
  sold_total: 0,
  refund_quantity: 0,
  refund_total: 0,
  net_quantity: 0,
  net_total: 0,
};

export function PartnerDashboardPage() {
  const { t } = useLanguage();
  const { token } = usePartnerSession();
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("week");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>("totals");
  const [summary, setSummary] = useState<PartnerDashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const [purchaseProducts, setPurchaseProducts] = useState<PartnerDashboardProductRow[]>([]);
  const [purchaseTotals, setPurchaseTotals] = useState<PartnerDashboardProductTotals | null>(null);
  const [purchaseTotal, setPurchaseTotal] = useState(0);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState("");

  const [shipmentProducts, setShipmentProducts] = useState<PartnerDashboardProductRow[]>([]);
  const [shipmentTotals, setShipmentTotals] = useState<PartnerDashboardProductTotals | null>(null);
  const [shipmentTotal, setShipmentTotal] = useState(0);
  const [shipmentLoading, setShipmentLoading] = useState(false);
  const [shipmentError, setShipmentError] = useState("");

  const [payments, setPayments] = useState<PartnerPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState("");

  const [balanceRows, setBalanceRows] = useState<PartnerBalanceRow[]>([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");

  const { startDate, endDate } = useMemo(
    () => periodDateRange(periodPreset, customRange),
    [customRange, periodPreset],
  );
  const periodModalRange = useMemo(() => {
    if (periodPreset === "custom" && customRange) return customRange;
    if (periodPreset !== "custom") return presetToCustomRange(periodPreset);
    return presetToCustomRange("week");
  }, [customRange, periodPreset]);
  const periodLabel = formatDashboardPeriodLabel(periodPreset, customRange, t);

  useEffect(() => {
    if (!endDate) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchPartnerDashboard(token, startDate, endDate)
      .then((response) => {
        if (!cancelled) setSummary(response);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setSummary(null);
          setError(formatAuthError(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endDate, reloadToken, startDate, token]);

  useEffect(() => {
    if (!endDate) return;
    let cancelled = false;
    const balanceStart = startDate || `${new Date().getFullYear()}-01-01`;
    setBalanceLoading(true);
    setBalanceError("");
    void fetchPartnerReconciliation(token, balanceStart, endDate)
      .then((response) => {
        if (!cancelled) setBalanceRows(response.rows);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setBalanceRows([]);
          setBalanceError(formatAuthError(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endDate, reloadToken, startDate, token]);

  useEffect(() => {
    if (!endDate || activeTab !== "purchases") return;
    let cancelled = false;
    setPurchaseLoading(true);
    setPurchaseError("");
    void fetchPartnerDashboardProducts(token, "purchases", startDate, endDate)
      .then((response) => {
        if (!cancelled) {
          setPurchaseProducts(response.products);
          setPurchaseTotals(response.totals);
          setPurchaseTotal(response.total);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setPurchaseProducts([]);
          setPurchaseTotals(null);
          setPurchaseTotal(0);
          setPurchaseError(formatAuthError(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) setPurchaseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, endDate, reloadToken, startDate, token]);

  useEffect(() => {
    if (!endDate || activeTab !== "shipments") return;
    let cancelled = false;
    setShipmentLoading(true);
    setShipmentError("");
    void fetchPartnerDashboardProducts(token, "shipments", startDate, endDate)
      .then((response) => {
        if (!cancelled) {
          setShipmentProducts(response.products);
          setShipmentTotals(response.totals);
          setShipmentTotal(response.total);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setShipmentProducts([]);
          setShipmentTotals(null);
          setShipmentTotal(0);
          setShipmentError(formatAuthError(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) setShipmentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, endDate, reloadToken, startDate, token]);

  useEffect(() => {
    if (!endDate || activeTab !== "payments") return;
    let cancelled = false;
    setPaymentsLoading(true);
    setPaymentsError("");
    void fetchPartnerPayments(token, startDate, endDate)
      .then((response) => {
        if (!cancelled) {
          setPayments(response.payments.filter((payment) => Boolean(payment.performed)));
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setPayments([]);
          setPaymentsError(formatAuthError(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) setPaymentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, endDate, reloadToken, startDate, token]);

  const totals = summary?.totals;
  const chartData = useMemo(
    () =>
      (summary?.days ?? []).map((row) => ({
        ...row,
        label: formatDayLabel(row.day),
      })),
    [summary?.days],
  );

  const balanceGroups = useMemo(
    () => groupRowsByCurrency(balanceRows.map(toPartnerPerspectiveRow)),
    [balanceRows],
  );

  const dashboardTabLabel = (tab: DashboardTab) => {
    if (tab === "totals") return t("partnerApp.dashboard.tabs.totals", "Totals");
    if (tab === "purchases") return t("partnerApp.purchase", "Purchases");
    if (tab === "shipments") return t("partnerApp.wholesale", "Shipments");
    return t("partnerApp.payments", "Payments");
  };

  const anyLoading =
    loading ||
    balanceLoading ||
    (activeTab === "purchases" && purchaseLoading) ||
    (activeTab === "shipments" && shipmentLoading) ||
    (activeTab === "payments" && paymentsLoading);

  return (
    <div className={styles.stockBleed}>
      <div className={clsx(dashboardStyles.page, styles.dashboardPage)}>
        <div className={dashboardStyles.header}>
          <div>
            <h1 className={paymentStyles.title}>{t("partnerApp.dashboard", "Reports")}</h1>
            <div className={paymentStyles.subtitle}>
              {anyLoading
                ? t("common.loadingFromRegos", "Loading from Regos…")
                : t("partnerApp.dashboardSubtitle", "Partner totals · {{period}}", {
                    period: periodLabel,
                  })}
            </div>
          </div>
          <div className={paymentStyles.headerActions}>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={anyLoading || !endDate}
              onClick={() => setReloadToken((value) => value + 1)}
            >
              <RefreshCw size={14} />
              {t("common.refresh", "Refresh")}
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

        <div
          className={dashboardStyles.dashboardTabs}
          role="tablist"
          aria-label={t("partnerApp.dashboard.tabs.label", "Report sections")}
        >
          {DASHBOARD_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`dashboard-tab-${tab}`}
              className={clsx(dashboardStyles.dashboardTab, activeTab === tab && dashboardStyles.dashboardTabActive)}
              aria-selected={activeTab === tab}
              aria-controls={`dashboard-panel-${tab}`}
              onClick={() => setActiveTab(tab)}
            >
              {dashboardTabLabel(tab)}
            </button>
          ))}
        </div>

        {activeTab === "totals" ? (
          <div
            id="dashboard-panel-totals"
            role="tabpanel"
            aria-labelledby="dashboard-tab-totals"
            className={dashboardStyles.dashboardPanel}
          >
            {error ? <div className={paymentStyles.error}>{error}</div> : null}

            <div className={dashboardStyles.kpis}>
              <div className={dashboardStyles.kpi}>
                <div className={dashboardStyles.kpiLabel}>{t("partnerApp.wholesale", "Shipments")}</div>
                <div className={dashboardStyles.kpiValue}>{formatAmount(totals?.shipments ?? 0)}</div>
                <div className={dashboardStyles.kpiDelta}>
                  {t("partnerApp.dashboard.docCount", "{{n}} documents", {
                    n: totals?.shipments_count ?? 0,
                  })}
                </div>
              </div>
              <div className={dashboardStyles.kpi}>
                <div className={dashboardStyles.kpiLabel}>
                  {t("partnerApp.wholesaleReturn", "Shipment returns")}
                </div>
                <div className={dashboardStyles.kpiValue}>
                  {formatAmount(totals?.shipment_returns ?? 0)}
                </div>
                <div className={dashboardStyles.kpiDelta}>
                  {t("partnerApp.dashboard.docCount", "{{n}} documents", {
                    n: totals?.shipment_returns_count ?? 0,
                  })}
                </div>
              </div>
              <div className={dashboardStyles.kpi}>
                <div className={dashboardStyles.kpiLabel}>{t("partnerApp.purchase", "Purchases")}</div>
                <div className={dashboardStyles.kpiValue}>{formatAmount(totals?.purchases ?? 0)}</div>
                <div className={dashboardStyles.kpiDelta}>
                  {t("partnerApp.dashboard.docCount", "{{n}} documents", {
                    n: totals?.purchases_count ?? 0,
                  })}
                </div>
              </div>
              <div className={dashboardStyles.kpi}>
                <div className={dashboardStyles.kpiLabel}>
                  {t("partnerApp.purchaseReturn", "Purchase returns")}
                </div>
                <div className={dashboardStyles.kpiValue}>
                  {formatAmount(totals?.purchase_returns ?? 0)}
                </div>
                <div className={dashboardStyles.kpiDelta}>
                  {t("partnerApp.dashboard.docCount", "{{n}} documents", {
                    n: totals?.purchase_returns_count ?? 0,
                  })}
                </div>
              </div>
              <div className={dashboardStyles.kpi}>
                <div className={dashboardStyles.kpiLabel}>{t("partnerApp.orders", "My orders")}</div>
                <div className={dashboardStyles.kpiValue}>{totals?.orders_count ?? 0}</div>
                <div className={dashboardStyles.kpiDelta}>
                  {t("partnerApp.dashboard.ordersAmount", "Amount {{amount}}", {
                    amount: formatAmount(totals?.orders_amount ?? 0),
                  })}
                </div>
              </div>
              <div className={dashboardStyles.kpi}>
                <div className={dashboardStyles.kpiLabel}>{t("partnerApp.income", "Incoming")}</div>
                <div className={dashboardStyles.kpiValue}>{formatAmount(totals?.payments_in ?? 0)}</div>
                <div className={dashboardStyles.kpiDelta}>
                  {t("partnerApp.dashboard.paymentCount", "{{n}} payments", {
                    n: totals?.payments_in_count ?? 0,
                  })}
                </div>
              </div>
              <div className={dashboardStyles.kpi}>
                <div className={dashboardStyles.kpiLabel}>{t("partnerApp.outcome", "Outgoing")}</div>
                <div className={dashboardStyles.kpiValue}>{formatAmount(totals?.payments_out ?? 0)}</div>
                <div className={dashboardStyles.kpiDelta}>
                  {t("partnerApp.dashboard.paymentCount", "{{n}} payments", {
                    n: totals?.payments_out_count ?? 0,
                  })}
                </div>
              </div>
              <div className={dashboardStyles.kpi}>
                <div className={dashboardStyles.kpiLabel}>
                  {t("partnerApp.dashboard.netDebt", "Net debt")}
                </div>
                {balanceError ? (
                  <div className={dashboardStyles.kpiDelta}>{balanceError}</div>
                ) : balanceGroups.length > 0 ? (
                  <PartnerBalanceTotal groups={balanceGroups} className={styles.balanceTotalKpi} />
                ) : (
                  <div className={dashboardStyles.kpiDelta}>
                    {balanceLoading
                      ? t("common.loadingFromRegos", "Loading from Regos…")
                      : t("partnerApp.dashboard.noDebt", "No open debt")}
                  </div>
                )}
              </div>
            </div>

            <div className={clsx(dashboardStyles.charts, styles.dashboardCharts)}>
              <div className={dashboardStyles.card}>
                <div className={dashboardStyles.cardTitle}>
                  {t("partnerApp.dashboard.activityChart", "Daily activity")}
                </div>
                <div className={dashboardStyles.cardSub}>
                  {t("partnerApp.dashboard.activityChartHint", "Shipments, purchases, and payments by day")}
                </div>
                {chartData.length === 0 ? (
                  <div className={dashboardStyles.kpiDelta}>
                    {loading
                      ? t("common.loadingFromRegos", "Loading from Regos…")
                      : t("partnerApp.dashboard.emptyChart", "No activity in this period.")}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={chartData} margin={{ left: -12, right: 8, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} width={56} />
                      <Tooltip
                        formatter={(value: number) => formatAmount(value)}
                        labelFormatter={(label) => String(label)}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="shipments"
                        name={t("partnerApp.wholesale", "Shipments")}
                        stroke="#4f46e5"
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="purchases"
                        name={t("partnerApp.purchase", "Purchases")}
                        stroke="#0ea5e9"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="payments_in"
                        name={t("partnerApp.income", "Incoming")}
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="payments_out"
                        name={t("partnerApp.outcome", "Outgoing")}
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "purchases" ? (
          <PartnerDashboardProductsPanel
            tabId="purchases"
            title={t("partnerApp.purchase", "Purchases")}
            periodLabel={periodLabel}
            products={purchaseProducts}
            totals={purchaseTotals ?? EMPTY_PRODUCT_TOTALS}
            total={purchaseTotal}
            loading={purchaseLoading}
            error={purchaseError}
            filePrefix="partner-purchases"
          />
        ) : null}

        {activeTab === "shipments" ? (
          <PartnerDashboardProductsPanel
            tabId="shipments"
            title={t("partnerApp.wholesale", "Shipments")}
            periodLabel={periodLabel}
            products={shipmentProducts}
            totals={shipmentTotals ?? EMPTY_PRODUCT_TOTALS}
            total={shipmentTotal}
            loading={shipmentLoading}
            error={shipmentError}
            filePrefix="partner-shipments"
          />
        ) : null}

        {activeTab === "payments" ? (
          <PartnerDashboardPaymentsPanel
            periodLabel={periodLabel}
            payments={payments}
            loading={paymentsLoading}
            error={paymentsError}
          />
        ) : null}
      </div>

      <DashboardPeriodModal
        open={periodModalOpen}
        onClose={() => setPeriodModalOpen(false)}
        initialRange={periodModalRange}
        onApply={(range) => {
          setPeriodPreset("custom");
          setCustomRange(range);
          setPeriodModalOpen(false);
        }}
      />
    </div>
  );
}
