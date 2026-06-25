import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CalendarRange, Coins, Download, Search, Users, Warehouse } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatAuthError, useAuth } from "@/store/auth";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  DASHBOARD_PRODUCTS_PAGE_SIZE,
  DASHBOARD_PAYMENTS_PAGE_SIZE,
  buildDashboardCurrencyFilterOptions,
  collectDashboardCurrencies,
  currencyFilterKey,
  fetchDashboardOverview,
  fetchDashboardProducts,
  fetchDashboardPayments,
  fetchAllDashboardProducts,
  fetchAllDashboardPayments,
  formatDashboardPeriodLabel,
  getPeriodLabel,
  parseCurrencyFilterKey,
  presetToCustomRange,
  resolveDashboardPeriodParams,
  resolveDashboardQueryParams,
  serializeDashboardQueryParams,
  type DashboardCustomRange,
  type DashboardCurrencyFilter,
  type DashboardPeriodPreset,
  type DashboardPaymentRow,
  type DashboardProductRow,
  type DashboardProductTotals,
  type DashboardStats,
  type DashboardTopProduct,
  type TranslateFn,
} from "@/lib/dashboard-api";
import { fetchRegosDefaults, fetchRegosReferenceOptions } from "@/lib/settings-api";
import type { RegosDefaultOption } from "@/types/settings";
import { DashboardPeriodModal } from "@/components/Dashboard/DashboardPeriodModal";
import {
  DashboardPartnersModal,
  formatPartnerFilterLabel,
} from "@/components/Dashboard/DashboardPartnersModal";
import {
  DashboardWarehousesModal,
  formatWarehouseFilterLabel,
} from "@/components/Dashboard/DashboardWarehousesModal";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { exportDashboardProductsToExcel } from "@/lib/export-dashboard-products";
import { exportDashboardPaymentsToExcel } from "@/lib/export-dashboard-payments";
import { formatAmountWithCurrency } from "@/lib/checkout-payments";
import { currencyLabel } from "@/lib/currency-conversion";
import type { RegosCurrencyOption } from "@/types/settings";
import styles from "./Dashboard.module.css";

const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444"];
const TOP_PRODUCT_LABEL_WIDTH = 260;
const TOP_PRODUCT_LABEL_LINE_HEIGHT = 15;
const TOP_PRODUCT_LABEL_MAX_CHARS = 38;

type PresetPeriod = Exclude<DashboardPeriodPreset, "custom">;
type DashboardTab = "totals" | "payments" | "products";

const DASHBOARD_TABS: DashboardTab[] = ["totals", "payments", "products"];

function formatPaymentDate(timestamp: number): string {
  if (timestamp <= 0) return "—";
  return formatDateTime(new Date(timestamp * 1000).toISOString());
}

function formatQty(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function formatOptionalCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatCurrency(value);
}

function AmountWithCurrency({
  amount,
  currency,
  className,
}: {
  amount: number;
  currency?: RegosCurrencyOption | null;
  className?: string;
}) {
  const label = currencyLabel(currency);
  return (
    <span className={clsx(styles.amountWithCurrency, className)}>
      <span className={styles.amountFigure}>{formatCurrency(amount)}</span>
      {label ? <span className={styles.currencyUnit}>{label}</span> : null}
    </span>
  );
}

function DashboardAmount({
  amount,
  currency,
  loading,
  className,
}: {
  amount: number;
  currency?: RegosCurrencyOption | null;
  loading: boolean;
  className?: string;
}) {
  if (loading) {
    return <div className={className}>—</div>;
  }
  return (
    <div className={className}>
      <AmountWithCurrency amount={amount} currency={currency} />
    </div>
  );
}

function DashboardInlineAmount({
  amount,
  currency,
  loading,
  className,
}: {
  amount: number;
  currency?: RegosCurrencyOption | null;
  loading: boolean;
  className?: string;
}) {
  if (loading) {
    return <span className={className}>—</span>;
  }
  return (
    <span className={className}>
      <AmountWithCurrency amount={amount} currency={currency} />
    </span>
  );
}

function formatDashboardAmountText(
  amount: number,
  currency: RegosCurrencyOption | null | undefined,
): string {
  if (currency) {
    return formatAmountWithCurrency(amount, currency);
  }
  return formatCurrency(amount);
}

function wrapProductLabel(text: string, maxChars = TOP_PRODUCT_LABEL_MAX_CHARS): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["—"];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word;
  }

  if (current) lines.push(current);
  return lines.slice(0, 4);
}

function productMatchesSearch(product: DashboardProductRow, query: string): boolean {
  if (!query) return true;
  const haystack = [product.code, product.name, product.category]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return haystack.some((value) => value.includes(query));
}

function paymentMatchesSearch(payment: DashboardPaymentRow, query: string): boolean {
  if (!query) return true;
  const haystack = [
    payment.code,
    String(payment.id),
    payment.payment_type_name,
    payment.partner_name,
    payment.attached_user_name,
    payment.category_name,
    currencyLabel(payment.currency),
  ]
    .map((value) => (value ?? "").trim().toLowerCase())
    .filter(Boolean);
  return haystack.some((value) => value.includes(query));
}

type ProductRevenueYAxisTickProps = {
  x?: number;
  y?: number;
  payload?: { value?: string };
};

function ProductRevenueYAxisTick({ x = 0, y = 0, payload }: ProductRevenueYAxisTickProps) {
  const lines = wrapProductLabel(String(payload?.value ?? ""));
  const anchorX = x - 8;

  return (
    <text x={anchorX} y={y} textAnchor="end" fill="#8a93a6" fontSize={11}>
      {lines.map((line, index) => (
        <tspan
          key={`${line}-${index}`}
          x={anchorX}
          dy={index === 0 ? "0.32em" : TOP_PRODUCT_LABEL_LINE_HEIGHT}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}

function topProductsChartHeight(products: { name: string }[]): number {
  const count = products.length;
  if (count === 0) return 240;

  const maxLines = Math.max(
    1,
    ...products.map((product) => wrapProductLabel(product.name).length),
  );
  const rowHeight = Math.max(52, maxLines * TOP_PRODUCT_LABEL_LINE_HEIGHT + 18);
  return Math.max(260, count * rowHeight + 16);
}

function formatOptionalExchangeRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, "");
}

function DashboardPaymentTable({
  payments,
  t,
}: {
  payments: DashboardPaymentRow[];
  t: TranslateFn;
}) {
  return (
    <div className={styles.paymentTableWrap}>
      <table className={styles.paymentTable}>
        <thead>
          <tr>
            <th>{t("dashboard.payments.receipt")}</th>
            <th>{t("common.date")}</th>
            <th>{t("common.type")}</th>
            <th>{t("dashboard.payments.partner")}</th>
            <th>{t("dashboard.payments.user")}</th>
            <th className={styles.right}>{t("dashboard.payments.exchangeRate")}</th>
            <th className={styles.right}>{t("common.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id}>
              <td data-label={t("dashboard.payments.receipt")}>#{payment.code || payment.id}</td>
              <td data-label={t("common.date")}>{formatPaymentDate(payment.date)}</td>
              <td data-label={t("common.type")}>{payment.payment_type_name ?? "—"}</td>
              <td data-label={t("dashboard.payments.partner")}>{payment.partner_name ?? "—"}</td>
              <td data-label={t("dashboard.payments.user")}>
                {payment.attached_user_name ?? "—"}
              </td>
              <td data-label={t("dashboard.payments.exchangeRate")} className={styles.right}>
                {formatOptionalExchangeRate(payment.exchange_rate)}
              </td>
              <td data-label={t("common.amount")} className={styles.right}>
                <AmountWithCurrency amount={payment.amount ?? 0} currency={payment.currency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DashboardProductTotalsRow({
  totals,
  t,
}: {
  totals: DashboardProductTotals;
  t: TranslateFn;
}) {
  return (
    <tr className={styles.productsTotalRow}>
      <td colSpan={3}>{t("dashboard.products.totalRow")}</td>
      <td className={styles.num}>—</td>
      <td className={styles.num}>—</td>
      <td className={styles.num}>{formatQty(totals.sold_quantity)}</td>
      <td className={styles.num}>{formatCurrency(totals.sold_purchase_cost)}</td>
      <td className={styles.num}>{formatCurrency(totals.sold_total)}</td>
      <td className={styles.num}>{formatQty(totals.refund_quantity)}</td>
      <td className={styles.num}>{formatCurrency(totals.refund_purchase_cost)}</td>
      <td className={styles.num}>{formatCurrency(totals.refund_total)}</td>
      <td className={styles.num}>{formatQty(totals.net_sold_quantity)}</td>
      <td className={styles.num}>{formatCurrency(totals.net_purchase_cost)}</td>
      <td className={styles.num}>{formatCurrency(totals.net_total_sells)}</td>
      <td className={styles.num}>{formatCurrency(totals.net_gross_profit)}</td>
    </tr>
  );
}

function TopProductsRevenueList({
  products,
  displayCurrency,
}: {
  products: DashboardTopProduct[];
  displayCurrency: RegosCurrencyOption | null | undefined;
}) {
  return (
    <div className={styles.topList}>
      {products.map((item, index) => (
        <div key={item.item_id} className={styles.topItem}>
          <div className={styles.topRank}>{index + 1}</div>
          <div className={styles.topContent}>
            <div className={styles.topName}>{item.name}</div>
            <div className={styles.topVal}>
              <AmountWithCurrency amount={item.revenue} currency={displayCurrency} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BestSellersSection({
  products,
  loading,
  t,
  showTitle = true,
}: {
  products: DashboardTopProduct[];
  loading: boolean;
  t: TranslateFn;
  showTitle?: boolean;
}) {
  return (
    <>
      {showTitle ? (
        <div className={styles.cardTitle}>{t("dashboard.charts.bestSellers")}</div>
      ) : null}
      <div className={styles.cardSub}>{t("dashboard.charts.unitsSold")}</div>
      <div className={styles.topList}>
        {products.length === 0 && !loading && (
          <div style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
            {t("dashboard.charts.noSales")}
          </div>
        )}
        {products.map((item, index) => (
          <div key={item.item_id} className={styles.topItem}>
            <div className={styles.topRank}>{index + 1}</div>
            <div className={styles.topContent}>
              <div className={styles.topName}>{item.name}</div>
              <div className={styles.topVal}>
                {t("dashboard.charts.sold", undefined, { qty: item.qty })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function DashboardPage() {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("week");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<RegosDefaultOption[]>([]);
  const [partners, setPartners] = useState<RegosDefaultOption[]>([]);
  const [allStocks, setAllStocks] = useState(true);
  const [selectedStockIds, setSelectedStockIds] = useState<number[]>([]);
  const [allPartners, setAllPartners] = useState(true);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<number[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [products, setProducts] = useState<DashboardProductRow[]>([]);
  const [productsTotals, setProductsTotals] = useState<DashboardProductTotals | null>(null);
  const [productsTotal, setProductsTotal] = useState(0);
  const [productsNextOffset, setProductsNextOffset] = useState(0);
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  const [error, setError] = useState("");
  const [productsError, setProductsError] = useState("");
  const [productsSearch, setProductsSearch] = useState("");
  const [exportingProducts, setExportingProducts] = useState(false);
  const [incomePayments, setIncomePayments] = useState<DashboardPaymentRow[]>([]);
  const [outcomePayments, setOutcomePayments] = useState<DashboardPaymentRow[]>([]);
  const [incomePaymentsCount, setIncomePaymentsCount] = useState(0);
  const [outcomePaymentsCount, setOutcomePaymentsCount] = useState(0);
  const [incomePaymentCategoryName, setIncomePaymentCategoryName] = useState<string | null>(null);
  const [outcomePaymentCategoryName, setOutcomePaymentCategoryName] = useState<string | null>(null);
  const [paymentsNextOffset, setPaymentsNextOffset] = useState(0);
  const [loadingMorePayments, setLoadingMorePayments] = useState(false);
  const [paymentsError, setPaymentsError] = useState("");
  const [paymentsSearch, setPaymentsSearch] = useState("");
  const [exportingPayments, setExportingPayments] = useState(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>("totals");
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches,
  );
  const [availableCurrencies, setAvailableCurrencies] = useState<RegosCurrencyOption[]>([]);
  const [currencyFilter, setCurrencyFilter] = useState<DashboardCurrencyFilter | null>(null);
  const [defaultsReady, setDefaultsReady] = useState(false);

  const periodParams = useMemo(
    () => resolveDashboardPeriodParams(periodPreset, customRange),
    [customRange, periodPreset],
  );

  const queryParams = useMemo(
    () =>
      resolveDashboardQueryParams(periodParams, {
        allStocks,
        stockIds: selectedStockIds,
        allPartners,
        partnerIds: selectedPartnerIds,
        currencyFilter,
      }),
    [
      allPartners,
      allStocks,
      currencyFilter,
      periodParams,
      allPartners ? undefined : selectedPartnerIds,
      allStocks ? undefined : selectedStockIds,
    ],
  );

  const dashboardQueryKey = useMemo(
    () => serializeDashboardQueryParams(queryParams),
    [
      allPartners,
      allStocks,
      periodParams.start_date,
      periodParams.end_date,
      allPartners ? "" : selectedPartnerIds.join(","),
      allStocks ? "" : selectedStockIds.join(","),
      currencyFilter?.currencyId,
      currencyFilter?.mode,
    ],
  );

  const currencyFilterOptions = useMemo(
    () => buildDashboardCurrencyFilterOptions(availableCurrencies, t),
    [availableCurrencies, t],
  );

  const periodModalRange = useMemo(() => {
    if (periodPreset === "custom" && customRange) return customRange;
    if (periodPreset !== "custom") return presetToCustomRange(periodPreset);
    return presetToCustomRange("week");
  }, [customRange, periodPreset]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const update = () => setIsNarrow(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  const productsSearchQuery = productsSearch.trim().toLowerCase();
  const filteredProducts = useMemo(
    () => products.filter((product) => productMatchesSearch(product, productsSearchQuery)),
    [products, productsSearchQuery],
  );

  const paymentsSearchQuery = paymentsSearch.trim().toLowerCase();
  const filteredIncomePayments = useMemo(
    () => incomePayments.filter((payment) => paymentMatchesSearch(payment, paymentsSearchQuery)),
    [incomePayments, paymentsSearchQuery],
  );
  const filteredOutcomePayments = useMemo(
    () => outcomePayments.filter((payment) => paymentMatchesSearch(payment, paymentsSearchQuery)),
    [outcomePayments, paymentsSearchQuery],
  );
  const loadedPaymentsCount = incomePayments.length + outcomePayments.length;
  const filteredPaymentsCount = filteredIncomePayments.length + filteredOutcomePayments.length;
  const totalPaymentsCount = incomePaymentsCount + outcomePaymentsCount;

  useEffect(() => {
    if (!token) {
      setWarehouses([]);
      setPartners([]);
      setDefaultsReady(false);
      return;
    }

    let cancelled = false;
    setDefaultsReady(false);
    void Promise.all([fetchRegosReferenceOptions(token), fetchRegosDefaults(token)])
      .then(([options, defaultsResponse]) => {
        if (cancelled) return;
        setWarehouses(options.warehouses);
        setPartners(options.partners);
        const currencies = collectDashboardCurrencies(
          options.price_types,
          defaultsResponse.defaults.currency,
        );
        setAvailableCurrencies(currencies);
        setCurrencyFilter((current) => {
          if (current) return current;
          const defaultCurrency = defaultsResponse.defaults.currency;
          if (!defaultCurrency?.id) return null;
          return { currencyId: defaultCurrency.id, mode: "all" };
        });
        setSelectedStockIds((current) =>
          current.length > 0 ? current : options.warehouses.map((warehouse) => warehouse.id),
        );
        setSelectedPartnerIds((current) =>
          current.length > 0 ? current : options.partners.map((partner) => partner.id),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setWarehouses([]);
          setPartners([]);
        }
      })
      .finally(() => {
        if (!cancelled) setDefaultsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const dashboardDataQuery = useQuery({
    queryKey: ["dashboard", "initial", token, dashboardQueryKey],
    queryFn: async () => {
      const [overview, payments] = await Promise.all([
        fetchDashboardOverview(token!, queryParams),
        fetchDashboardPayments(token!, queryParams),
      ]);
      return { overview, payments };
    },
    enabled: Boolean(token) && defaultsReady,
    staleTime: 30_000,
  });

  const loading = dashboardDataQuery.isPending;
  const productsLoading = dashboardDataQuery.isPending;
  const paymentsLoading = dashboardDataQuery.isPending;
  const loadError = dashboardDataQuery.error
    ? formatAuthError(dashboardDataQuery.error, t("dashboard.errors.load"))
    : "";

  useEffect(() => {
    if (!token || !defaultsReady) return;

    setStats(null);
    setProducts([]);
    setProductsTotals(null);
    setProductsTotal(0);
    setProductsNextOffset(0);
    setIncomePayments([]);
    setOutcomePayments([]);
    setIncomePaymentsCount(0);
    setOutcomePaymentsCount(0);
    setIncomePaymentCategoryName(null);
    setOutcomePaymentCategoryName(null);
    setPaymentsNextOffset(0);
  }, [dashboardQueryKey, defaultsReady, token]);

  useEffect(() => {
    if (!token) {
      setStats(null);
      setProducts([]);
      setProductsTotals(null);
      setProductsTotal(0);
      setProductsNextOffset(0);
      setIncomePayments([]);
      setOutcomePayments([]);
      setIncomePaymentsCount(0);
      setOutcomePaymentsCount(0);
      setIncomePaymentCategoryName(null);
      setOutcomePaymentCategoryName(null);
      setPaymentsNextOffset(0);
      setError("");
      setProductsError("");
      setPaymentsError("");
      return;
    }

    setError(loadError);
    setProductsError(loadError);
    setPaymentsError(loadError);

    const data = dashboardDataQuery.data;
    if (!data) return;

    const { overview, payments } = data;
    setStats(overview.stats);
    setProducts(overview.products);
    setProductsTotals(overview.totals);
    setProductsTotal(overview.total);
    setProductsNextOffset(overview.next_offset);
    setIncomePayments(payments.income_payments);
    setOutcomePayments(payments.outcome_payments);
    setIncomePaymentsCount(payments.income_total);
    setOutcomePaymentsCount(payments.outcome_total);
    setIncomePaymentCategoryName(payments.income_payment_category_name);
    setOutcomePaymentCategoryName(payments.outcome_payment_category_name);
    setPaymentsNextOffset(payments.next_offset);
  }, [dashboardDataQuery.data, loadError, token]);

  const loadMoreProducts = () => {
    if (!token || !productsNextOffset || loadingMoreProducts) return;

    setLoadingMoreProducts(true);
    setProductsError("");

    void fetchDashboardProducts(token, { ...queryParams, offset: productsNextOffset })
      .then((res) => {
        setProducts((current) => {
          const seen = new Set(current.map((row) => row.item_id));
          const merged = [...current];
          for (const row of res.products) {
            if (!seen.has(row.item_id)) {
              seen.add(row.item_id);
              merged.push(row);
            }
          }
          return merged;
        });
        setProductsTotal(res.total);
        setProductsNextOffset(res.next_offset);
      })
      .catch((err: unknown) => {
        setProductsError(formatAuthError(err, t("dashboard.errors.loadMoreProducts")));
      })
      .finally(() => {
        setLoadingMoreProducts(false);
      });
  };

  const exportProducts = () => {
    if (!token || exportingProducts) return;

    setExportingProducts(true);
    setProductsError("");

    void fetchAllDashboardProducts(token, queryParams)
      .then(({ products: allProducts, totals }) => {
        exportDashboardProductsToExcel(
          allProducts,
          totals,
          t,
          formatDashboardPeriodLabel(periodPreset, customRange, t),
        );
      })
      .catch((err: unknown) => {
        setProductsError(formatAuthError(err, t("dashboard.products.exportError")));
      })
      .finally(() => {
        setExportingProducts(false);
      });
  };

  const loadMorePayments = () => {
    if (!token || !paymentsNextOffset || loadingMorePayments) return;

    setLoadingMorePayments(true);
    setPaymentsError("");

    void fetchDashboardPayments(token, { ...queryParams, offset: paymentsNextOffset })
      .then((res) => {
        setIncomePayments((current) => {
          const seen = new Set(current.map((row) => row.id));
          const merged = [...current];
          for (const row of res.income_payments) {
            if (!seen.has(row.id)) {
              seen.add(row.id);
              merged.push(row);
            }
          }
          return merged;
        });
        setOutcomePayments((current) => {
          const seen = new Set(current.map((row) => row.id));
          const merged = [...current];
          for (const row of res.outcome_payments) {
            if (!seen.has(row.id)) {
              seen.add(row.id);
              merged.push(row);
            }
          }
          return merged;
        });
        setIncomePaymentsCount(res.income_total);
        setOutcomePaymentsCount(res.outcome_total);
        setPaymentsNextOffset(res.next_offset);
      })
      .catch((err: unknown) => {
        setPaymentsError(formatAuthError(err, t("dashboard.errors.loadMorePayments")));
      })
      .finally(() => {
        setLoadingMorePayments(false);
      });
  };

  const exportPayments = () => {
    if (!token || exportingPayments) return;

    setExportingPayments(true);
    setPaymentsError("");

    void fetchAllDashboardPayments(token, queryParams)
      .then((payments) => {
        exportDashboardPaymentsToExcel(
          payments.income_payments,
          payments.outcome_payments,
          payments.income_payments_total,
          payments.outcome_payments_total,
          payments.income_payment_category_name,
          payments.outcome_payment_category_name,
          t,
          formatDashboardPeriodLabel(periodPreset, customRange, t),
        );
      })
      .catch((err: unknown) => {
        setPaymentsError(formatAuthError(err, t("dashboard.payments.exportError")));
      })
      .finally(() => {
        setExportingPayments(false);
      });
  };

  const topPartners = stats?.top_partners.map((entry) => ({
    name: entry.name,
    value: entry.count,
  })) ?? [];
  const topProducts = stats?.top_products ?? [];
  const topProductsChartHeightPx = topProductsChartHeight(topProducts);
  const displayCurrency = stats?.summary_currency ?? null;
  const formatChartCurrency = (value: number) => formatDashboardAmountText(value, displayCurrency);
  const currencyFilterValue = currencyFilter ? currencyFilterKey(currencyFilter) : "";

  const dashboardTabLabel = (tab: DashboardTab) => {
    if (tab === "totals") return t("dashboard.tabs.totals");
    if (tab === "payments") return t("dashboard.tabs.payments");
    return t("dashboard.tabs.products");
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("dashboard.title")}</h1>
          <div className={styles.subtitle}>
            {loading
              ? t("common.loadingFromRegos")
              : `${formatDashboardPeriodLabel(periodPreset, customRange, t)} · ${formatPartnerFilterLabel(allPartners, selectedPartnerIds, partners, t)} · ${formatWarehouseFilterLabel(allStocks, selectedStockIds, warehouses, t)}`}
          </div>
        </div>
        <div className={styles.filters}>
          {(["today", "week", "month", "all"] as PresetPeriod[]).map((value) => (
            <button
              key={value}
              type="button"
              className={clsx(styles.filter, periodPreset === value && styles.filterActive)}
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
              styles.filter,
              styles.filterMenu,
              periodPreset === "custom" && styles.filterActive,
            )}
            onClick={() => setPeriodModalOpen(true)}
          >
            <CalendarRange size={14} />
            {t("dashboard.period")}
          </button>
          <button
            type="button"
            className={clsx(styles.filter, styles.filterMenu)}
            onClick={() => setPartnerModalOpen(true)}
          >
            <Users size={14} />
            {formatPartnerFilterLabel(allPartners, selectedPartnerIds, partners, t)}
          </button>
          <button
            type="button"
            className={clsx(styles.filter, styles.filterMenu)}
            onClick={() => setWarehouseModalOpen(true)}
          >
            <Warehouse size={14} />
            {formatWarehouseFilterLabel(allStocks, selectedStockIds, warehouses, t)}
          </button>
          {currencyFilterOptions.length > 0 && (
            <label className={clsx(styles.filter, styles.filterMenu, styles.currencyFilter)}>
              <Coins size={14} />
              <select
                className={styles.currencyFilterSelect}
                value={currencyFilterValue}
                onChange={(event) => {
                  const next = parseCurrencyFilterKey(event.target.value);
                  if (next) setCurrencyFilter(next);
                }}
                aria-label={t("dashboard.currencyFilter.label", "Currency")}
              >
                {currencyFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className={styles.dashboardTabs} role="tablist" aria-label={t("dashboard.tabs.label")}>
        {DASHBOARD_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`dashboard-tab-${tab}`}
            className={clsx(styles.dashboardTab, activeTab === tab && styles.dashboardTabActive)}
            aria-selected={activeTab === tab}
            aria-controls={`dashboard-panel-${tab}`}
            onClick={() => setActiveTab(tab)}
          >
            {dashboardTabLabel(tab)}
          </button>
        ))}
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
      <DashboardPartnersModal
        open={partnerModalOpen}
        onClose={() => setPartnerModalOpen(false)}
        partners={partners}
        allPartners={allPartners}
        selectedPartnerIds={selectedPartnerIds}
        onApply={({ allPartners: nextAllPartners, partnerIds }) => {
          setAllPartners(nextAllPartners);
          setSelectedPartnerIds(partnerIds);
        }}
      />
      <DashboardWarehousesModal
        open={warehouseModalOpen}
        onClose={() => setWarehouseModalOpen(false)}
        warehouses={warehouses}
        allStocks={allStocks}
        selectedStockIds={selectedStockIds}
        onApply={({ allStocks: nextAllStocks, stockIds }) => {
          setAllStocks(nextAllStocks);
          setSelectedStockIds(stockIds);
        }}
      />

      {error && <div className={styles.empty}>{error}</div>}

      {activeTab === "totals" ? (
        <div
          id="dashboard-panel-totals"
          role="tabpanel"
          aria-labelledby="dashboard-tab-totals"
          className={styles.dashboardPanel}
        >
      <div className={styles.totalsWidget}>
        <div className={styles.totalsHeader}>
          <div className={styles.totalsTitle}>{t("dashboard.totals.title")}</div>
          <div className={styles.totalsSub}>{t("dashboard.totals.subtitle")}</div>
        </div>
        <div className={styles.totalsGrid}>
          <div className={styles.totalItem}>
            <div className={styles.totalLabel}>{t("dashboard.totals.totalSales")}</div>
            <DashboardAmount
              amount={stats?.net_sales_total ?? 0}
              currency={displayCurrency}
              loading={loading}
              className={styles.totalValue}
            />
          </div>
          <div className={styles.totalItem}>
            <div className={styles.totalLabel}>{t("dashboard.totals.totalCost")}</div>
            <DashboardInlineAmount
              amount={stats?.net_cost_total ?? 0}
              currency={displayCurrency}
              loading={loading}
              className={styles.totalValue}
            />
          </div>
          <div className={styles.totalItem}>
            <div className={styles.totalLabel}>{t("dashboard.totals.grossProfit")}</div>
            <DashboardInlineAmount
              amount={stats?.net_gross_profit ?? 0}
              currency={displayCurrency}
              loading={loading}
              className={styles.totalValue}
            />
          </div>
        </div>
      </div>

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>{t("dashboard.kpi.grossSales")}</div>
          <DashboardAmount
            amount={stats?.sales_total ?? 0}
            currency={displayCurrency}
            loading={loading}
            className={styles.kpiValue}
          />
          <div className={styles.kpiDelta}>
            {loading
              ? "…"
              : t("dashboard.kpi.transactions", undefined, { n: stats?.transaction_count ?? 0 })}
          </div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>{t("dashboard.kpi.grossCost")}</div>
          <DashboardInlineAmount
            amount={stats?.cost_total ?? 0}
            currency={displayCurrency}
            loading={loading}
            className={styles.kpiValue}
          />
          <div className={styles.kpiDelta}>{t("dashboard.kpi.beforeRefunds")}</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>{t("dashboard.kpi.grossProfit")}</div>
          <DashboardInlineAmount
            amount={stats?.gross_profit ?? 0}
            currency={displayCurrency}
            loading={loading}
            className={styles.kpiValue}
          />
          <div className={styles.kpiDelta}>{t("dashboard.kpi.beforeRefunds")}</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>{t("dashboard.kpi.refunds")}</div>
          <DashboardAmount
            amount={stats?.refunds_total ?? 0}
            currency={displayCurrency}
            loading={loading}
            className={styles.kpiValue}
          />
          <div className={styles.kpiDelta}>
            {loading
              ? "…"
              : t("dashboard.kpi.returnsCost", undefined, {
                  n: stats?.refund_count ?? 0,
                  cost: formatDashboardAmountText(stats?.refunds_cost_total ?? 0, displayCurrency),
                })}
          </div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>{t("dashboard.kpi.incomePayments")}</div>
          <DashboardAmount
            amount={stats?.income_payments_total ?? 0}
            currency={displayCurrency}
            loading={loading}
            className={styles.kpiValue}
          />
          <div className={styles.kpiDelta}>
            {stats?.income_payment_category_name ?? t("dashboard.kpi.noIncomeCategory")}
          </div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>{t("dashboard.kpi.outcomePayments")}</div>
          <DashboardAmount
            amount={stats?.outcome_payments_total ?? 0}
            currency={displayCurrency}
            loading={loading}
            className={styles.kpiValue}
          />
          <div className={styles.kpiDelta}>
            {stats?.outcome_payment_category_name ?? t("dashboard.kpi.noRefundCategory")}
          </div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>{t("dashboard.kpi.itemsSold")}</div>
          <div className={styles.kpiValue}>
            {loading ? "—" : stats?.items_sold ?? 0}
          </div>
          <div className={styles.kpiDelta}>
            {loading
              ? "…"
              : t("dashboard.kpi.avgBasket", undefined, {
                  amount: formatDashboardAmountText(stats?.avg_basket ?? 0, displayCurrency),
                })}
          </div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>{t("dashboard.kpi.allTimeSales")}</div>
          <div className={styles.kpiValue}>
            {loading ? "—" : stats?.sales_count_total ?? 0}
          </div>
          <div className={styles.kpiDelta}>{t("dashboard.kpi.transactionsInRegos")}</div>
        </div>
      </div>

      <div className={styles.charts}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>{t("dashboard.charts.salesCostProfit")}</div>
          <div className={styles.cardSub}>{t("dashboard.charts.dailyTotals")}</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats?.days ?? []} margin={{ left: -12, right: 8, top: 8 }}>
              <CartesianGrid stroke="#eef0f6" vertical={false} />
              <XAxis dataKey="day" stroke="#8a93a6" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#8a93a6" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(v: number) => formatChartCurrency(v)}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid #e3e6ee",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="sales" name={t("dashboard.charts.sales")} stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="cost" name={t("dashboard.charts.cost")} stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="profit" name={t("dashboard.charts.profit")} stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>{t("dashboard.charts.topPartners")}</div>
          <div className={styles.cardSub}>{t("dashboard.charts.byTransactionCount")}</div>
          {topPartners.length === 0 && !loading ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "80px 0", textAlign: "center" }}>
              {t("dashboard.charts.noSales")}
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={topPartners}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                  >
                    {topPartners.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: 10, border: "1px solid #e3e6ee", fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, fontSize: 12, color: "var(--color-text-muted)" }}>
                {topPartners.map((entry, i) => (
                  <span key={entry.name}>
                    ● <span style={{ color: COLORS[i % COLORS.length] }}>{entry.name}</span> {entry.value}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className={styles.row2}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>{t("dashboard.charts.bestSellers")}</div>
          <div className={styles.cardSub}>{formatDashboardPeriodLabel(periodPreset, customRange, t)}</div>
          {(topProducts.length ?? 0) === 0 && !loading ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "80px 0", textAlign: "center" }}>
              {t("dashboard.charts.noSales")}
            </div>
          ) : isNarrow ? (
            <>
              <TopProductsRevenueList
                products={topProducts}
                displayCurrency={displayCurrency}
              />
              <div className={styles.cardSection}>
                <BestSellersSection
                  products={stats?.top_products ?? []}
                  loading={loading}
                  t={t}
                  showTitle={false}
                />
              </div>
            </>
          ) : (
            <ResponsiveContainer width="100%" height={topProductsChartHeightPx}>
              <BarChart
                data={topProducts.map((item) => ({
                  name: item.name,
                  revenue: +item.revenue.toFixed(2),
                }))}
                layout="vertical"
                margin={{ left: 4, right: 16, top: 8, bottom: 8 }}
                barCategoryGap={20}
              >
                <CartesianGrid stroke="#eef0f6" horizontal={false} />
                <XAxis type="number" stroke="#8a93a6" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke="#8a93a6"
                  tickLine={false}
                  axisLine={false}
                  width={TOP_PRODUCT_LABEL_WIDTH}
                  tick={ProductRevenueYAxisTick}
                />
                <Tooltip
                  formatter={(v: number) => formatChartCurrency(v)}
                  contentStyle={{ borderRadius: 10, border: "1px solid #e3e6ee", fontSize: 12 }}
                />
                <Bar dataKey="revenue" radius={[0, 6, 6, 0]}>
                  {topProducts.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {!isNarrow && (
          <div className={styles.card}>
            <BestSellersSection products={stats?.top_products ?? []} loading={loading} t={t} />
          </div>
        )}
      </div>
        </div>
      ) : null}

      {activeTab === "payments" ? (
        <div
          id="dashboard-panel-payments"
          role="tabpanel"
          aria-labelledby="dashboard-tab-payments"
          className={styles.dashboardPanel}
        >
          <div className={styles.cardTitle}>{t("dashboard.tabs.payments")}</div>
          <div className={styles.cardSub}>
            {formatDashboardPeriodLabel(periodPreset, customRange, t)}
            {totalPaymentsCount > 0
              ? paymentsSearchQuery
                ? ` · ${t("dashboard.payments.shown", undefined, {
                    n: filteredPaymentsCount,
                    m: loadedPaymentsCount,
                  })}`
                : ` · ${loadedPaymentsCount} of ${totalPaymentsCount}`
              : ""}
          </div>
          {loadedPaymentsCount > 0 && (
            <div className={styles.productsToolbar}>
              <div className={styles.productsSearch}>
                <Search size={16} className={styles.productsSearchIcon} />
                <input
                  className={styles.productsSearchInput}
                  type="search"
                  placeholder={t("dashboard.payments.searchPlaceholder")}
                  value={paymentsSearch}
                  onChange={(event) => setPaymentsSearch(event.target.value)}
                  aria-label={t("dashboard.payments.searchAria")}
                />
              </div>
              <button
                type="button"
                className={styles.exportButton}
                onClick={exportPayments}
                disabled={exportingPayments || paymentsLoading}
              >
                <Download size={14} />
                {exportingPayments
                  ? t("dashboard.payments.exporting")
                  : t("dashboard.payments.exportExcel")}
              </button>
            </div>
          )}
          {paymentsError && <div className={styles.empty}>{paymentsError}</div>}
          <div className={clsx(styles.row2, styles.paymentsSection)}>
            <div className={styles.card}>
              <div className={styles.cardTitle}>{t("dashboard.payments.income")}</div>
              <div className={styles.cardSub}>
                {incomePaymentCategoryName
                  ? t("dashboard.payments.category", undefined, { name: incomePaymentCategoryName })
                  : t("dashboard.kpi.noIncomeCategory")}
              </div>
              {incomePayments.length === 0 && !paymentsLoading && !paymentsError ? (
                <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
                  {t("dashboard.payments.empty")}
                </div>
              ) : filteredIncomePayments.length === 0 && !paymentsLoading ? (
                <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
                  {t("dashboard.payments.emptySearch")}
                </div>
              ) : paymentsLoading && incomePayments.length === 0 ? (
                <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
                  {t("dashboard.payments.loading")}
                </div>
              ) : (
                <DashboardPaymentTable payments={filteredIncomePayments} t={t} />
              )}
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>{t("dashboard.payments.outcome")}</div>
              <div className={styles.cardSub}>
                {outcomePaymentCategoryName
                  ? t("dashboard.payments.category", undefined, { name: outcomePaymentCategoryName })
                  : t("dashboard.kpi.noRefundCategory")}
              </div>
              {outcomePayments.length === 0 && !paymentsLoading && !paymentsError ? (
                <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
                  {t("dashboard.payments.empty")}
                </div>
              ) : filteredOutcomePayments.length === 0 && !paymentsLoading ? (
                <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
                  {t("dashboard.payments.emptySearch")}
                </div>
              ) : paymentsLoading && outcomePayments.length === 0 ? (
                <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
                  {t("dashboard.payments.loading")}
                </div>
              ) : (
                <DashboardPaymentTable payments={filteredOutcomePayments} t={t} />
              )}
            </div>
          </div>
          {paymentsNextOffset > 0 && (
            <div className={styles.productsFooter}>
              <button
                type="button"
                className={styles.loadMore}
                onClick={loadMorePayments}
                disabled={loadingMorePayments}
              >
                {loadingMorePayments
                  ? t("common.loading")
                  : t("dashboard.payments.loadMore", undefined, { n: DASHBOARD_PAYMENTS_PAGE_SIZE })}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "products" ? (
      <div
        id="dashboard-panel-products"
        role="tabpanel"
        aria-labelledby="dashboard-tab-products"
        className={clsx(styles.dashboardPanel, styles.card, styles.productsCard)}
      >
        <div className={styles.cardTitle}>{t("dashboard.products.title")}</div>
        <div className={styles.cardSub}>
          {formatDashboardPeriodLabel(periodPreset, customRange, t)} · {t("dashboard.products.subtitle")}
          {productsTotal > 0
            ? productsSearchQuery
              ? ` · ${t("dashboard.products.shown", undefined, { n: filteredProducts.length, m: products.length })}`
              : ` · ${products.length} of ${productsTotal}`
            : ""}
        </div>
        {products.length > 0 && (
          <div className={styles.productsToolbar}>
            <div className={styles.productsSearch}>
              <Search size={16} className={styles.productsSearchIcon} />
              <input
                className={styles.productsSearchInput}
                type="search"
                placeholder={t("dashboard.products.searchPlaceholder")}
                value={productsSearch}
                onChange={(event) => setProductsSearch(event.target.value)}
                aria-label={t("dashboard.products.searchAria")}
              />
            </div>
            <button
              type="button"
              className={styles.exportButton}
              onClick={exportProducts}
              disabled={exportingProducts || productsLoading}
            >
              <Download size={14} />
              {exportingProducts
                ? t("dashboard.products.exporting")
                : t("dashboard.products.exportExcel")}
            </button>
          </div>
        )}
        {productsError && <div className={styles.empty}>{productsError}</div>}
        {products.length === 0 && !productsLoading && !productsError ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
            {t("dashboard.products.empty")}
          </div>
        ) : filteredProducts.length === 0 && !productsLoading ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
            {t("dashboard.products.emptySearch")}
          </div>
        ) : (
          <div className={styles.productsTableWrap}>
            <table className={styles.productsTable}>
              <thead>
                <tr>
                  <th className={styles.groupHead} colSpan={5}>
                    {t("dashboard.products.title")}
                  </th>
                  <th className={styles.groupHead} colSpan={3}>
                    {t("dashboard.products.group.sell")}
                  </th>
                  <th className={styles.groupHead} colSpan={3}>
                    {t("dashboard.products.group.refund")}
                  </th>
                  <th className={styles.groupHead} colSpan={4}>
                    {t("dashboard.products.group.net")}
                  </th>
                </tr>
                <tr>
                  <th>{t("dashboard.products.col.code")}</th>
                  <th>{t("dashboard.products.col.name")}</th>
                  <th>{t("dashboard.products.col.category")}</th>
                  <th className={styles.num}>{t("dashboard.products.col.purchaseCost")}</th>
                  <th className={styles.num}>{t("dashboard.products.col.avgPrice")}</th>
                  <th className={styles.num}>{t("dashboard.products.col.qty")}</th>
                  <th className={styles.num}>{t("dashboard.products.col.purchaseCost")}</th>
                  <th className={styles.num}>{t("dashboard.products.col.totalSells")}</th>
                  <th className={styles.num}>{t("dashboard.products.col.qty")}</th>
                  <th className={styles.num}>{t("dashboard.products.col.purchaseCost")}</th>
                  <th className={styles.num}>{t("dashboard.products.col.totalRefunds")}</th>
                  <th className={styles.num}>{t("dashboard.products.col.qty")}</th>
                  <th className={styles.num}>{t("dashboard.products.col.purchaseCost")}</th>
                  <th className={styles.num}>{t("dashboard.products.col.totalSells")}</th>
                  <th className={styles.num}>{t("dashboard.products.col.grossProfit")}</th>
                </tr>
              </thead>
              <tbody>
                {productsLoading && products.length === 0 ? (
                  <tr>
                    <td colSpan={15} style={{ color: "var(--color-text-muted)", padding: "24px 10px" }}>
                      {t("dashboard.products.loading")}
                    </td>
                  </tr>
                ) : (
                  <>
                    {productsTotals && !productsSearchQuery ? (
                      <DashboardProductTotalsRow totals={productsTotals} t={t} />
                    ) : null}
                    {filteredProducts.map((product) => (
                    <tr key={product.item_id}>
                      <td>{product.code || "—"}</td>
                      <td className={styles.nameCell} title={product.name}>
                        {product.name}
                      </td>
                      <td>{product.category || "—"}</td>
                      <td className={styles.num}>{formatOptionalCurrency(product.purchase_cost)}</td>
                      <td className={styles.num}>{formatCurrency(product.average_price)}</td>
                      <td className={styles.num}>{formatQty(product.sold_quantity)}</td>
                      <td className={styles.num}>{formatCurrency(product.sold_purchase_cost)}</td>
                      <td className={styles.num}>{formatCurrency(product.sold_total)}</td>
                      <td className={styles.num}>{formatQty(product.refund_quantity)}</td>
                      <td className={styles.num}>{formatCurrency(product.refund_purchase_cost)}</td>
                      <td className={styles.num}>{formatCurrency(product.refund_total)}</td>
                      <td className={styles.num}>{formatQty(product.net_sold_quantity)}</td>
                      <td className={styles.num}>{formatCurrency(product.net_purchase_cost)}</td>
                      <td className={styles.num}>{formatCurrency(product.net_total_sells)}</td>
                      <td className={styles.num}>{formatCurrency(product.net_gross_profit)}</td>
                    </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
        {productsNextOffset > 0 && (
          <div className={styles.productsFooter}>
            <button
              type="button"
              className={styles.loadMore}
              onClick={loadMoreProducts}
              disabled={loadingMoreProducts}
            >
              {loadingMoreProducts
                ? t("common.loading")
                : t("dashboard.products.loadMore", undefined, { n: DASHBOARD_PRODUCTS_PAGE_SIZE })}
            </button>
          </div>
        )}
      </div>
      ) : null}
    </div>
  );
}
