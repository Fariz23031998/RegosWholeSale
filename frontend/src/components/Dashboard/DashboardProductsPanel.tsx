import { useMemo } from "react";
import type { ColumnDef, Table } from "@tanstack/react-table";
import { Download, Search } from "lucide-react";
import clsx from "clsx";
import { columnHeaderLabel, DataTable } from "@/components/DataTable/DataTable";
import type { DashboardProductRow, DashboardProductTotals, TranslateFn } from "@/lib/dashboard-api";
import { formatCurrency } from "@/lib/format";
import styles from "./Dashboard.module.css";

export type DashboardProductsCopyPrefix = "dashboard.products" | "dashboard.discountedProducts";

function formatQty(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function formatOptionalCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatCurrency(value);
}

function productMatchesSearch(product: DashboardProductRow, query: string): boolean {
  if (!query) return true;
  const haystack = [product.code, product.name, product.category]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return haystack.some((value) => value.includes(query));
}

const numMeta = {
  align: "right" as const,
  cellClassName: styles.num,
  headerClassName: styles.num,
};

const identityColumnIds = new Set(["code", "name", "category"]);

function totalsText(id: string, totals: DashboardProductTotals): string {
  switch (id) {
    case "purchaseCost":
    case "avgPrice":
    case "priceWithoutDiscount":
      return "—";
    case "totalWithoutDiscount":
      return formatCurrency(totals.total_without_discount ?? 0);
    case "sellQty":
      return formatQty(totals.sold_quantity);
    case "sellCost":
      return formatCurrency(totals.sold_purchase_cost);
    case "sellTotal":
      return formatCurrency(totals.sold_total);
    case "refundQty":
      return formatQty(totals.refund_quantity);
    case "refundCost":
      return formatCurrency(totals.refund_purchase_cost);
    case "refundTotal":
      return formatCurrency(totals.refund_total);
    case "netQty":
      return formatQty(totals.net_sold_quantity);
    case "netCost":
      return formatCurrency(totals.net_purchase_cost);
    case "netTotal":
      return formatCurrency(totals.net_total_sells);
    case "grossProfit":
      return formatCurrency(totals.net_gross_profit);
    default:
      return "";
  }
}

function ProductTotalsRow({
  table,
  totals,
  label,
}: {
  table: Table<DashboardProductRow>;
  totals: DashboardProductTotals;
  label: string;
}) {
  let labelPlaced = false;
  return (
    <tr className={styles.productsTotalRow}>
      {table.getVisibleLeafColumns().map((column) => {
        const identity = identityColumnIds.has(column.id);
        let text = totalsText(column.id, totals);
        if (identity) {
          text = labelPlaced ? "" : label;
          labelPlaced = true;
        }
        return (
          <td
            key={column.id}
            className={identity ? undefined : styles.num}
            data-label={columnHeaderLabel(column)}
          >
            {text}
          </td>
        );
      })}
    </tr>
  );
}

export function DashboardProductsPanel({
  tabId,
  copyPrefix,
  periodLabel,
  products,
  totals,
  total,
  search,
  onSearchChange,
  loading,
  error,
  exporting,
  onExport,
  t,
}: {
  tabId: "products" | "discountedProducts";
  copyPrefix: DashboardProductsCopyPrefix;
  periodLabel: string;
  products: DashboardProductRow[];
  totals: DashboardProductTotals | null;
  total: number;
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  error: string;
  exporting: boolean;
  onExport: () => void;
  t: TranslateFn;
}) {
  const searchQuery = search.trim().toLowerCase();
  const filteredProducts = products.filter((product) => productMatchesSearch(product, searchQuery));
  const showWithoutDiscount = tabId === "discountedProducts";
  const columns = useMemo<ColumnDef<DashboardProductRow, any>[]>(() => {
    const qtyHeader = t("dashboard.products.col.qty");
    const costHeader = t("dashboard.products.col.purchaseCost");
    const money = (value: number) => formatCurrency(value);
    const identity: ColumnDef<DashboardProductRow, any>[] = [
      {
        id: "code",
        accessorFn: (product) => product.code,
        header: t("dashboard.products.col.code"),
        cell: ({ row }) => row.original.code || "—",
      },
      {
        id: "name",
        accessorFn: (product) => product.name,
        header: t("dashboard.products.col.name"),
        size: 220,
        meta: { cellClassName: styles.nameCell },
        cell: ({ row }) => (
          <span title={row.original.name}>{row.original.name}</span>
        ),
      },
      {
        id: "category",
        accessorFn: (product) => product.category,
        header: t("dashboard.products.col.category"),
        cell: ({ row }) => row.original.category || "—",
      },
      {
        id: "purchaseCost",
        accessorFn: (product) => product.purchase_cost ?? 0,
        header: costHeader,
        meta: numMeta,
        cell: ({ row }) => formatOptionalCurrency(row.original.purchase_cost),
      },
      {
        id: "avgPrice",
        accessorFn: (product) => product.average_price,
        header: t("dashboard.products.col.avgPrice"),
        meta: numMeta,
        cell: ({ row }) => formatCurrency(row.original.average_price),
      },
    ];
    if (showWithoutDiscount) {
      identity.push(
        {
          id: "priceWithoutDiscount",
          accessorFn: (product) => product.price_without_discount ?? 0,
          header: t("dashboard.products.col.priceWithoutDiscount"),
          meta: numMeta,
          cell: ({ row }) => formatCurrency(row.original.price_without_discount ?? 0),
        },
        {
          id: "totalWithoutDiscount",
          accessorFn: (product) => product.total_without_discount ?? 0,
          header: t("dashboard.products.col.totalWithoutDiscount"),
          meta: numMeta,
          cell: ({ row }) => formatCurrency(row.original.total_without_discount ?? 0),
        },
      );
    }
    return [
      {
        id: "product",
        header: t(`${copyPrefix}.title`),
        meta: { headerClassName: styles.groupHead },
        columns: identity,
      },
      {
        id: "sell",
        header: t("dashboard.products.group.sell"),
        meta: { headerClassName: styles.groupHead },
        columns: [
          {
            id: "sellQty",
            accessorFn: (product) => product.sold_quantity,
            header: qtyHeader,
            meta: numMeta,
            cell: ({ row }) => formatQty(row.original.sold_quantity),
          },
          {
            id: "sellCost",
            accessorFn: (product) => product.sold_purchase_cost,
            header: costHeader,
            meta: numMeta,
            cell: ({ row }) => money(row.original.sold_purchase_cost),
          },
          {
            id: "sellTotal",
            accessorFn: (product) => product.sold_total,
            header: t("dashboard.products.col.totalSells"),
            meta: numMeta,
            cell: ({ row }) => money(row.original.sold_total),
          },
        ],
      },
      {
        id: "refund",
        header: t("dashboard.products.group.refund"),
        meta: { headerClassName: styles.groupHead },
        columns: [
          {
            id: "refundQty",
            accessorFn: (product) => product.refund_quantity,
            header: qtyHeader,
            meta: numMeta,
            cell: ({ row }) => formatQty(row.original.refund_quantity),
          },
          {
            id: "refundCost",
            accessorFn: (product) => product.refund_purchase_cost,
            header: costHeader,
            meta: numMeta,
            cell: ({ row }) => money(row.original.refund_purchase_cost),
          },
          {
            id: "refundTotal",
            accessorFn: (product) => product.refund_total,
            header: t("dashboard.products.col.totalRefunds"),
            meta: numMeta,
            cell: ({ row }) => money(row.original.refund_total),
          },
        ],
      },
      {
        id: "net",
        header: t("dashboard.products.group.net"),
        meta: { headerClassName: styles.groupHead },
        columns: [
          {
            id: "netQty",
            accessorFn: (product) => product.net_sold_quantity,
            header: qtyHeader,
            meta: numMeta,
            cell: ({ row }) => formatQty(row.original.net_sold_quantity),
          },
          {
            id: "netCost",
            accessorFn: (product) => product.net_purchase_cost,
            header: costHeader,
            meta: numMeta,
            cell: ({ row }) => money(row.original.net_purchase_cost),
          },
          {
            id: "netTotal",
            accessorFn: (product) => product.net_total_sells,
            header: t("dashboard.products.col.totalSells"),
            meta: numMeta,
            cell: ({ row }) => money(row.original.net_total_sells),
          },
          {
            id: "grossProfit",
            accessorFn: (product) => product.net_gross_profit,
            header: t("dashboard.products.col.grossProfit"),
            meta: numMeta,
            cell: ({ row }) => money(row.original.net_gross_profit),
          },
        ],
      },
    ];
  }, [copyPrefix, showWithoutDiscount, t]);

  return (
    <div
      id={`dashboard-panel-${tabId}`}
      role="tabpanel"
      aria-labelledby={`dashboard-tab-${tabId}`}
      className={clsx(styles.dashboardPanel, styles.card, styles.productsCard)}
    >
      <div className={styles.cardTitle}>{t(`${copyPrefix}.title`)}</div>
      <div className={styles.cardSub}>
        {periodLabel} · {t(`${copyPrefix}.subtitle`)}
        {total > 0
          ? searchQuery
            ? ` · ${t(`${copyPrefix}.shown`, undefined, { n: filteredProducts.length, m: products.length })}`
            : ` · ${total}`
          : ""}
      </div>
      {products.length > 0 && (
        <div className={styles.productsToolbar}>
          <div className={styles.productsSearch}>
            <Search size={16} className={styles.productsSearchIcon} />
            <input
              className={styles.productsSearchInput}
              type="search"
              placeholder={t(`${copyPrefix}.searchPlaceholder`)}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              aria-label={t(`${copyPrefix}.searchAria`)}
            />
          </div>
          <button
            type="button"
            className={styles.exportButton}
            onClick={onExport}
            disabled={exporting || loading}
          >
            <Download size={14} />
            {exporting ? t(`${copyPrefix}.exporting`) : t(`${copyPrefix}.exportExcel`)}
          </button>
        </div>
      )}
      {error && <div className={styles.empty}>{error}</div>}
      {products.length === 0 && !loading && !error ? (
        <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
          {t(`${copyPrefix}.empty`)}
        </div>
      ) : filteredProducts.length === 0 && !loading ? (
        <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: "24px 0" }}>
          {t(`${copyPrefix}.emptySearch`)}
        </div>
      ) : (
        <div className={styles.productsTableWrap}>
          <DataTable
            tableKey={
              tabId === "discountedProducts" ? "dashboard.discountedProducts" : "dashboard.products"
            }
            data={filteredProducts}
            columns={columns}
            className={styles.productsTable}
            getRowId={(product) => String(product.item_id)}
            isLoading={loading && products.length === 0}
            emptyMessage={t(`${copyPrefix}.loading`)}
            topRow={
              totals && !searchQuery
                ? (table) => (
                    <ProductTotalsRow
                      table={table}
                      totals={totals}
                      label={t("dashboard.products.totalRow")}
                    />
                  )
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
