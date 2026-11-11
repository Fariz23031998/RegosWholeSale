import { useMemo, useState } from "react";
import type { ColumnDef, Table } from "@tanstack/react-table";
import clsx from "clsx";
import { Download, Search } from "lucide-react";
import { columnHeaderLabel, DataTable } from "@/components/DataTable/DataTable";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import { useLanguage } from "@/contexts/LanguageContext";
import { exportPartnerDashboardProductsToExcel } from "@/lib/export-partner-dashboard-products";
import type {
  PartnerDashboardProductRow,
  PartnerDashboardProductTotals,
} from "@/lib/partner-telegram-api";
import { formatAmount } from "./partner-format";
import { usePartnerExcelExport } from "./usePartnerExcelExport";

function formatQty(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function productMatchesSearch(product: PartnerDashboardProductRow, query: string): boolean {
  if (!query) return true;
  return [product.code, product.name, product.category]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .some((value) => value.includes(query));
}

const numMeta = {
  align: "right" as const,
  cellClassName: dashboardStyles.num,
  headerClassName: dashboardStyles.num,
};

const identityColumnIds = new Set(["code", "name", "category"]);

function totalsText(id: string, totals: PartnerDashboardProductTotals): string {
  switch (id) {
    case "avgPrice":
      return "—";
    case "sellQty":
      return formatQty(totals.sold_quantity);
    case "sellTotal":
      return formatAmount(totals.sold_total);
    case "refundQty":
      return formatQty(totals.refund_quantity);
    case "refundTotal":
      return formatAmount(totals.refund_total);
    case "netQty":
      return formatQty(totals.net_quantity);
    case "netTotal":
      return formatAmount(totals.net_total);
    default:
      return "";
  }
}

function ProductTotalsRow({
  table,
  totals,
  label,
}: {
  table: Table<PartnerDashboardProductRow>;
  totals: PartnerDashboardProductTotals;
  label: string;
}) {
  let labelPlaced = false;
  return (
    <tr className={dashboardStyles.productsTotalRow}>
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
            className={identity ? undefined : dashboardStyles.num}
            data-label={columnHeaderLabel(column)}
          >
            {text}
          </td>
        );
      })}
    </tr>
  );
}

export function PartnerDashboardProductsPanel({
  tabId,
  title,
  periodLabel,
  products,
  totals,
  total,
  loading,
  error,
  filePrefix,
}: {
  tabId: "purchases" | "shipments";
  title: string;
  periodLabel: string;
  products: PartnerDashboardProductRow[];
  totals: PartnerDashboardProductTotals | null;
  total: number;
  loading: boolean;
  error: string;
  filePrefix: string;
}) {
  const { t } = useLanguage();
  const { exporting, exportLabel, runExport } = usePartnerExcelExport();
  const [search, setSearch] = useState("");
  const searchQuery = search.trim().toLowerCase();
  const filteredProducts = useMemo(
    () => products.filter((product) => productMatchesSearch(product, searchQuery)),
    [products, searchQuery],
  );

  const columns = useMemo<ColumnDef<PartnerDashboardProductRow, any>[]>(
    () => [
      {
        id: "product",
        header: title,
        meta: { headerClassName: dashboardStyles.groupHead },
        columns: [
          {
            id: "code",
            accessorFn: (product) => product.code,
            header: t("dashboard.products.col.code", "Code"),
            cell: ({ row }) => row.original.code || "—",
          },
          {
            id: "name",
            accessorFn: (product) => product.name,
            header: t("dashboard.products.col.name", "Name"),
            size: 220,
            meta: { cellClassName: dashboardStyles.nameCell },
            cell: ({ row }) => <span title={row.original.name}>{row.original.name}</span>,
          },
          {
            id: "category",
            accessorFn: (product) => product.category,
            header: t("dashboard.products.col.category", "Category"),
            cell: ({ row }) => row.original.category || "—",
          },
        ],
      },
      {
        id: "sell",
        header: t("dashboard.products.group.sell", "Sell"),
        meta: { headerClassName: dashboardStyles.groupHead },
        columns: [
          {
            id: "sellQty",
            accessorFn: (product) => product.sold_quantity,
            header: t("dashboard.products.col.qty", "Qty"),
            meta: numMeta,
            cell: ({ row }) => formatQty(row.original.sold_quantity),
          },
          {
            id: "avgPrice",
            accessorFn: (product) => product.average_price,
            header: t("dashboard.products.col.avgPrice", "Avg price"),
            meta: numMeta,
            cell: ({ row }) => formatAmount(row.original.average_price),
          },
          {
            id: "sellTotal",
            accessorFn: (product) => product.sold_total,
            header: t("dashboard.products.col.totalSells", "Total"),
            meta: numMeta,
            cell: ({ row }) => formatAmount(row.original.sold_total),
          },
        ],
      },
      {
        id: "refund",
        header: t("dashboard.products.group.refund", "Refund"),
        meta: { headerClassName: dashboardStyles.groupHead },
        columns: [
          {
            id: "refundQty",
            accessorFn: (product) => product.refund_quantity,
            header: t("dashboard.products.col.qty", "Qty"),
            meta: numMeta,
            cell: ({ row }) => formatQty(row.original.refund_quantity),
          },
          {
            id: "refundTotal",
            accessorFn: (product) => product.refund_total,
            header: t("dashboard.products.col.totalRefunds", "Total"),
            meta: numMeta,
            cell: ({ row }) => formatAmount(row.original.refund_total),
          },
        ],
      },
      {
        id: "net",
        header: t("dashboard.products.group.net", "Net"),
        meta: { headerClassName: dashboardStyles.groupHead },
        columns: [
          {
            id: "netQty",
            accessorFn: (product) => product.net_quantity,
            header: t("dashboard.products.col.qty", "Qty"),
            meta: numMeta,
            cell: ({ row }) => formatQty(row.original.net_quantity),
          },
          {
            id: "netTotal",
            accessorFn: (product) => product.net_total,
            header: t("dashboard.products.col.totalSells", "Total"),
            meta: numMeta,
            cell: ({ row }) => formatAmount(row.original.net_total),
          },
        ],
      },
    ],
    [t, title],
  );

  const emptyTotals: PartnerDashboardProductTotals = {
    sold_quantity: 0,
    sold_total: 0,
    refund_quantity: 0,
    refund_total: 0,
    net_quantity: 0,
    net_total: 0,
  };
  const resolvedTotals = useMemo(() => {
    if (!searchQuery) return totals ?? emptyTotals;
    return filteredProducts.reduce<PartnerDashboardProductTotals>(
      (acc, product) => ({
        sold_quantity: roundMoney(acc.sold_quantity + product.sold_quantity),
        sold_total: roundMoney(acc.sold_total + product.sold_total),
        refund_quantity: roundMoney(acc.refund_quantity + product.refund_quantity),
        refund_total: roundMoney(acc.refund_total + product.refund_total),
        net_quantity: roundMoney(acc.net_quantity + product.net_quantity),
        net_total: roundMoney(acc.net_total + product.net_total),
      }),
      { ...emptyTotals },
    );
  }, [filteredProducts, searchQuery, totals]);

  return (
    <div
      id={`dashboard-panel-${tabId}`}
      role="tabpanel"
      aria-labelledby={`dashboard-tab-${tabId}`}
      className={clsx(dashboardStyles.dashboardPanel, dashboardStyles.card, dashboardStyles.productsCard)}
    >
      <div className={dashboardStyles.cardTitle}>{title}</div>
      <div className={dashboardStyles.cardSub}>
        {periodLabel}
        {total > 0
          ? searchQuery
            ? ` · ${t("partnerApp.dashboard.shown", "{{n}} of {{m}}", {
                n: filteredProducts.length,
                m: products.length,
              })}`
            : ` · ${total}`
          : ""}
      </div>

      {products.length > 0 ? (
        <div className={dashboardStyles.productsToolbar}>
          <div className={dashboardStyles.productsSearch}>
            <Search size={16} className={dashboardStyles.productsSearchIcon} />
            <input
              className={dashboardStyles.productsSearchInput}
              type="search"
              placeholder={t("partnerApp.dashboard.searchProducts", "Search products…")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t("partnerApp.dashboard.searchProducts", "Search products…")}
            />
          </div>
          <button
            type="button"
            className={dashboardStyles.exportButton}
            disabled={loading || exporting || filteredProducts.length === 0}
            onClick={() =>
              void runExport(() =>
                exportPartnerDashboardProductsToExcel({
                  title,
                  periodLabel,
                  products: filteredProducts,
                  totals: resolvedTotals,
                  t,
                  filePrefix,
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

      {loading && products.length === 0 ? (
        <div className={dashboardStyles.empty}>{t("common.loadingFromRegos", "Loading from Regos…")}</div>
      ) : filteredProducts.length === 0 && !error ? (
        <div className={dashboardStyles.empty}>
          {searchQuery
            ? t("partnerApp.dashboard.emptySearch", "No matches for this search.")
            : t("partnerApp.dashboard.emptyProducts", "No products in this period.")}
        </div>
      ) : (
        <div className={dashboardStyles.productsTableWrap}>
          <DataTable
            tableKey={`partner.dashboard.products.${tabId}`}
            data={filteredProducts}
            columns={columns}
            className={dashboardStyles.productsTable}
            getRowId={(product) => String(product.item_id)}
            isLoading={loading && products.length === 0}
            topRow={
              filteredProducts.length > 0 && !searchQuery
                ? (table) => (
                    <ProductTotalsRow
                      table={table}
                      totals={resolvedTotals}
                      label={t("dashboard.products.totalRow", "Total")}
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
