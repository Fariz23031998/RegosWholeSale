import { useCallback, useEffect, useMemo, useState } from "react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  resolveScopedStockFilters,
  stockFilterQueryParams,
  type StockFilterState,
} from "@/lib/warehouse-scope";
import { fetchMyRegosDefaults } from "@/lib/settings-api";
import { useAuth } from "@/store/auth";
import type { RegosDefaultOption } from "@/types/settings";

/**
 * Warehouse scoping for reporting pages and sell modals.
 * POS catalog/checkout scoping is handled separately via sell context.
 */
export function useWarehouseScope() {
  const token = useAuth((s) => s.accessToken);
  const { canChangeWarehouse } = usePermissions();
  const canChange = canChangeWarehouse();
  const [defaultWarehouse, setDefaultWarehouse] = useState<RegosDefaultOption | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token) {
      setDefaultWarehouse(null);
      setReady(false);
      return;
    }

    let cancelled = false;
    setReady(false);
    void fetchMyRegosDefaults(token)
      .then((response) => {
        if (cancelled) return;
        setDefaultWarehouse(response.defaults.warehouse ?? null);
      })
      .catch(() => {
        if (!cancelled) setDefaultWarehouse(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const scopedStockFilters = useCallback(
    (filters: StockFilterState): StockFilterState =>
      resolveScopedStockFilters(canChange, defaultWarehouse, filters),
    [canChange, defaultWarehouse],
  );

  const scopedStockQueryParams = useCallback(
    (filters: StockFilterState) => stockFilterQueryParams(scopedStockFilters(filters)),
    [scopedStockFilters],
  );

  const warehousesForLabel = useMemo(() => {
    if (canChange || !defaultWarehouse) return [];
    return [defaultWarehouse];
  }, [canChange, defaultWarehouse]);

  return {
    canChangeWarehouse: canChange,
    defaultWarehouse,
    ready,
    scopedStockFilters,
    scopedStockQueryParams,
    warehousesForLabel,
  };
}
