import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import { useIsMobile } from "@/hooks/use-mobile";
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

type LineField = "qty" | "cost" | "price";

function isEnterKey(e: KeyboardEvent<HTMLInputElement>) {
  return e.key === "Enter" || e.code === "Enter" || e.keyCode === 13;
}

export function StockDocUpdateLineModal({
  open,
  kind,
  line,
  onClose,
  onSaved,
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focusGen, setFocusGen] = useState(0);

  const fieldOrder: LineField[] = [
    "qty",
    ...(def.editableCost ? (["cost"] as const) : []),
    ...(def.showPrice ? (["price"] as const) : []),
  ];
  const lastField = fieldOrder[fieldOrder.length - 1] ?? "qty";

  // Reset fields when the modal opens / line changes. Focus runs after
  // qty has committed so select() is not cleared by the value update.
  useEffect(() => {
    if (!open || !line) return;
    setQty(String(line.quantity));
    setCost(line.cost != null ? String(line.cost) : "");
    setPrice(line.price != null ? String(line.price) : "");
    setError("");
    setBusy(false);
    setFocusGen((g) => g + 1);
  }, [open, line]);

  useEffect(() => {
    if (!open || !line || focusGen === 0) return;
    if (qty !== String(line.quantity)) return;
    if (focusedGenRef.current === focusGen) return;
    const id = requestAnimationFrame(() => {
      const el = qtyRef.current;
      if (!el) return;
      focusedGenRef.current = focusGen;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open, line, focusGen, qty]);

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

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const focusAndSelect = (el: HTMLInputElement | null) => {
    if (!el) return;
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
    e.preventDefault();
    e.stopPropagation();
    advanceOrSave(field);
  };

  return (
    <Modal
      open={open && Boolean(line)}
      onClose={onClose}
      title={t("stock.editLine.title", "Edit line")}
      align={isMobile ? "top" : "center"}
    >
      {line ? (
        <form ref={formRef} onSubmit={onFormSubmit}>
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
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose} tabIndex={-1}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button type="submit" disabled={busy} tabIndex={-1}>
              {t("common.save", "Save")}
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
