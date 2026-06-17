import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { formatAuthError, useAuth } from "@/store/auth";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  fetchWholesaleDocuments,
  fetchWholesaleOperations,
  type WholesaleDocument,
  type WholesaleOperationLine,
} from "@/lib/sales-api";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { ReceiptView } from "@/components/Receipt/ReceiptView";
import type { Sale } from "@/data/seed";
import { Printer } from "lucide-react";
import styles from "./Sales.module.css";

type Range = "today" | "week" | "all";

type SaleDetail = {
  document: WholesaleDocument;
  operations: WholesaleOperationLine[];
};

function rangeToTimestamps(range: Range): { start_date?: number; end_date?: number } {
  if (range === "all") return {};
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;
  if (range === "today") {
    return { start_date: now - day, end_date: now };
  }
  return { start_date: now - 7 * day, end_date: now };
}

function documentToSale(doc: WholesaleDocument, operations: WholesaleOperationLine[]): Sale {
  const createdAt = doc.date > 0 ? new Date(doc.date * 1000).toISOString() : new Date().toISOString();
  const items = operations.map((op) => ({
    productId: String(op.item_id),
    name: op.item_name ?? `Item #${op.item_id}`,
    price: op.price,
    qty: op.quantity,
  }));
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const total = doc.amount ?? subtotal;
  return {
    id: doc.code || String(doc.id),
    createdAt,
    cashierId: "",
    cashierName: doc.partner_name ?? "—",
    items,
    subtotal: +subtotal.toFixed(2),
    discount: Math.max(0, +(subtotal - total).toFixed(2)),
    tax: 0,
    total: +total.toFixed(2),
    paymentTypeId: 0,
    paymentTypeName: "Regos",
    isCash: false,
  };
}

export function SalesPage() {
  const token = useAuth((s) => s.accessToken);
  const [range, setRange] = useState<Range>("week");
  const [documents, setDocuments] = useState<WholesaleDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setDocuments([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    const params = rangeToTimestamps(range);
    void fetchWholesaleDocuments(token, { ...params, limit: 100 })
      .then((res) => {
        if (cancelled) return;
        setDocuments(res.documents);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDocuments([]);
        setError(formatAuthError(err, "Failed to load sales"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, range]);

  const filtered = useMemo(() => documents, [documents]);
  const total = filtered.reduce((s, x) => s + (x.amount ?? 0), 0);

  const openDocument = async (doc: WholesaleDocument) => {
    if (!token) return;
    setDetailLoading(true);
    try {
      const res = await fetchWholesaleOperations(token, doc.id);
      setOpen({ document: doc, operations: res.operations });
    } catch (err: unknown) {
      setError(formatAuthError(err, "Failed to load sale details"));
    } finally {
      setDetailLoading(false);
    }
  };

  const receiptSale = open ? documentToSale(open.document, open.operations) : null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Sales</h1>
          <div className={styles.subtitle}>
            {loading
              ? "Loading…"
              : `${filtered.length} transactions · ${formatCurrency(total)}`}
          </div>
        </div>
        <div className={styles.filters}>
          {(["today", "week", "all"] as Range[]).map((r) => (
            <button
              key={r}
              className={clsx(styles.filter, range === r && styles.filterActive)}
              onClick={() => setRange(r)}
            >
              {r === "today" ? "Today" : r === "week" ? "Last 7 days" : "All time"}
            </button>
          ))}
        </div>
      </div>

      {error && <div className={styles.empty}>{error}</div>}

      <div className={styles.table}>
        {loading ? (
          <div className={styles.empty}>Loading sales from Regos…</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>No sales match these filters.</div>
        ) : (
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Time</th>
                <th>Partner</th>
                <th>Warehouse</th>
                <th className={styles.right}>Total</th>
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
                  <td>{doc.stock_name ?? "—"}</td>
                  <td className={styles.right} style={{ fontWeight: 600 }}>
                    {formatCurrency(doc.amount ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} title="Receipt">
        {receiptSale && (
          <>
            <div className="print-area">
              <ReceiptView sale={receiptSale} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <Button variant="secondary" full onClick={() => window.print()}>
                <Printer size={16} /> Print
              </Button>
              <Button full onClick={() => setOpen(null)}>
                Close
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
