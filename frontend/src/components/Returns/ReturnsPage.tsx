import { useMemo, useState } from "react";
import { Undo2 } from "lucide-react";
import { useSales } from "@/store/sales";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { Sale } from "@/data/seed";
import { Button } from "@/components/posui/Button";
import { ReturnModal } from "./ReturnModal";
import styles from "./Returns.module.css";

export function ReturnsPage() {
  const sales = useSales((s) => s.sales);
  const refundedQty = useSales((s) => s.refundedQty);
  const [active, setActive] = useState<Sale | null>(null);

  const eligible = useMemo(
    () => sales.filter((s) => s.type !== "refund"),
    [sales],
  );

  const refunds = useMemo(
    () => sales.filter((s) => s.type === "refund"),
    [sales],
  );

  const remainingTotal = (s: Sale) => {
    const refundedSubtotal = s.items.reduce(
      (sum, i) => sum + i.price * refundedQty(s.id, i.productId),
      0,
    );
    return Math.max(0, s.subtotal - refundedSubtotal);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Returns</h1>
        <div className={styles.subtitle}>
          Process refunds from past sales. Returned items are added back to stock.
        </div>
      </div>

      <div className={styles.table}>
        {eligible.length === 0 ? (
          <div className={styles.empty}>No sales available to return.</div>
        ) : (
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Time</th>
                <th>Cashier</th>
                <th>Items</th>
                <th className={styles.right}>Total</th>
                <th className={styles.right}>Refundable</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {eligible.map((s) => {
                const remaining = remainingTotal(s);
                const fullyRefunded = remaining === 0;
                return (
                  <tr key={s.id}>
                    <td className={styles.id}>#{s.id}</td>
                    <td>{formatDateTime(s.createdAt)}</td>
                    <td>{s.cashierName}</td>
                    <td>{s.items.reduce((n, i) => n + i.qty, 0)}</td>
                    <td className={styles.right} style={{ fontWeight: 600 }}>
                      {formatCurrency(s.total)}
                    </td>
                    <td className={styles.right}>
                      {fullyRefunded ? (
                        <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                          fully refunded
                        </span>
                      ) : (
                        formatCurrency(remaining)
                      )}
                    </td>
                    <td className={styles.right}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setActive(s)}
                        disabled={fullyRefunded}
                      >
                        <Undo2 size={14} /> Return
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {refunds.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, marginTop: 32, marginBottom: 12 }}>
            Recent refunds
          </h2>
          <div className={styles.table}>
            <table className={styles.tbl}>
              <thead>
                <tr>
                  <th>Refund</th>
                  <th>Original</th>
                  <th>Time</th>
                  <th>Reason</th>
                  <th className={styles.right}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.id}>
                    <td className={styles.id}>#{r.id}</td>
                    <td className={styles.id}>#{r.refundOf}</td>
                    <td>{formatDateTime(r.createdAt)}</td>
                    <td style={{ color: "var(--color-text-muted)" }}>
                      {r.reason || "—"}
                    </td>
                    <td className={styles.right} style={{ fontWeight: 600, color: "var(--color-danger, #dc2626)" }}>
                      {formatCurrency(r.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ReturnModal sale={active} onClose={() => setActive(null)} />
    </div>
  );
}
