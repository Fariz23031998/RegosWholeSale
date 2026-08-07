import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  addStockOperations,
  type StockDocKind,
  type StockItemSearchHit,
} from "@/lib/stock-docs-api";
import { getStockDocDefinition } from "@/lib/stock-doc-definitions";
import { formatAuthError, useAuth } from "@/store/auth";
import styles from "./StockDocs.module.css";

type Props = {
  open: boolean;
  kind: StockDocKind;
  documentId: number;
  hit: StockItemSearchHit | null;
  onBack: () => void;
  onClose: () => void;
  onAdded: () => void;
};

export function StockDocEditLineModal({
  open,
  kind,
  documentId,
  hit,
  onBack,
  onClose,
  onAdded,
}: Props) {
  const def = getStockDocDefinition(kind);
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const qtyRef = useRef<HTMLInputElement>(null);

  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [updateActualQuantity, setUpdateActualQuantity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !hit) return;
    setQty("1");
    setCost(hit.last_purchase_cost != null ? String(hit.last_purchase_cost) : "");
    setPrice(hit.price != null ? String(hit.price) : "");
    setDescription("");
    setUpdateActualQuantity(false);
    setError("");
    setBusy(false);
    const id = requestAnimationFrame(() => {
      const el = qtyRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open, hit]);

  const submit = async () => {
    if (!token || busy || !hit) return;
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError(t("stock.errors.invalidQty", "Enter a valid quantity"));
      return;
    }

    setBusy(true);
    setError("");
    try {
      let operation;
      if (kind === "inventory") {
        operation = {
          document_id: documentId,
          item_id: hit.id,
          actual_quantity: quantity,
          datetime: Math.floor(Date.now() / 1000),
          update_actual_quantity: updateActualQuantity,
        };
      } else {
        const entry: {
          document_id: number;
          item_id: number;
          quantity: number;
          cost?: number;
          price?: number;
          vat_value?: number;
          description?: string;
        } = {
          document_id: documentId,
          item_id: hit.id,
          quantity,
          vat_value: hit.vat_value ?? 0,
        };
        if (def.editableCost) {
          entry.cost = cost ? Number(cost) : (hit.last_purchase_cost ?? 0);
        }
        if (def.showPrice) {
          const p = price ? Number(price) : (hit.price ?? 0);
          if (p > 0) entry.price = p;
        }
        if (description.trim()) entry.description = description.trim();
        operation = entry;
      }
      await addStockOperations(token, kind, [operation]);
      toast.success(
        t("stock.toast.lineAdded", "Added {{name}} × {{qty}}", {
          name: hit.name,
          qty: quantity,
        }),
      );
      onAdded();
    } catch (err: unknown) {
      setError(formatAuthError(err, t("stock.errors.addLine", "Failed to add line")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open && Boolean(hit)}
      onClose={onClose}
      title={t("stock.editLine.title", "Edit line")}
    >
      {hit ? (
        <>
          <div className={styles.addLineFields}>
            <div className={styles.formField}>
              <label>{t("stock.detail.table.product", "Product")}</label>
              <div className={styles.addLinePicked}>
                {hit.name}
                {hit.barcode ? ` · ${hit.barcode}` : ""}
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
            {kind === "inventory" && (
              <div className={styles.formField}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={updateActualQuantity}
                    onChange={(e) => setUpdateActualQuantity(e.target.checked)}
                    disabled={busy}
                  />
                  <span>
                    {t("stock.editLine.updateActualQuantity", "Replace actual quantity")}
                  </span>
                </label>
              </div>
            )}
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
            {kind !== "inventory" && (
              <div className={styles.formField}>
                <label>{t("common.description")}</label>
                <input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            )}
          </div>

          {error ? <div className={styles.errorInline}>{error}</div> : null}

          <div className={styles.formActions}>
            <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>
              {t("common.back", "Back")}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void submit()}>
              {t("common.add")}
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
