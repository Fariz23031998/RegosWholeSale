import { apiRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";

export type DashboardDayPoint = {
  day: string;
  sales: number;
  cost: number;
  profit: number;
};

export type DashboardTopProduct = {
  item_id: number;
  name: string;
  qty: number;
  revenue: number;
};

export type DashboardPartnerPoint = {
  name: string;
  count: number;
};

export type DashboardPaymentRow = {
  id: number;
  code: string;
  date: number;
  amount: number | null;
  category_id: number | null;
  category_name: string | null;
  payment_type_name: string | null;
  partner_name: string | null;
};

export type DashboardProductRow = {
  item_id: number;
  code: string;
  name: string;
  category: string;
  purchase_cost: number | null;
  average_price: number;
  sold_quantity: number;
  sold_purchase_cost: number;
  sold_total: number;
  refund_quantity: number;
  refund_purchase_cost: number;
  refund_total: number;
  net_sold_quantity: number;
  net_purchase_cost: number;
  net_total_sells: number;
  net_gross_profit: number;
};

export type DashboardStats = {
  sales_total: number;
  cost_total: number;
  gross_profit: number;
  refunds_cost_total: number;
  net_sales_total: number;
  net_cost_total: number;
  net_gross_profit: number;
  transaction_count: number;
  items_sold: number;
  avg_basket: number;
  refunds_total: number;
  refund_count: number;
  income_payments_total: number;
  outcome_payments_total: number;
  income_payment_category_name: string | null;
  outcome_payment_category_name: string | null;
  income_payments: DashboardPaymentRow[];
  outcome_payments: DashboardPaymentRow[];
  days: DashboardDayPoint[];
  top_products: DashboardTopProduct[];
  top_partners: DashboardPartnerPoint[];
  sales_count_total: number;
};

export type DashboardProductsPage = {
  products: DashboardProductRow[];
  next_offset: number;
  total: number;
};

export type DashboardPeriodPreset = "today" | "week" | "month" | "all" | "custom";

export type DashboardCustomRange = {
  startDate: string;
  endDate: string;
};

export type DashboardQueryParams = {
  start_date?: number;
  end_date?: number;
  all_stocks?: boolean;
  stock_ids?: number[];
};

export const DASHBOARD_PRODUCTS_PAGE_SIZE = 50;

const DASHBOARD_STATS_TIMEOUT_MS = 60_000;
const DASHBOARD_PRODUCTS_TIMEOUT_MS = 90_000;

export const PERIOD_LABELS: Record<Exclude<DashboardPeriodPreset, "custom">, string> = {
  today: "Today",
  week: "Last 7 days",
  month: "Last 30 days",
  all: "All time",
};

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function periodToTimestamps(
  period: Exclude<DashboardPeriodPreset, "custom">,
): { start_date?: number; end_date?: number } {
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;
  if (period === "all") {
    return { end_date: now };
  }
  if (period === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { start_date: Math.floor(start.getTime() / 1000), end_date: now };
  }
  if (period === "week") {
    return { start_date: now - 7 * day, end_date: now };
  }
  return { start_date: now - 30 * day, end_date: now };
}

export function customRangeToTimestamps(
  range: DashboardCustomRange,
): { start_date: number; end_date: number } {
  const start = new Date(`${range.startDate}T00:00:00`);
  const end = new Date(`${range.endDate}T23:59:59`);
  return {
    start_date: Math.floor(start.getTime() / 1000),
    end_date: Math.floor(end.getTime() / 1000),
  };
}

export function presetToCustomRange(
  preset: Exclude<DashboardPeriodPreset, "custom">,
): DashboardCustomRange {
  const { start_date, end_date } = periodToTimestamps(preset);
  const now = Math.floor(Date.now() / 1000);
  const end = end_date ?? now;
  const start = start_date ?? end - 7 * 24 * 60 * 60;
  return {
    startDate: toDateInputValue(new Date(start * 1000)),
    endDate: toDateInputValue(new Date(end * 1000)),
  };
}

export function formatDashboardPeriodLabel(
  preset: DashboardPeriodPreset,
  customRange: DashboardCustomRange | null,
): string {
  if (preset === "custom" && customRange) {
    return `${formatDate(customRange.startDate)} – ${formatDate(customRange.endDate)}`;
  }
  if (preset === "custom") return "Custom period";
  return PERIOD_LABELS[preset];
}

export function resolveDashboardQueryParams(
  preset: DashboardPeriodPreset,
  customRange: DashboardCustomRange | null,
  warehouseFilter: { allStocks: boolean; stockIds: number[] },
): DashboardQueryParams {
  const period =
    preset === "custom" && customRange
      ? customRangeToTimestamps(customRange)
      : periodToTimestamps(preset === "custom" ? "week" : preset);

  const params: DashboardQueryParams = { ...period };
  if (warehouseFilter.allStocks) {
    params.all_stocks = true;
  } else {
    params.all_stocks = false;
    if (warehouseFilter.stockIds.length > 0) {
      params.stock_ids = warehouseFilter.stockIds;
    }
  }
  return params;
}

function buildDashboardSearch(
  params: DashboardQueryParams,
  extra?: Record<string, string | number>,
): string {
  const search = new URLSearchParams();
  if (params.start_date !== undefined) search.set("start_date", String(params.start_date));
  if (params.end_date !== undefined) search.set("end_date", String(params.end_date));
  if (params.all_stocks !== undefined) search.set("all_stocks", params.all_stocks ? "true" : "false");
  if (params.stock_ids?.length) {
    for (const stockId of params.stock_ids) {
      search.append("stock_ids", String(stockId));
    }
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

export async function fetchDashboardStats(
  token: string,
  params: DashboardQueryParams = {},
): Promise<DashboardStats> {
  const qs = buildDashboardSearch(params);
  return apiRequest(`/api/v1/dashboard/stats${qs ? `?${qs}` : ""}`, {
    token,
    timeoutMs: DASHBOARD_STATS_TIMEOUT_MS,
  });
}

export async function fetchDashboardProducts(
  token: string,
  params: DashboardQueryParams & {
    offset?: number;
    limit?: number;
  } = {},
): Promise<DashboardProductsPage> {
  const { offset, limit, ...filters } = params;
  const qs = buildDashboardSearch(filters, {
    offset: offset ?? 0,
    limit: limit ?? DASHBOARD_PRODUCTS_PAGE_SIZE,
  });
  return apiRequest(`/api/v1/dashboard/products?${qs}`, {
    token,
    timeoutMs: DASHBOARD_PRODUCTS_TIMEOUT_MS,
  });
}
