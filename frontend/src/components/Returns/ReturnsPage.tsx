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
import { ReturnsDetailModal } from "@/components/Returns/ReturnsDetailModal";
import type { Sale } from "@/data/seed";
import {
  formatDashboardPeriodLabel,
  PERIOD_LABELS,
  presetToCustomRange,
  resolveDashboardQueryParams,
  type DashboardCustomRange,
  type DashboardPeriodPreset,
} from "@/lib/dashboard-api";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import {
  fetchWholesaleReturnDocumentPayments,
  fetchWholesaleReturnDocuments,
  fetchWholesaleReturnOperations,
  type WholesaleOperationLine,
  type WholesalePaymentLine,
  type WholesaleReturnDocument,
} from "@/lib/sales-api";
import { formatAuthError, useAuth } from "@/store/auth";
import type { RegosDefaultOption } from "@/types/settings";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import styles from "./Returns.module.css";

type PresetPeriod = Exclude<DashboardPeriodPreset, "custom">;

type ReturnDetail = {
  document: WholesaleReturnDocument;
  operations: WholesaleOperationLine[];
  payments: WholesalePaymentLine[];
};

function documentToSale(
  doc: WholesaleReturnDocument,
  operations: WholesaleOperationLine[],
  payments: WholesalePaymentLine[] = [],
): Sale {
  const createdAt = doc.date > 0 ? new Date(doc.date * 1000).toISOString() : new Date().toISOString();
  const items = operations.map((op) => ({
    productId: String(op.item_id),
    name: op.item_name ?? `Item #${op.item_id}`,
    price: op.price,
    qty: op.quantity,
  }));
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const total = doc.amount ?? subtotal;
  const amountPaid = payments.reduce((sum, payment) => sum + (payment.amount ?? 0), 0);
  const paymentLines = payments.map((payment, index) => ({
    paymentTypeId: payment.id || index + 1,
    paymentTypeName: payment.payment_type_name ?? "Payment",
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
    paymentTypeName: primaryPayment?.payment_type_name ?? (payments.length === 0 ? "—" : "Payment"),
    isCash: false,
    amountPaid: payments.length > 0 ? +amountPaid.toFixed(2) : undefined,
    balanceDue: payments.length > 0 ? +Math.max(total - amountPaid, 0).toFixed(2) : undefined,
    payments: paymentLines.length > 0 ? paymentLines : undefined,
  };
}


export function ReturnsPage() {
  const token = useAuth((s) => s.accessToken);
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("week");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<RegosDefaultOption[]>([]);
  const [allStocks, setAllStocks] = useState(true);
  const [selectedStockIds, setSelectedStockIds] = useState<number[]>([]);
  const [returnDocuments, setReturnDocuments] = useState<WholesaleReturnDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<ReturnDetail | null>(null);
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
      setReturnDocuments([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    void fetchWholesaleReturnDocuments(token, { ...queryParams, limit: 100 })
      .then((res) => {
        if (cancelled) return;
        setReturnDocuments(res.documents);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReturnDocuments([]);
        setError(formatAuthError(err, "Failed to load returns"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, queryParams]);

  const total = returnDocuments.reduce((s, x) => s + (x.amount ?? 0), 0);

  const loadReturnDetail = async (doc: WholesaleReturnDocument): Promise<ReturnDetail> => {
    if (!token) {
      throw new Error("Not authenticated");
    }
    const [operationsRes, paymentsRes] = await Promise.all([
      fetchWholesaleReturnOperations(token, doc.id),
      fetchWholesaleReturnDocumentPayments(token, doc.id),
    ]);
    return {
      document: doc,
      operations: operationsRes.operations,
      payments: paymentsRes.payments,
    };
  };

  const openDocument = async (doc: WholesaleReturnDocument) => {
    if (!token) return;
    setDetailLoading(true);
    setOpen({ document: doc, operations: [], payments: [] });
    try {
      const detail = await loadReturnDetail(doc);
      setOpen(detail);
    } catch (err: unknown) {
      setOpen(null);
      setError(formatAuthError(err, "Failed to load return details"));
    } finally {
      setDetailLoading(false);
    }
  };

  const printDocument = async (doc: WholesaleReturnDocument) => {
    if (!token || printingId !== null) return;
    setPrintingId(doc.id);
    setError("");
    try {
      const detail = await loadReturnDetail(doc);
      const sale = documentToSale(detail.document, detail.operations, detail.payments);
      setPrintContext(wholesaleDocumentToPrintContext(detail.document, sale));
    } catch (err: unknown) {
      setError(formatAuthError(err, "Failed to load return for printing"));
    } finally {
      setPrintingId(null);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Returns</h1>
          <div className={styles.subtitle}>
            {loading
              ? "Loading from Regos…"
              : `${returnDocuments.length} returns · ${formatCurrency(total)} · ${formatDashboardPeriodLabel(periodPreset, customRange)} · ${formatWarehouseFilterLabel(allStocks, selectedStockIds, warehouses)}`}
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
              {PERIOD_LABELS[value]}
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
            Period
          </button>
          <button
            type="button"
            className={clsx(dashboardStyles.filter, dashboardStyles.filterMenu)}
            onClick={() => setWarehouseModalOpen(true)}
          >
            <Warehouse size={14} />
            {formatWarehouseFilterLabel(allStocks, selectedStockIds, warehouses)}
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
          <div className={styles.empty}>Loading returns from Regos…</div>
        ) : returnDocuments.length === 0 ? (
          <div className={styles.empty}>No returns match these filters.</div>
        ) : (
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>Return</th>
                <th>Original</th>
                <th>Time</th>
                <th>Partner</th>
                <th>Attached user</th>
                <th>Warehouse</th>
                <th>Reason</th>
                <th className={styles.right}>Total</th>
                <th className={styles.printCol} aria-label="Print" />
              </tr>
            </thead>
            <tbody>
              {returnDocuments.map((doc) => (
                <tr
                  key={doc.id}
                  onClick={() => void openDocument(doc)}
                  style={{ cursor: detailLoading ? "wait" : "pointer" }}
                >
                  <td className={styles.id}>#{doc.code || doc.id}</td>
                  <td className={styles.id}>
                    {doc.wholesale_doc_id ? `#${doc.wholesale_doc_id}` : "—"}
                  </td>
                  <td>
                    {doc.date > 0
                      ? formatDateTime(new Date(doc.date * 1000).toISOString())
                      : "—"}
                  </td>
                  <td>{doc.partner_name ?? "—"}</td>
                  <td>{doc.attached_user_name ?? "—"}</td>
                  <td>{doc.stock_name ?? "—"}</td>
                  <td style={{ color: "var(--color-text-muted)" }}>
                    {doc.reason || "—"}
                  </td>
                  <td
                    className={styles.right}
                    style={{ fontWeight: 600, color: "var(--color-danger, #dc2626)" }}
                  >
                    {formatCurrency(doc.amount ?? 0)}
                  </td>
                  <td className={styles.printCol}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Print return #${doc.code || doc.id}`}
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
        <ReturnsDetailModal
          document={open.document}
          operations={open.operations}
          payments={open.payments}
          loading={detailLoading}
          onClose={() => setOpen(null)}
        />
      )}

      <ReceiptModal
        context={printContext}
        title="Print return"
        closeLabel="Close"
        onClose={() => setPrintContext(null)}
      />
    </div>
  );
}
