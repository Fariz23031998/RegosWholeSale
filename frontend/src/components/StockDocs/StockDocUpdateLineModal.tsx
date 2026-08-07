import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  editStockOperations,
  type StockDocKind,
  type StockOperationLine,
} from "@/lib/stock-docs-api";
import { getStockDocDefinition } from "@/lib/stock-doc-definitions";
import { formatAuthError, useAuth } from "@/store/auth";
import styles from "./StockDocs.module.css";

type Props = {
  open: boolean;
  kind: StockDocKind;
  line: StockOperationLine | null;
  onClose: () => void;
  onSaved: () => void;
};

export function StockDocUpdateLineModal({
  open,
  kind,
  line,
  onClose,
  onSaved,
}: Props) {
  const def = getStockDocDefinition(kind);
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const qtyRef = useRef<HTMLInputElement>(null);

  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !line) return;
    setQty(String(line.quantity));
    setCost(line.cost != null ? String(line.cost) : "");
    setPrice(line.price != null ? String(line.price) : "");
    setError("");
    setBusy(false);
    const id = requestAnimationFrame(() => {
      const el = qtyRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open, line]);

  const submit = async () => {
    if (!token || busy || !line) return;
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError(t("stock.errors.invalidQty", "Enter a valid quantity"));
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (kind === "inventory") {
        await editStockOperations(token, kind, [
          {
            id: line.id,
            actual_quantity: quantity,
            update_actual_quantity: true,
          },
        ]);
      } else {
        const entry: {
          id: number;
          quantity: number;
          cost?: number;
          price?: number;
        } = {
          id: line.id,
          quantity,
        };
        if (def.editableCost) {
          entry.cost = cost ? Number(cost) : 0;
        }
        if (def.showPrice) {
          const p = price ? Number(price) : 0;
          if (Number.isFinite(p)) entry.price = p;
        }
        await editStockOperations(token, kind, [entry]);
      }
      onSaved();
    } catch (err: unknown) {
      setError(formatAuthError(err, t("stock.errors.editLine", "Failed to update line")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open && Boolean(line)}
      onClose={onClose}
      title={t("stock.editLine.title", "Edit line")}
    >
      {line ? (
        <>
          <div className={styles.addLineFields}>
            <div className={styles.formField}>
              <label>{t("stock.detail.table.product", "Product")}</label>
              <div className={styles.addLinePicked}>
                {line.item_name ?? `#${line.item_id}`}
                {line.item_code ? ` · ${line.item_code}` : ""}
              </div>
            </div>
            <div className={styles.formField}>
              <label>{t("stock.detail.table.qty", "Qty")}</label>
              <input
                ref={qtyRef}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                inputMode="decimal"
                autoFocus
              />
            </div>
            {def.editableCost && (
              <div className={styles.formField}>
                <label>{t("stock.detail.table.cost", "Cost")}</label>
                <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" />
              </div>
            )}
            {def.showPrice && (
              <div className={styles.formField}>
                <label>{t("stock.detail.table.price", "Price")}</label>
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            )}
          </div>

          {error ? <div className={styles.errorInline}>{error}</div> : null}

          <div className={styles.formActions}>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void submit()}>
              {t("common.save", "Save")}
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
