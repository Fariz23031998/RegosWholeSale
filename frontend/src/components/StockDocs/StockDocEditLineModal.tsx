import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  addStockOperations,
  type StockDocKind,
  type StockItemSearchHit,
} from "@/lib/stock-docs-api";
import { getStockDocDefinition } from "@/lib/stock-doc-definitions";
import { truncateToastName } from "@/lib/format";
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

type LineField = "qty" | "cost" | "price";

function isEnterKey(e: KeyboardEvent<HTMLInputElement>) {
  return e.key === "Enter" || e.code === "Enter" || e.keyCode === 13;
}

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
  const isMobile = useIsMobile();
  const token = useAuth((s) => s.accessToken);
  const formRef = useRef<HTMLFormElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const focusedGenRef = useRef(0);

  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [updateActualQuantity, setUpdateActualQuantity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focusGen, setFocusGen] = useState(0);

  const fieldOrder: LineField[] = [
    "qty",
    ...(def.editableCost ? (["cost"] as const) : []),
    ...(def.showPrice ? (["price"] as const) : []),
  ];
  const lastField = fieldOrder[fieldOrder.length - 1] ?? "qty";

  // Reset fields when the modal opens / product changes. Focus runs after
  // qty has committed so select() is not cleared by the value update.
  useEffect(() => {
    if (!open || !hit) return;
    setQty("1");
    setCost(hit.last_purchase_cost != null ? String(hit.last_purchase_cost) : "");
    setPrice(hit.price != null ? String(hit.price) : "");
    setUpdateActualQuantity(false);
    setError("");
    setBusy(false);
    setFocusGen((g) => g + 1);
  }, [open, hit]);

  useEffect(() => {
    if (!open || !hit || focusGen === 0) return;
    if (qty !== "1") return;
    if (focusedGenRef.current === focusGen) return;
    const id = requestAnimationFrame(() => {
      const el = qtyRef.current;
      if (!el) return;
      focusedGenRef.current = focusGen;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open, hit, focusGen, qty]);

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
        operation = entry;
      }
      await addStockOperations(token, kind, [operation]);
      toast.success(
        t("stock.toast.lineAdded", "Added {{name}} × {{qty}}", {
          name: truncateToastName(hit.name),
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

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const focusAndSelect = (el: HTMLInputElement | null) => {
    if (!el) return;
    // rAF helps virtual keyboards keep the caret/selection after IME Next.
    requestAnimationFrame(() => {
      el.focus();
      el.select();
    });
  };

  const fieldRef = (field: LineField) => {
    if (field === "qty") return qtyRef.current;
    if (field === "cost") return costRef.current;
    return priceRef.current;
  };

  const advanceOrSave = (field: LineField) => {
    if (field === lastField) {
      // Prefer form submit so mobile IME Done / single-field Enter both work.
      if (formRef.current?.requestSubmit) {
        formRef.current.requestSubmit();
      } else {
        void submit();
      }
      return;
    }
    const next = fieldOrder[fieldOrder.indexOf(field) + 1];
    if (next) focusAndSelect(fieldRef(next));
  };

  const onFieldKeyDown = (field: LineField) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (!isEnterKey(e)) return;
    // Stop the soft keyboard from submitting early or jumping to buttons.
    e.preventDefault();
    e.stopPropagation();
    advanceOrSave(field);
  };

  return (
    <Modal
      open={open && Boolean(hit)}
      onClose={onClose}
      title={t("stock.editLine.title", "Edit line")}
      align={isMobile ? "top" : "center"}
      elevated
    >
      {hit ? (
        <form ref={formRef} onSubmit={onFormSubmit}>
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
                name="qty"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={onFieldKeyDown("qty")}
                inputMode="decimal"
                enterKeyHint={lastField === "qty" ? "done" : "next"}
                autoComplete="off"
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
                    // Keep IME Next on the numeric field chain (qty → cost → price).
                    tabIndex={-1}
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
                <input
                  ref={costRef}
                  name="cost"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={onFieldKeyDown("cost")}
                  inputMode="decimal"
                  enterKeyHint={lastField === "cost" ? "done" : "next"}
                  autoComplete="off"
                />
              </div>
            )}
            {def.showPrice && (
              <div className={styles.formField}>
                <label>{t("stock.detail.table.price", "Price")}</label>
                <input
                  ref={priceRef}
                  name="price"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={onFieldKeyDown("price")}
                  inputMode="decimal"
                  enterKeyHint="done"
                  autoComplete="off"
                />
              </div>
            )}
          </div>

          {error ? <div className={styles.errorInline}>{error}</div> : null}

          <div className={styles.formActions}>
            <Button type="button" variant="ghost" disabled={busy} onClick={onBack} tabIndex={-1}>
              {t("common.back", "Back")}
            </Button>
            <Button type="submit" disabled={busy} tabIndex={-1}>
              {t("common.add")}
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
