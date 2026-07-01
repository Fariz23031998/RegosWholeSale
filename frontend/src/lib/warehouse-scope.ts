import type { RegosDefaultOption } from "@/types/settings";

export type StockFilterState = {
  allStocks: boolean;
  stockIds: number[];
};

export function resolveScopedStockFilters(
  canChangeWarehouse: boolean,
  defaultWarehouse: RegosDefaultOption | null,
  filters: StockFilterState,
): StockFilterState {
  if (canChangeWarehouse) {
    return filters;
  }
  if (defaultWarehouse?.id) {
    return { allStocks: false, stockIds: [defaultWarehouse.id] };
  }
  return { allStocks: false, stockIds: [] };
}

export function stockFilterQueryParams(
  filters: StockFilterState,
): { all_stocks?: boolean; stock_ids?: number[] } {
  if (filters.allStocks) {
    return { all_stocks: true };
  }
  return {
    all_stocks: false,
    ...(filters.stockIds.length > 0 ? { stock_ids: filters.stockIds } : {}),
  };
}
