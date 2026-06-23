import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CalendarRange, Search, Warehouse } from "lucide-react";
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
import {
  DASHBOARD_PRODUCTS_PAGE_SIZE,
  fetchDashboardProducts,
  fetchDashboardStats,
  formatDashboardPeriodLabel,
  PERIOD_LABELS,
  presetToCustomRange,
  resolveDashboardQueryParams,
  type DashboardCustomRange,
  type DashboardPeriodPreset,
  type DashboardPaymentRow,
  type DashboardProductRow,
  type DashboardStats,
  type DashboardTopProduct,
} from "@/lib/dashboard-api";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import type { RegosDefaultOption } from "@/types/settings";
import { DashboardPeriodModal } from "@/components/Dashboard/DashboardPeriodModal";
import {
  DashboardWarehousesModal,
  formatWarehouseFilterLabel,
} from "@/components/Dashboard/DashboardWarehousesModal";
import { formatCurrency, formatDateTime } from "@/lib/format";
import styles from "./Dashboard.module.css";

const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444"];
const TOP_PRODUCT_LABEL_WIDTH = 260;
const TOP_PRODUCT_LABEL_LINE_HEIGHT = 15;
const TOP_PRODUCT_LABEL_MAX_CHARS = 38;

type PresetPeriod = Exclude<DashboardPeriodPreset, "custom">;

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

function DashboardPaymentTable({ payments }: { payments: DashboardPaymentRow[] }) {
  return (
    <div className={styles.paymentTableWrap}>
      <table className={styles.paymentTable}>
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Date</th>
            <th>Type</th>
            <th className={styles.right}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id}>
              <td data-label="Receipt">#{payment.code || payment.id}</td>
              <td data-label="Date">{formatPaymentDate(payment.date)}</td>
              <td data-label="Type">{payment.payment_type_name ?? "—"}</td>
              <td data-label="Amount" className={styles.right}>
                {formatCurrency(payment.amount ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopProductsRevenueList({
  products,
}: {
  products: { item_id: number; name: string; revenue: number }[];
}) {
  return (
    <div className={styles.topList}>
      {products.map((item, index) => (
        <div key={item.item_id} className={styles.topItem}>
          <div className={styles.topRank}>{index + 1}</div>
          <div className={styles.topName}>{item.name}</div>
          <div className={styles.topVal}>{formatCurrency(item.revenue)}</div>
        </div>
      ))}
    </div>
  );
}

function BestSellersSection({
  products,
  loading,
}: {
  products: DashboardTopProduct[];
  loading: boolean;
}) {
  return (
    <>
      <div className={styles.cardTitle}>Best sellers</div>
      <div className={styles.cardSub}>Units sold</div>
      <div className={styles.topList}>
        {products.length === 0 && !loading && (
          <div style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
            No sales in this period.
          </div>
        )}
        {products.map((item, index) => (
          <div key={item.item_id} className={styles.topItem}>
            <div className={styles.topRank}>{index + 1}</div>
            <div className={styles.topName}>{item.name}</div>
            <div className={styles.topVal}>{item.qty} sold</div>
          </div>
        ))}
      </div>
    </>
  );
}

export function DashboardPage() {
  const token = useAuth((s) => s.accessToken);
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("week");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<RegosDefaultOption[]>([]);
  const [allStocks, setAllStocks] = useState(true);
  const [selectedStockIds, setSelectedStockIds] = useState<number[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [products, setProducts] = useState<DashboardProductRow[]>([]);
  const [productsTotal, setProductsTotal] = useState(0);
  const [productsNextOffset, setProductsNextOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  const [error, setError] = useState("");
  const [productsError, setProductsError] = useState("");
  const [productsSearch, setProductsSearch] = useState("");
  const [isNarrow, setIsNarrow] = useState(false);

  const queryParams = useMemo(
    () =>
      resolveDashboardQueryParams(periodPreset, customRange, {
        allStocks,
        stockIds: selectedStockIds,
      }),
    [allStocks, customRange, periodPreset, selectedStockIds],
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

  useEffect(() => {
    if (!token) {
      setWarehouses([]);
      return;
    }

    let cancelled = false;
    void fetchRegosReferenceOptions(token)
      .then((options) => {
        if (cancelled) return;
        setWarehouses(options.warehouses);
        setSelectedStockIds((current) =>
          current.length > 0 ? current : options.warehouses.map((warehouse) => warehouse.id),
        );
      })
      .catch(() => {
        if (!cancelled) setWarehouses([]);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token) {
      setStats(null);
      setProducts([]);
      setProductsTotal(0);
      setProductsNextOffset(0);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setProductsLoading(true);
    setError("");
    setProductsError("");
    setProducts([]);
    setProductsTotal(0);
    setProductsNextOffset(0);

    void fetchDashboardStats(token, queryParams)
      .then((res) => {
        if (!cancelled) setStats(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStats(null);
        setError(formatAuthError(err, "Failed to load dashboard"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    void fetchDashboardProducts(token, { ...queryParams, offset: 0 })
      .then((res) => {
        if (cancelled) return;
        setProducts(res.products);
        setProductsTotal(res.total);
        setProductsNextOffset(res.next_offset);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProducts([]);
        setProductsTotal(0);
        setProductsNextOffset(0);
        setProductsError(formatAuthError(err, "Failed to load products"));
      })
      .finally(() => {
        if (!cancelled) setProductsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, queryParams]);

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
        setProductsError(formatAuthError(err, "Failed to load more products"));
      })
      .finally(() => {
        setLoadingMoreProducts(false);
      });
  };

  const topPartners = stats?.top_partners.map((entry) => ({
    name: entry.name,
    value: entry.count,
  })) ?? [];
  const topProducts = stats?.top_products ?? [];
  const topProductsChartHeightPx = topProductsChartHeight(topProducts);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard</h1>
          <div className={styles.subtitle}>
            {loading
              ? "Loading from Regos…"
              : `${formatDashboardPeriodLabel(periodPreset, customRange)} · ${formatWarehouseFilterLabel(allStocks, selectedStockIds, warehouses)}`}
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
              {PERIOD_LABELS[value]}
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
            Period
          </button>
          <button
            type="button"
            className={clsx(styles.filter, styles.filterMenu)}
            onClick={() => setWarehouseModalOpen(true)}
          >
            <Warehouse size={14} />
            {formatWarehouseFilterLabel(allStocks, selectedStockIds, warehouses)}
          </button>
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

      <div className={styles.totalsWidget}>
        <div className={styles.totalsHeader}>
          <div className={styles.totalsTitle}>Net totals</div>
          <div className={styles.totalsSub}>Sales, cost, and profit after refunds</div>
        </div>
        <div className={styles.totalsGrid}>
          <div className={styles.totalItem}>
            <div className={styles.totalLabel}>Total sales</div>
            <div className={styles.totalValue}>
              {loading ? "—" : formatCurrency(stats?.net_sales_total ?? 0)}
            </div>
          </div>
          <div className={styles.totalItem}>
            <div className={styles.totalLabel}>Total cost</div>
            <div className={styles.totalValue}>
              {loading ? "—" : formatCurrency(stats?.net_cost_total ?? 0)}
            </div>
          </div>
          <div className={styles.totalItem}>
            <div className={styles.totalLabel}>Gross profit</div>
            <div className={styles.totalValue}>
              {loading ? "—" : formatCurrency(stats?.net_gross_profit ?? 0)}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Gross sales</div>
          <div className={styles.kpiValue}>
            {loading ? "—" : formatCurrency(stats?.sales_total ?? 0)}
          </div>
          <div className={styles.kpiDelta}>
            {loading ? "…" : `${stats?.transaction_count ?? 0} transactions`}
          </div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Gross cost</div>
          <div className={styles.kpiValue}>
            {loading ? "—" : formatCurrency(stats?.cost_total ?? 0)}
          </div>
          <div className={styles.kpiDelta}>before refunds</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Gross profit</div>
          <div className={styles.kpiValue}>
            {loading ? "—" : formatCurrency(stats?.gross_profit ?? 0)}
          </div>
          <div className={styles.kpiDelta}>before refunds</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Refunds</div>
          <div className={styles.kpiValue}>
            {loading ? "—" : formatCurrency(stats?.refunds_total ?? 0)}
          </div>
          <div className={styles.kpiDelta}>
            {loading
              ? "…"
              : `${stats?.refund_count ?? 0} returns · cost ${formatCurrency(stats?.refunds_cost_total ?? 0)}`}
          </div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Income payments</div>
          <div className={styles.kpiValue}>
            {loading ? "—" : formatCurrency(stats?.income_payments_total ?? 0)}
          </div>
          <div className={styles.kpiDelta}>
            {stats?.income_payment_category_name ?? "No income category configured"}
          </div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Outcome payments</div>
          <div className={styles.kpiValue}>
            {loading ? "—" : formatCurrency(stats?.outcome_payments_total ?? 0)}
          </div>
          <div className={styles.kpiDelta}>
            {stats?.outcome_payment_category_name ?? "No refund category configured"}
          </div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Items sold</div>
          <div className={styles.kpiValue}>
            {loading ? "—" : stats?.items_sold ?? 0}
          </div>
          <div className={styles.kpiDelta}>
            {loading ? "…" : `${formatCurrency(stats?.avg_basket ?? 0)} avg basket`}
          </div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>All-time sales</div>
          <div className={styles.kpiValue}>
            {loading ? "—" : stats?.sales_count_total ?? 0}
          </div>
          <div className={styles.kpiDelta}>transactions in Regos</div>
        </div>
      </div>

      <div className={styles.charts}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Sales, cost & profit</div>
          <div className={styles.cardSub}>Daily totals for selected period</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats?.days ?? []} margin={{ left: -12, right: 8, top: 8 }}>
              <CartesianGrid stroke="#eef0f6" vertical={false} />
              <XAxis dataKey="day" stroke="#8a93a6" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#8a93a6" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(v: number) => formatCurrency(v)}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid #e3e6ee",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="sales" name="Sales" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="cost" name="Cost" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="profit" name="Profit" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Top partners</div>
          <div className={styles.cardSub}>By transaction count</div>
          {topPartners.length === 0 && !loading ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "80px 0", textAlign: "center" }}>
              No sales in this period.
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
          <div className={styles.cardTitle}>Top products by revenue</div>
          <div className={styles.cardSub}>{formatDashboardPeriodLabel(periodPreset, customRange)}</div>
          {(topProducts.length ?? 0) === 0 && !loading ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "80px 0", textAlign: "center" }}>
              No sales in this period.
            </div>
          ) : isNarrow ? (
            <TopProductsRevenueList products={topProducts} />
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
                  formatter={(v: number) => formatCurrency(v)}
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
          {isNarrow && (
            <div className={styles.cardSection}>
              <BestSellersSection products={stats?.top_products ?? []} loading={loading} />
            </div>
          )}
        </div>

        {!isNarrow && (
          <div className={styles.card}>
            <BestSellersSection products={stats?.top_products ?? []} loading={loading} />
          </div>
        )}
      </div>

      <div className={styles.row2} style={{ marginTop: "var(--space-4)" }}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Income payments</div>
          <div className={styles.cardSub}>
            {stats?.income_payment_category_name
              ? `Category: ${stats.income_payment_category_name}`
              : "No income category configured"}
          </div>
          {(stats?.income_payments.length ?? 0) === 0 && !loading ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
              No matching payments in this period.
            </div>
          ) : (
            <DashboardPaymentTable payments={stats?.income_payments ?? []} />
          )}
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Outcome payments</div>
          <div className={styles.cardSub}>
            {stats?.outcome_payment_category_name
              ? `Category: ${stats.outcome_payment_category_name}`
              : "No refund category configured"}
          </div>
          {(stats?.outcome_payments.length ?? 0) === 0 && !loading ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
              No matching payments in this period.
            </div>
          ) : (
            <DashboardPaymentTable payments={stats?.outcome_payments ?? []} />
          )}
        </div>
      </div>

      <div className={clsx(styles.card, styles.productsCard)}>
        <div className={styles.cardTitle}>Products</div>
        <div className={styles.cardSub}>
          {formatDashboardPeriodLabel(periodPreset, customRange)} · sold or refunded only
          {productsTotal > 0
            ? productsSearchQuery
              ? ` · ${filteredProducts.length} of ${products.length} shown`
              : ` · ${products.length} of ${productsTotal}`
            : ""}
        </div>
        {products.length > 0 && (
          <div className={styles.productsSearch}>
            <Search size={16} className={styles.productsSearchIcon} />
            <input
              className={styles.productsSearchInput}
              type="search"
              placeholder="Search loaded products…"
              value={productsSearch}
              onChange={(event) => setProductsSearch(event.target.value)}
              aria-label="Search products"
            />
          </div>
        )}
        {productsError && <div className={styles.empty}>{productsError}</div>}
        {products.length === 0 && !productsLoading && !productsError ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
            No sold or refunded products in this period.
          </div>
        ) : filteredProducts.length === 0 && !productsLoading ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
            No products match your search.
          </div>
        ) : (
          <div className={styles.productsTableWrap}>
            <table className={styles.productsTable}>
              <thead>
                <tr>
                  <th className={styles.groupHead} colSpan={5}>
                    Product
                  </th>
                  <th className={styles.groupHead} colSpan={3}>
                    Sell
                  </th>
                  <th className={styles.groupHead} colSpan={3}>
                    Refund
                  </th>
                  <th className={styles.groupHead} colSpan={4}>
                    Net
                  </th>
                </tr>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th className={styles.num}>Purchase cost</th>
                  <th className={styles.num}>Avg price</th>
                  <th className={styles.num}>Qty</th>
                  <th className={styles.num}>Purchase cost</th>
                  <th className={styles.num}>Total sells</th>
                  <th className={styles.num}>Qty</th>
                  <th className={styles.num}>Purchase cost</th>
                  <th className={styles.num}>Total refunds</th>
                  <th className={styles.num}>Qty</th>
                  <th className={styles.num}>Purchase cost</th>
                  <th className={styles.num}>Total sells</th>
                  <th className={styles.num}>Gross profit</th>
                </tr>
              </thead>
              <tbody>
                {productsLoading && products.length === 0 ? (
                  <tr>
                    <td colSpan={15} style={{ color: "var(--color-text-muted)", padding: "24px 10px" }}>
                      Loading products…
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((product) => (
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
                  ))
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
              {loadingMoreProducts ? "Loading…" : `Load more (${DASHBOARD_PRODUCTS_PAGE_SIZE})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
