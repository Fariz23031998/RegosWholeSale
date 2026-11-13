import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/DataTable/DataTable";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type {
  WholesaleDocument,
  WholesaleOperationLine,
  WholesalePaymentLine,
} from "@/lib/sales-api";
import styles from "./Sales.module.css";

type DetailTab = "products" | "payments";

type Props = {
  document: WholesaleDocument;
  operations: WholesaleOperationLine[];
  payments: WholesalePaymentLine[];
  loading?: boolean;
};

export function SalesDetailContent({
  document,
  operations,
  payments,
  loading = false,
}: Props) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<DetailTab>("products");
  const right = { align: "right" as const, cellClassName: styles.right, headerClassName: styles.right };
  const lineColumns = useMemo<ColumnDef<WholesaleOperationLine, any>[]>(
    () => [
      {
        id: "code",
        accessorFn: (op) => op.item_code ?? "",
        header: t("sales.detail.table.code"),
        cell: ({ row }) => row.original.item_code || "—",
        meta: { cellClassName: styles.id },
      },
      {
        id: "product",
        accessorFn: (op) => op.item_name ?? "",
        header: t("sales.detail.table.product"),
        size: 240,
        cell: ({ row }) =>
          row.original.item_name ?? t("sales.itemFallback", undefined, { id: row.original.item_id }),
      },
      {
        id: "qty",
        accessorFn: (op) => op.quantity,
        header: t("sales.detail.table.qty"),
        meta: right,
      },
      {
        id: "price",
        accessorFn: (op) => op.price,
        header: t("sales.detail.table.price"),
        meta: right,
        cell: ({ row }) => formatCurrency(row.original.price),
      },
      {
        id: "amount",
        accessorFn: (op) => op.amount ?? op.price * op.quantity,
        header: t("common.amount"),
        meta: right,
        cell: ({ row }) => formatCurrency(row.original.amount ?? row.original.price * row.original.quantity),
      },
    ],
    [t],
  );
  const paymentColumns = useMemo<ColumnDef<WholesalePaymentLine, any>[]>(
    () => [
      {
        id: "receipt",
        accessorFn: (payment) => payment.code || String(payment.id),
        header: t("sales.table.receipt"),
        cell: ({ row }) => `#${row.original.code || row.original.id}`,
        meta: { cellClassName: styles.id },
      },
      {
        id: "date",
        accessorFn: (payment) => payment.date,
        header: t("common.date"),
        cell: ({ row }) =>
          row.original.date > 0
            ? formatDateTime(new Date(row.original.date * 1000).toISOString())
            : "—",
      },
      {
        id: "type",
        accessorFn: (payment) => payment.payment_type_name ?? "",
        header: t("common.type"),
        cell: ({ getValue }) => getValue<string>() || "—",
      },
      {
        id: "amount",
        accessorFn: (payment) => payment.amount ?? 0,
        header: t("common.amount"),
        meta: right,
        cell: ({ row }) => formatCurrency(row.original.amount ?? 0),
      },
    ],
    [t],
  );

  return (
    <div className={styles.detailStack}>
      <div className={styles.detailMeta}>
        <div>
          <span className={styles.detailLabel}>{t("common.date")}</span>
          <span>
            {document.date > 0
              ? formatDateTime(new Date(document.date * 1000).toISOString())
              : "—"}
          </span>
        </div>
        <div>
          <span className={styles.detailLabel}>{t("sales.table.partner")}</span>
          <span>{document.partner_name ?? "—"}</span>
        </div>
        <div>
          <span className={styles.detailLabel}>{t("sales.table.warehouse")}</span>
          <span>{document.stock_name ?? "—"}</span>
        </div>
        <div>
          <span className={styles.detailLabel}>{t("sales.table.attachedUser")}</span>
          <span>{document.attached_user_name ?? "—"}</span>
        </div>
        <div>
          <span className={styles.detailLabel}>{t("common.total")}</span>
          <span>{formatCurrency(document.amount ?? 0)}</span>
        </div>
      </div>

      <div
        className={styles.detailTabs}
        role="tablist"
        aria-label={t("sales.detail.tabsLabel", "Sale details")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "products"}
          className={`${styles.detailTab} ${activeTab === "products" ? styles.detailTabActive : ""}`}
          onClick={() => setActiveTab("products")}
        >
          {t("sales.detail.products")}
          {!loading ? ` (${operations.length})` : ""}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "payments"}
          className={`${styles.detailTab} ${activeTab === "payments" ? styles.detailTabActive : ""}`}
          onClick={() => setActiveTab("payments")}
        >
          {t("sales.detail.payments")}
          {!loading ? ` (${payments.length})` : ""}
        </button>
      </div>

      {activeTab === "products" ? (
        <div className={styles.detailSection} role="tabpanel">
          {loading ? (
            <div className={styles.detailEmpty}>{t("common.loading")}</div>
          ) : operations.length === 0 ? (
            <div className={styles.detailEmpty}>{t("sales.detail.noProducts")}</div>
          ) : (
            <div className={styles.detailTableWrap}>
              <DataTable
                tableKey="sales.detail.lines"
                data={operations}
                columns={lineColumns}
                className={styles.detailTable}
                getRowId={(op) => String(op.id)}
                enableColumnSettings={false}
              />
            </div>
          )}
        </div>
      ) : (
        <div className={styles.detailSection} role="tabpanel">
          {loading ? (
            <div className={styles.detailEmpty}>{t("common.loading")}</div>
          ) : payments.length === 0 ? (
            <div className={styles.detailEmpty}>{t("sales.detail.noPayments")}</div>
          ) : (
            <div className={styles.detailTableWrap}>
              <DataTable
                tableKey="sales.detail.payments"
                data={payments}
                columns={paymentColumns}
                className={styles.detailTable}
                getRowId={(payment) => String(payment.id)}
                enableColumnSettings={false}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
