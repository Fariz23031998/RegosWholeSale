import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import clsx from "clsx";
import { CalendarRange, Warehouse } from "lucide-react";
import { DataTable } from "@/components/DataTable/DataTable";
import { DashboardPeriodModal } from "@/components/Dashboard/DashboardPeriodModal";
import {
  DashboardWarehousesModal,
  formatWarehouseFilterLabel,
} from "@/components/Dashboard/DashboardWarehousesModal";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import stockStyles from "@/components/StockDocs/StockDocs.module.css";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  getPeriodLabel,
  presetToCustomRange,
  resolveDashboardPeriodParams,
  type DashboardCustomRange,
  type DashboardPeriodPreset,
} from "@/lib/dashboard-api";
import {
  fetchItemOperations,
  type StockItemOperationRow,
} from "@/lib/stock-docs-api";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWarehouseScope } from "@/hooks/use-warehouse-scope";
import { formatAuthError, useAuth } from "@/store/auth";
import type { Product } from "@/types/catalog";
import type { RegosDefaultOption } from "@/types/settings";
import styles from "./Products.module.css";

type Props = {
  open: boolean;
  product: Product | null;
  onClose: () => void;
};

type HistoryPeriodPreset = Exclude<DashboardPeriodPreset, "custom">;

const PAGE_SIZE = 50;
const HISTORY_PERIOD_PRESETS: HistoryPeriodPreset[] = ["today", "week", "month", "all"];

function resolveItemId(product: Product | null): number {
  if (!product) return 0;
  const raw = product.regos_item_id ?? Number(product.id);
  return Number.isInteger(raw) && raw > 0 ? raw : 0;
}

function formatOpDate(ts: number | null): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return "—";
  return formatDateTime(new Date(ts * 1000).toISOString());
}

function rowKey(op: StockItemOperationRow, index: number): string {
  if (op.id != null) return String(op.id);
  return `${op.datetime ?? "x"}-${op.document_code ?? "x"}-${index}`;
}

/** DocPurchase (1) and DocReturnsToPartner (2) expose cost in ItemOperation. */
const HISTORY_COST_DOCUMENT_TYPE_IDS = new Set([1, 2]);

function formatHistoryCost(op: StockItemOperationRow): string {
  if (
    op.document_type_id != null &&
    HISTORY_COST_DOCUMENT_TYPE_IDS.has(op.document_type_id) &&
    op.cost != null
  ) {
    return formatCurrency(op.cost);
  }
  return "—";
}

export function ProductHistoryDialog({ open, product, onClose }: Props) {
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const itemId = resolveItemId(product);
  const {
    canChangeWarehouse,
    defaultWarehouse,
    ready: warehouseScopeReady,
    scopedStockQueryParams,
  } = useWarehouseScope();

  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("month");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<RegosDefaultOption[]>([]);
  const [allStocks, setAllStocks] = useState(true);
  const [selectedStockIds, setSelectedStockIds] = useState<number[]>([]);

  const [operations, setOperations] = useState<StockItemOperationRow[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const periodModalRange = useMemo(() => {
    if (periodPreset === "custom" && customRange) return customRange;
    if (periodPreset !== "custom") return presetToCustomRange(periodPreset);
    return presetToCustomRange("month");
  }, [customRange, periodPreset]);

  const queryParams = useMemo(() => {
    const periodParams = resolveDashboardPeriodParams(periodPreset, customRange);
    return {
      ...periodParams,
      ...scopedStockQueryParams({ allStocks, stockIds: selectedStockIds }),
    };
  }, [allStocks, customRange, periodPreset, scopedStockQueryParams, selectedStockIds]);

  useEffect(() => {
    if (!open) {
      setPeriodPreset("month");
      setCustomRange(null);
      setPeriodModalOpen(false);
      setWarehouseModalOpen(false);
      setAllStocks(true);
      setSelectedStockIds([]);
      setOperations([]);
      setNextOffset(0);
      setTotal(0);
      setLoading(false);
      setLoadingMore(false);
      setError("");
    }
  }, [open]);

  useEffect(() => {
    if (!open || !canChangeWarehouse || !token) {
      if (!canChangeWarehouse) setWarehouses([]);
      return;
    }

    let cancelled = false;
    const cacheScope = user?.company_id != null ? { companyId: user.company_id } : undefined;
    void fetchRegosReferenceOptions(token, { cacheScope })
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
  }, [canChangeWarehouse, open, token, user?.company_id]);

  useEffect(() => {
    if (!open || !warehouseScopeReady || canChangeWarehouse) return;
    if (defaultWarehouse?.id) {
      setAllStocks(false);
      setSelectedStockIds([defaultWarehouse.id]);
    } else {
      setAllStocks(false);
      setSelectedStockIds([]);
    }
  }, [canChangeWarehouse, defaultWarehouse, open, warehouseScopeReady]);

  useEffect(() => {
    if (!open) return;
    if (!token || itemId <= 0) {
      setError(t("products.history.errors.load", "Failed to load history"));
      return;
    }
    if (!warehouseScopeReady) return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      setOperations([]);
      setNextOffset(0);
      setTotal(0);
      try {
        const res = await fetchItemOperations(token, itemId, {
          limit: PAGE_SIZE,
          offset: 0,
          ...queryParams,
        });
        if (cancelled) return;
        setOperations(res.operations);
        setNextOffset(res.next_offset);
        setTotal(res.total);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            formatAuthError(err, t("products.history.errors.load", "Failed to load history")),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, itemId, token, t, warehouseScopeReady, queryParams]);

  const canLoadMore =
    !loading &&
    !loadingMore &&
    operations.length < total &&
    nextOffset > 0 &&
    nextOffset < total;

  const loadMore = async () => {
    if (!token || itemId <= 0 || !canLoadMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const res = await fetchItemOperations(token, itemId, {
        limit: PAGE_SIZE,
        offset: nextOffset,
        ...queryParams,
      });
      setOperations((prev) => [...prev, ...res.operations]);
      setNextOffset(res.next_offset);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(formatAuthError(err, t("products.history.errors.load", "Failed to load history")));
    } finally {
      setLoadingMore(false);
    }
  };

  const columns = useMemo<ColumnDef<StockItemOperationRow, unknown>[]>(
    () => [
      {
        id: "date",
        accessorFn: (op) => op.datetime ?? 0,
        header: t("products.history.col.date", "Date"),
        cell: ({ row }) => formatOpDate(row.original.datetime),
      },
      {
        id: "type",
        accessorFn: (op) => op.document_type ?? "",
        header: t("products.history.col.type", "Type"),
        cell: ({ row }) => row.original.document_type || "—",
      },
      {
        id: "code",
        accessorFn: (op) => op.document_code ?? "",
        header: t("products.history.col.document", "Document"),
        cell: ({ row }) => row.original.document_code || "—",
      },
      {
        id: "stock",
        accessorFn: (op) => op.stock_name ?? "",
        header: t("products.history.col.stock", "Stock"),
        cell: ({ row }) => row.original.stock_name || "—",
      },
      {
        id: "qty",
        accessorFn: (op) => op.quantity ?? 0,
        header: t("products.history.col.qty", "Qty"),
        meta: {
          align: "right",
          cellClassName: stockStyles.right,
          headerClassName: stockStyles.right,
        },
        cell: ({ row }) =>
          row.original.quantity != null ? String(row.original.quantity) : "—",
      },
      {
        id: "cost",
        accessorFn: (op) => op.cost ?? 0,
        header: t("products.history.col.cost", "Cost"),
        meta: {
          align: "right",
          cellClassName: stockStyles.right,
          headerClassName: stockStyles.right,
        },
        cell: ({ row }) => formatHistoryCost(row.original),
      },
      {
        id: "price",
        accessorFn: (op) => op.price ?? 0,
        header: t("products.history.col.price", "Price"),
        meta: {
          align: "right",
          cellClassName: stockStyles.right,
          headerClassName: stockStyles.right,
        },
        cell: ({ row }) =>
          row.original.price != null ? formatCurrency(row.original.price) : "—",
      },
    ],
    [t],
  );

  const title = product
    ? t("products.history.titleNamed", "History — {{name}}", { name: product.name })
    : t("products.history", "History");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      fullscreen={isMobile}
      elevated
      modalClassName={styles.historyModal}
      bodyClassName={styles.historyModalBody}
    >
      <div className={clsx(dashboardStyles.filters, styles.historyFilters)}>
        {HISTORY_PERIOD_PRESETS.map((value) => (
          <button
            key={value}
            type="button"
            className={clsx(
              dashboardStyles.filter,
              periodPreset === value && dashboardStyles.filterActive,
            )}
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
          {t("dashboard.period")}
        </button>
        {canChangeWarehouse ? (
          <button
            type="button"
            className={clsx(dashboardStyles.filter, dashboardStyles.filterMenu)}
            onClick={() => setWarehouseModalOpen(true)}
          >
            <Warehouse size={14} />
            {formatWarehouseFilterLabel(allStocks, selectedStockIds, warehouses, t)}
          </button>
        ) : null}
      </div>

      {loading || !warehouseScopeReady ? (
        <div className={stockStyles.detailEmpty}>{t("common.loading", "Loading…")}</div>
      ) : error && operations.length === 0 ? (
        <div className={stockStyles.detailEmpty}>{error}</div>
      ) : operations.length === 0 ? (
        <div className={stockStyles.detailEmpty}>
          {t("products.history.empty", "No movement history for this product")}
        </div>
      ) : (
        <>
          <div className={stockStyles.detailTableWrap}>
            <DataTable
              tableKey="products.itemHistory"
              data={operations}
              columns={columns}
              className={stockStyles.detailTable}
              getRowId={(op, index) => rowKey(op, index)}
            />
          </div>

          <div className={stockStyles.lineCards}>
            {operations.map((op, index) => (
              <div key={rowKey(op, index)} className={stockStyles.lineCard}>
                <div className={stockStyles.lineCardTop}>
                  <div className={stockStyles.lineCardName}>
                    {op.document_type || t("products.history.col.type", "Type")}
                  </div>
                  <div className={stockStyles.lineCardAmount}>
                    {op.price != null ? formatCurrency(op.price) : "—"}
                  </div>
                </div>
                <div className={stockStyles.lineCardMeta}>
                  {(() => {
                    const costText = formatHistoryCost(op);
                    return [
                      formatOpDate(op.datetime),
                      op.document_code,
                      op.stock_name,
                      op.quantity != null
                        ? `${t("products.history.col.qty", "Qty")}: ${op.quantity}`
                        : null,
                      costText !== "—"
                        ? `${t("products.history.col.cost", "Cost")}: ${costText}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                  })()}
                </div>
              </div>
            ))}
          </div>

          {error ? <div className={stockStyles.errorInline}>{error}</div> : null}

          {canLoadMore || loadingMore ? (
            <div className={styles.historyLoadMore}>
              <Button
                type="button"
                variant="secondary"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore
                  ? t("common.loading", "Loading…")
                  : t("products.history.loadMore", "Load more")}
              </Button>
              <span className={styles.historyCount}>
                {t("products.history.shown", "{{n}} of {{m}}", {
                  n: operations.length,
                  m: total,
                })}
              </span>
            </div>
          ) : total > 0 ? (
            <div className={styles.historyLoadMore}>
              <span className={styles.historyCount}>
                {t("products.history.shown", "{{n}} of {{m}}", {
                  n: operations.length,
                  m: total,
                })}
              </span>
            </div>
          ) : null}
        </>
      )}

      <DashboardPeriodModal
        open={periodModalOpen}
        onClose={() => setPeriodModalOpen(false)}
        initialRange={periodModalRange}
        onApply={(range) => {
          setCustomRange(range);
          setPeriodPreset("custom");
          setPeriodModalOpen(false);
        }}
      />

      {canChangeWarehouse ? (
        <DashboardWarehousesModal
          open={warehouseModalOpen}
          onClose={() => setWarehouseModalOpen(false)}
          warehouses={warehouses}
          allStocks={allStocks}
          selectedStockIds={selectedStockIds}
          onApply={({ allStocks: nextAll, stockIds }) => {
            setAllStocks(nextAll);
            setSelectedStockIds(stockIds);
            setWarehouseModalOpen(false);
          }}
        />
      ) : null}
    </Modal>
  );
}
