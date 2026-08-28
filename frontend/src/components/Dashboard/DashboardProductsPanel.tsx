import { Download, Search } from "lucide-react";
import clsx from "clsx";
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

function DashboardProductTotalsRow({
  totals,
  t,
  showWithoutDiscount,
}: {
  totals: DashboardProductTotals;
  t: TranslateFn;
  showWithoutDiscount: boolean;
}) {
  return (
    <tr className={styles.productsTotalRow}>
      <td colSpan={3}>{t("dashboard.products.totalRow")}</td>
      <td className={styles.num}>—</td>
      <td className={styles.num}>—</td>
      {showWithoutDiscount ? (
        <>
          <td className={styles.num}>—</td>
          <td className={styles.num}>{formatCurrency(totals.total_without_discount ?? 0)}</td>
        </>
      ) : null}
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
  const tableColSpan = showWithoutDiscount ? 17 : 15;
  const productGroupColSpan = showWithoutDiscount ? 7 : 5;

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
          <table className={styles.productsTable}>
            <thead>
              <tr>
                <th className={styles.groupHead} colSpan={productGroupColSpan}>
                  {t(`${copyPrefix}.title`)}
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
                {showWithoutDiscount ? (
                  <>
                    <th className={styles.num}>{t("dashboard.products.col.priceWithoutDiscount")}</th>
                    <th className={styles.num}>{t("dashboard.products.col.totalWithoutDiscount")}</th>
                  </>
                ) : null}
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
              {loading && products.length === 0 ? (
                <tr>
                    <td colSpan={tableColSpan} style={{ color: "var(--color-text-muted)", padding: "24px 10px" }}>
                    {t(`${copyPrefix}.loading`)}
                  </td>
                </tr>
              ) : (
                <>
                  {totals && !searchQuery ? (
                    <DashboardProductTotalsRow
                      totals={totals}
                      t={t}
                      showWithoutDiscount={showWithoutDiscount}
                    />
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
                      {showWithoutDiscount ? (
                        <>
                          <td className={styles.num}>
                            {formatCurrency(product.price_without_discount ?? 0)}
                          </td>
                          <td className={styles.num}>
                            {formatCurrency(product.total_without_discount ?? 0)}
                          </td>
                        </>
                      ) : null}
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
    </div>
  );
}
