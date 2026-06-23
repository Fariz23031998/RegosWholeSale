import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CalendarRange, Printer, Warehouse } from "lucide-react";
import { Button } from "@/components/posui/Button";
import { ReceiptModal } from "@/components/Receipt/ReceiptModal";
import { wholesaleDocumentToPrintContext, type ReceiptPrintContext } from "@/lib/receipt-print-context";
import { DashboardPeriodModal } from "@/components/Dashboard/DashboardPeriodModal";
import {
  DashboardWarehousesModal,
  formatWarehouseFilterLabel,
} from "@/components/Dashboard/DashboardWarehousesModal";
import { SalesDetailModal } from "@/components/Sales/SalesDetailModal";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Sale } from "@/data/seed";
import {
  formatDashboardPeriodLabel,
  getPeriodLabel,
  presetToCustomRange,
  resolveDashboardQueryParams,
  type DashboardCustomRange,
  type DashboardPeriodPreset,
  type TranslateFn,
} from "@/lib/dashboard-api";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import {
  fetchWholesaleDocumentPayments,
  fetchWholesaleDocuments,
  fetchWholesaleOperations,
  type WholesaleDocument,
  type WholesaleOperationLine,
  type WholesalePaymentLine,
} from "@/lib/sales-api";
import { formatAuthError, useAuth } from "@/store/auth";
import type { RegosDefaultOption } from "@/types/settings";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import styles from "./Sales.module.css";

type PresetPeriod = Exclude<DashboardPeriodPreset, "custom">;

type SaleDetail = {
  document: WholesaleDocument;
  operations: WholesaleOperationLine[];
  payments: WholesalePaymentLine[];
};

function documentToSale(
  doc: WholesaleDocument,
  operations: WholesaleOperationLine[],
  payments: WholesalePaymentLine[] = [],
  t: TranslateFn,
): Sale {
  const createdAt = doc.date > 0 ? new Date(doc.date * 1000).toISOString() : new Date().toISOString();
  const items = operations.map((op) => ({
    productId: String(op.item_id),
    name: op.item_name ?? t("sales.itemFallback", undefined, { id: op.item_id }),
    price: op.price,
    qty: op.quantity,
  }));
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const total = doc.amount ?? subtotal;
  const amountPaid = payments.reduce((sum, payment) => sum + (payment.amount ?? 0), 0);
  const paymentLines = payments.map((payment, index) => ({
    paymentTypeId: payment.id || index + 1,
    paymentTypeName: payment.payment_type_name ?? t("sales.paymentFallback"),
    isCash: false,
    amountPaid: payment.amount ?? 0,
  }));
  const primaryPayment = payments[0];

  return {
    id: doc.code || String(doc.id),
    createdAt,
    cashierId: doc.attached_user_id ? String(doc.attached_user_id) : "",
    cashierName: doc.attached_user_name ?? doc.partner_name ?? "—",
    items,
    subtotal: +subtotal.toFixed(2),
    discount: Math.max(0, +(subtotal - total).toFixed(2)),
    tax: 0,
    total: +total.toFixed(2),
    paymentTypeId: 0,
    paymentTypeName: primaryPayment?.payment_type_name ?? (payments.length === 0 ? "—" : t("sales.paymentFallback")),
    isCash: false,
    amountPaid: payments.length > 0 ? +amountPaid.toFixed(2) : undefined,
    balanceDue: payments.length > 0 ? +Math.max(total - amountPaid, 0).toFixed(2) : undefined,
    payments: paymentLines.length > 0 ? paymentLines : undefined,
  };
}


export function SalesPage() {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("week");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<RegosDefaultOption[]>([]);
  const [allStocks, setAllStocks] = useState(true);
  const [selectedStockIds, setSelectedStockIds] = useState<number[]>([]);
  const [documents, setDocuments] = useState<WholesaleDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [printContext, setPrintContext] = useState<ReceiptPrintContext | null>(null);
  const [printingId, setPrintingId] = useState<number | null>(null);

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
      setDocuments([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    void fetchWholesaleDocuments(token, { ...queryParams, limit: 100 })
      .then((res) => {
        if (cancelled) return;
        setDocuments(res.documents);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDocuments([]);
        setError(formatAuthError(err, t("sales.errors.load")));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, queryParams]);

  const filtered = useMemo(() => documents, [documents]);
  const total = filtered.reduce((s, x) => s + (x.amount ?? 0), 0);

  const loadSaleDetail = async (doc: WholesaleDocument): Promise<SaleDetail> => {
    if (!token) {
      throw new Error(t("common.notAuthenticated"));
    }
    const [operationsRes, paymentsRes] = await Promise.all([
      fetchWholesaleOperations(token, doc.id),
      fetchWholesaleDocumentPayments(token, doc.id),
    ]);
    return {
      document: doc,
      operations: operationsRes.operations,
      payments: paymentsRes.payments,
    };
  };

  const openDocument = async (doc: WholesaleDocument) => {
    if (!token) return;
    setDetailLoading(true);
    setOpen({ document: doc, operations: [], payments: [] });
    try {
      const detail = await loadSaleDetail(doc);
      setOpen(detail);
    } catch (err: unknown) {
      setOpen(null);
      setError(formatAuthError(err, t("sales.errors.loadDetails")));
    } finally {
      setDetailLoading(false);
    }
  };

  const printDocument = async (doc: WholesaleDocument) => {
    if (!token || printingId !== null) return;
    setPrintingId(doc.id);
    setError("");
    try {
      const detail = await loadSaleDetail(doc);
      const sale = documentToSale(detail.document, detail.operations, detail.payments, t);
      setPrintContext(wholesaleDocumentToPrintContext(detail.document, sale));
    } catch (err: unknown) {
      setError(formatAuthError(err, t("sales.errors.loadPrint")));
    } finally {
      setPrintingId(null);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("sales.title")}</h1>
          <div className={styles.subtitle}>
            {loading
              ? t("common.loadingFromRegos")
              : t("sales.subtitle", undefined, {
                  count: filtered.length,
                  total: formatCurrency(total),
                  period: formatDashboardPeriodLabel(periodPreset, customRange, t),
                  warehouses: formatWarehouseFilterLabel(allStocks, selectedStockIds, warehouses, t),
                })}
          </div>
        </div>
        <div className={dashboardStyles.filters}>
          {(["today", "week", "month", "all"] as PresetPeriod[]).map((value) => (
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
          <button
            type="button"
            className={clsx(dashboardStyles.filter, dashboardStyles.filterMenu)}
            onClick={() => setWarehouseModalOpen(true)}
          >
            <Warehouse size={14} />
            {formatWarehouseFilterLabel(allStocks, selectedStockIds, warehouses, t)}
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

      <div className={styles.table}>
        {loading ? (
          <div className={styles.empty}>{t("sales.loading")}</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>{t("sales.empty")}</div>
        ) : (
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>{t("sales.table.receipt")}</th>
                <th>{t("common.time")}</th>
                <th>{t("sales.table.partner")}</th>
                <th>{t("sales.table.attachedUser")}</th>
                <th>{t("sales.table.warehouse")}</th>
                <th className={styles.right}>{t("common.total")}</th>
                <th className={styles.printCol} aria-label={t("sales.print")} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => (
                <tr
                  key={doc.id}
                  onClick={() => void openDocument(doc)}
                  style={{ cursor: detailLoading ? "wait" : "pointer" }}
                >
                  <td className={styles.id}>#{doc.code || doc.id}</td>
                  <td>
                    {doc.date > 0
                      ? formatDateTime(new Date(doc.date * 1000).toISOString())
                      : "—"}
                  </td>
                  <td>{doc.partner_name ?? "—"}</td>
                  <td>{doc.attached_user_name ?? "—"}</td>
                  <td>{doc.stock_name ?? "—"}</td>
                  <td className={styles.right} style={{ fontWeight: 600 }}>
                    {formatCurrency(doc.amount ?? 0)}
                  </td>
                  <td className={styles.printCol}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("sales.printReceipt", undefined, { id: doc.code || doc.id })}
                      disabled={printingId === doc.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void printDocument(doc);
                      }}
                    >
                      <Printer size={16} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <SalesDetailModal
          document={open.document}
          operations={open.operations}
          payments={open.payments}
          loading={detailLoading}
          onClose={() => setOpen(null)}
        />
      )}

      <ReceiptModal
        context={printContext}
        title={t("sales.printModalTitle")}
        closeLabel={t("common.close")}
        onClose={() => setPrintContext(null)}
      />
    </div>
  );
}
