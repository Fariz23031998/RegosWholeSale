import { apiRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { currencyLabel } from "@/lib/currency-conversion";
import type { RegosCurrencyOption, RegosPriceTypeOption } from "@/types/settings";

export type DashboardCurrencyTotal = {
  currency: RegosCurrencyOption | null;
  amount: number;
};

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
  currency: RegosCurrencyOption | null;
  category_id: number | null;
  category_name: string | null;
  payment_type_name: string | null;
  partner_name: string | null;
  attached_user_name: string | null;
  exchange_rate: number | null;
};

export type DashboardProductTotals = {
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
  summary_currency: RegosCurrencyOption | null;
  has_multiple_currencies: boolean;
  sales_by_currency: DashboardCurrencyTotal[];
  refunds_by_currency: DashboardCurrencyTotal[];
  net_sales_by_currency: DashboardCurrencyTotal[];
  income_payments_by_currency: DashboardCurrencyTotal[];
  outcome_payments_by_currency: DashboardCurrencyTotal[];
};

export type DashboardProductsPage = {
  products: DashboardProductRow[];
  totals: DashboardProductTotals;
  next_offset: number;
  total: number;
};

export type DashboardPaymentsPage = {
  income_payments: DashboardPaymentRow[];
  outcome_payments: DashboardPaymentRow[];
  income_payment_category_name: string | null;
  outcome_payment_category_name: string | null;
  income_payments_total: number;
  outcome_payments_total: number;
  income_total: number;
  outcome_total: number;
  next_offset: number;
};

export type DashboardOutOfStockRow = {
  product_id: number;
  product_name: string;
  code: string;
  barcode: string;
  stock_id: number;
  stock_name: string;
  quantity: number;
  min_quantity: number;
  last_purchase_cost: number | null;
  price: number;
  detected_at: string;
};

export type DashboardOutOfStockPage = {
  products: DashboardOutOfStockRow[];
  total: number;
};

export type DashboardOverview = {
  stats: DashboardStats;
  products: DashboardProductRow[];
  totals: DashboardProductTotals;
  total: number;
  payments: DashboardPaymentsPage;
};

export type DashboardPeriodPreset = "today" | "week" | "month" | "all" | "custom";

export type DashboardCustomRange = {
  startDate: string;
  endDate: string;
};

export type DashboardCurrencyMode = "native" | "all";

export type DashboardCurrencyFilter = {
  currencyId: number;
  mode: DashboardCurrencyMode;
};

export type DashboardQueryParams = {
  start_date?: number;
  end_date?: number;
  all_stocks?: boolean;
  stock_ids?: number[];
  all_partners?: boolean;
  partner_ids?: number[];
  currency_id?: number;
  currency_mode?: DashboardCurrencyMode;
};

const DASHBOARD_STATS_TIMEOUT_MS = 60_000;
const DASHBOARD_OVERVIEW_TIMEOUT_MS = 120_000;
const DASHBOARD_PRODUCTS_TIMEOUT_MS = 120_000;
const DASHBOARD_PAYMENTS_TIMEOUT_MS = 120_000;
const DASHBOARD_OUT_OF_STOCK_TIMEOUT_MS = 60_000;

export type TranslateFn = (
  key: string,
  fallback?: string,
  params?: Record<string, string | number>,
) => string;

const PERIOD_LABEL_KEYS: Record<Exclude<DashboardPeriodPreset, "custom">, string> = {
  today: "dashboard.period.today",
  week: "dashboard.period.week",
  month: "dashboard.period.month",
  all: "dashboard.period.all",
};

const PERIOD_LABEL_FALLBACKS: Record<Exclude<DashboardPeriodPreset, "custom">, string> = {
  today: "Today",
  week: "Last 7 days",
  month: "Last 30 days",
  all: "All time",
};

export function getPeriodLabel(
  preset: Exclude<DashboardPeriodPreset, "custom">,
  t: TranslateFn,
): string {
  return t(PERIOD_LABEL_KEYS[preset], PERIOD_LABEL_FALLBACKS[preset]);
}

export function getPeriodLabels(
  t: TranslateFn,
): Record<Exclude<DashboardPeriodPreset, "custom">, string> {
  return {
    today: getPeriodLabel("today", t),
    week: getPeriodLabel("week", t),
    month: getPeriodLabel("month", t),
    all: getPeriodLabel("all", t),
  };
}

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
  t: TranslateFn,
): string {
  if (preset === "custom" && customRange) {
    return `${formatDate(customRange.startDate)} – ${formatDate(customRange.endDate)}`;
  }
  if (preset === "custom") return t("dashboard.period.custom", "Custom period");
  return getPeriodLabel(preset, t);
}

export function resolveDashboardPeriodParams(
  preset: DashboardPeriodPreset,
  customRange: DashboardCustomRange | null,
): { start_date?: number; end_date?: number } {
  if (preset === "custom" && customRange) {
    return customRangeToTimestamps(customRange);
  }
  return periodToTimestamps(preset === "custom" ? "week" : preset);
}

export function resolveDashboardQueryParams(
  period: { start_date?: number; end_date?: number },
  filters: {
    allStocks: boolean;
    stockIds: number[];
    allPartners: boolean;
    partnerIds: number[];
    currencyFilter?: DashboardCurrencyFilter | null;
  },
): DashboardQueryParams {
  const params: DashboardQueryParams = { ...period };
  if (filters.allStocks) {
    params.all_stocks = true;
  } else {
    params.all_stocks = false;
    if (filters.stockIds.length > 0) {
      params.stock_ids = filters.stockIds;
    }
  }
  if (filters.allPartners) {
    params.all_partners = true;
  } else {
    params.all_partners = false;
    if (filters.partnerIds.length > 0) {
      params.partner_ids = filters.partnerIds;
    }
  }
  if (filters.currencyFilter) {
    params.currency_id = filters.currencyFilter.currencyId;
    params.currency_mode = filters.currencyFilter.mode;
  }
  return params;
}

export function serializeDashboardQueryParams(
  params: DashboardQueryParams & {
    performed?: boolean;
    offset?: number;
    limit?: number;
  },
): string {
  const parts: string[] = [];
  if (params.start_date !== undefined) parts.push(`sd:${params.start_date}`);
  if (params.end_date !== undefined) parts.push(`ed:${params.end_date}`);
  if (params.all_stocks !== undefined) parts.push(`as:${params.all_stocks}`);
  if (params.all_partners !== undefined) parts.push(`ap:${params.all_partners}`);
  if (params.performed !== undefined) parts.push(`pf:${params.performed}`);
  if (params.currency_id !== undefined) parts.push(`ci:${params.currency_id}`);
  if (params.currency_mode !== undefined) parts.push(`cm:${params.currency_mode}`);
  if (params.offset !== undefined) parts.push(`off:${params.offset}`);
  if (params.limit !== undefined) parts.push(`lim:${params.limit}`);
  if (params.stock_ids?.length) {
    parts.push(`st:${[...params.stock_ids].sort((a, b) => a - b).join(",")}`);
  }
  if (params.partner_ids?.length) {
    parts.push(`pa:${[...params.partner_ids].sort((a, b) => a - b).join(",")}`);
  }
  return parts.join("|");
}

export function currencyFilterKey(filter: DashboardCurrencyFilter): string {
  return `${filter.currencyId}:${filter.mode}`;
}

export function parseCurrencyFilterKey(value: string): DashboardCurrencyFilter | null {
  const [currencyIdRaw, mode] = value.split(":");
  const currencyId = Number(currencyIdRaw);
  if (!Number.isInteger(currencyId) || currencyId <= 0) return null;
  if (mode !== "native" && mode !== "all") return null;
  return { currencyId, mode };
}

export function collectDashboardCurrencies(
  priceTypes: RegosPriceTypeOption[],
  defaultCurrency: RegosCurrencyOption | null,
): RegosCurrencyOption[] {
  const byId = new Map<number, RegosCurrencyOption>();
  if (defaultCurrency?.id) {
    byId.set(defaultCurrency.id, defaultCurrency);
  }
  for (const priceType of priceTypes) {
    const currency = priceType.currency;
    if (currency?.id) {
      byId.set(currency.id, currency);
    }
  }
  return Array.from(byId.values()).sort((left, right) =>
    currencyLabel(left).localeCompare(currencyLabel(right)),
  );
}

export function buildDashboardCurrencyFilterOptions(
  currencies: RegosCurrencyOption[],
  t: TranslateFn,
): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (const currency of currencies) {
    const code = currencyLabel(currency);
    options.push({
      value: currencyFilterKey({ currencyId: currency.id, mode: "native" }),
      label: t("dashboard.currencyFilter.nativeOnly", undefined, { currency: code }),
    });
    options.push({
      value: currencyFilterKey({ currencyId: currency.id, mode: "all" }),
      label: t("dashboard.currencyFilter.allOperations", undefined, { currency: code }),
    });
  }
  return options;
}

export function formatDashboardCurrencyFilterLabel(
  filter: DashboardCurrencyFilter | null,
  currencies: RegosCurrencyOption[],
  t: TranslateFn,
): string {
  if (!filter) return t("dashboard.currencyFilter.label", "Currency");
  const currency = currencies.find((item) => item.id === filter.currencyId);
  const code = currency ? currencyLabel(currency) : String(filter.currencyId);
  if (filter.mode === "native") {
    return t("dashboard.currencyFilter.nativeOnly", undefined, { currency: code });
  }
  return t("dashboard.currencyFilter.allOperations", undefined, { currency: code });
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
  if (params.all_partners !== undefined) {
    search.set("all_partners", params.all_partners ? "true" : "false");
  }
  if (params.partner_ids?.length) {
    for (const partnerId of params.partner_ids) {
      search.append("partner_ids", String(partnerId));
    }
  }
  if (params.currency_id !== undefined) {
    search.set("currency_id", String(params.currency_id));
  }
  if (params.currency_mode) {
    search.set("currency_mode", params.currency_mode);
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

export async function fetchDashboardOverview(
  token: string,
  params: DashboardQueryParams = {},
): Promise<DashboardOverview> {
  const qs = buildDashboardSearch(params);
  return apiRequest(`/api/v1/dashboard/overview${qs ? `?${qs}` : ""}`, {
    token,
    timeoutMs: DASHBOARD_OVERVIEW_TIMEOUT_MS,
  });
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
  params: DashboardQueryParams = {},
): Promise<DashboardProductsPage> {
  const qs = buildDashboardSearch(params);
  return apiRequest(`/api/v1/dashboard/products${qs ? `?${qs}` : ""}`, {
    token,
    timeoutMs: DASHBOARD_PRODUCTS_TIMEOUT_MS,
  });
}

export async function fetchDashboardPayments(
  token: string,
  params: DashboardQueryParams = {},
): Promise<DashboardPaymentsPage> {
  const qs = buildDashboardSearch(params);
  return apiRequest(`/api/v1/dashboard/payments${qs ? `?${qs}` : ""}`, {
    token,
    timeoutMs: DASHBOARD_PAYMENTS_TIMEOUT_MS,
  });
}

export function buildDashboardStockFilterParams(filters: {
  allStocks: boolean;
  stockIds: number[];
}): Pick<DashboardQueryParams, "all_stocks" | "stock_ids"> {
  if (filters.allStocks) {
    return { all_stocks: true };
  }
  return {
    all_stocks: false,
    stock_ids: filters.stockIds.length > 0 ? filters.stockIds : undefined,
  };
}

export async function fetchDashboardOutOfStock(
  token: string,
  params: Pick<DashboardQueryParams, "all_stocks" | "stock_ids"> = {},
): Promise<DashboardOutOfStockPage> {
  const qs = buildDashboardSearch(params);
  return apiRequest(`/api/v1/dashboard/out-of-stock${qs ? `?${qs}` : ""}`, {
    token,
    timeoutMs: DASHBOARD_OUT_OF_STOCK_TIMEOUT_MS,
  });
}
