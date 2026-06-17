import { useMemo, useState } from "react";
import { Undo2 } from "lucide-react";
import type { Sale, SaleItem } from "@/data/seed";
import { useSales } from "@/store/sales";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { QtyKeypad } from "@/components/Cart/QtyKeypad";
import { formatCurrency, formatDateTime } from "@/lib/format";
import styles from "./Returns.module.css";

type Props = {
  sale: Sale | null;
  onClose: () => void;
  onComplete?: (refund: Sale) => void;
};

export function ReturnModal({ sale, onClose, onComplete }: Props) {
  const refund = useSales((s) => s.refund);
  const refundedQty = useSales((s) => s.refundedQty);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [keypadFor, setKeypadFor] = useState<string | null>(null);

  // Reset when sale changes
  useMemo(() => {
    setQtys({});
    setReason("");
    setKeypadFor(null);
  }, [sale?.id]);

  if (!sale) return null;

  const remainingFor = (i: SaleItem) =>
    Math.max(0, i.qty - refundedQty(sale.id, i.productId));

  const setQ = (id: string, q: number, max: number) => {
    const next = Math.max(0, Math.min(max, q));
    setQtys((prev) => ({ ...prev, [id]: next }));
  };

  const selected = sale.items
    .map((i) => ({ item: i, qty: qtys[i.productId] ?? 0 }))
    .filter((x) => x.qty > 0);

  const subtotal = selected.reduce((s, x) => s + x.item.price * x.qty, 0);
  const total = +subtotal.toFixed(2);

  const handleSubmit = () => {
    const items: SaleItem[] = selected.map(({ item, qty }) => ({
      productId: item.productId,
      name: item.name,
      price: item.price,
      qty,
    }));
    const r = refund(sale.id, items, reason.trim());
    if (r) {
      onComplete?.(r);
      onClose();
    }
  };

  return (
    <Modal open={!!sale} onClose={onClose} title={`Return from sale #${sale.id}`} size="lg">
      <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 12 }}>
        {formatDateTime(sale.createdAt)} · {sale.cashierName} ·{" "}
        <span>{sale.paymentTypeName}</span>
      </div>

      <div>
        {sale.items.map((i) => {
          const remaining = remainingFor(i);
          const q = qtys[i.productId] ?? 0;
          const allRefunded = remaining === 0;
          return (
            <div key={i.productId} className={styles.itemRow}>
              <div>
                <div className={styles.itemName}>
                  {i.name}
                  {allRefunded && <span className={styles.refunded}>fully refunded</span>}
                </div>
                <div className={styles.itemMeta}>
                  {formatCurrency(i.price)} ea · sold {i.qty}
                  {remaining < i.qty && ` · ${i.qty - remaining} already refunded`}
                </div>
              </div>
              <button
                type="button"
                className={styles.qtyTap}
                onClick={() => !allRefunded && setKeypadFor(i.productId)}
                disabled={allRefunded}
                aria-label={`Set return quantity for ${i.name}`}
                title="Tap to enter quantity"
              >
                {q}
              </button>
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                / {remaining}
              </div>
              <div className={styles.amount}>
                {formatCurrency(i.price * q)}
              </div>
            </div>
          );
        })}
      </div>

      <textarea
        className={styles.reason}
        rows={2}
        placeholder="Reason for return (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />

      <div className={styles.summary}>
        <span>Refund total</span>
        <span>{formatCurrency(total)}</span>
      </div>

      <div className={styles.actions}>
        <Button variant="ghost" full onClick={onClose}>Cancel</Button>
        <Button full onClick={handleSubmit} disabled={selected.length === 0}>
          <Undo2 size={16} /> Refund {formatCurrency(total)}
        </Button>
      </div>

      {(() => {
        const target = sale.items.find((i) => i.productId === keypadFor);
        if (!target) return null;
        const max = remainingFor(target);
        return (
          <QtyKeypad
            open={keypadFor !== null}
            initial={qtys[target.productId] ?? 0}
            productName={`${target.name} · max ${max}`}
            onClose={() => setKeypadFor(null)}
            onConfirm={(n) => setQ(target.productId, n, max)}
          />
        );
      })()}
    </Modal>
  );
}
