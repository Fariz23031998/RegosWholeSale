import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
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
import {
  applyMarkupToCost,
  parseMarkupPercent,
} from "@/lib/purchase-line-markup";
import {
  loadPurchaseLineMarkup,
  savePurchaseLineMarkup,
} from "@/lib/purchase-line-markup-db";
import {
  productHasSecondaryUnit,
  toBaseQty,
  toDisplayUnitMoney,
  toEnteredQty,
  toMainUnitMoney,
  unitMetaForSelection,
  type SecondaryUnitCapable,
  type SelectedUnitKind,
} from "@/lib/secondary-units";
import { formatAuthError, useAuth } from "@/store/auth";
import styles from "./StockDocs.module.css";

function lineToUnitSource(line: StockOperationLine): SecondaryUnitCapable {
  return {
    unit_name: line.item_unit_name,
    unit_type: line.unit_type ?? null,
    secondary_unit_id: line.secondary_unit_id,
    secondary_unit_name: line.secondary_unit_name,
    secondary_unit_type: line.secondary_unit_type,
    conversion_factor: line.conversion_factor,
  };
}

/** Rescale a cost/price string between unit factors; leave empty/invalid alone. */
function rescaleMoneyField(
  value: string,
  fromFactor: number,
  toFactor: number,
): string {
  if (!value.trim()) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const main = toMainUnitMoney(n, fromFactor);
  return String(toDisplayUnitMoney(main, toFactor));
}

type Props = {
  open: boolean;
  kind: StockDocKind;
  line: StockOperationLine | null;
  onClose: () => void;
  onSaved: () => void;
};

type LineField = "qty" | "cost" | "markup" | "price";

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
  const showMarkup = def.editableCost && def.showPrice;
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const token = useAuth((s) => s.accessToken);
  const formRef = useRef<HTMLFormElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);
  const markupRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const focusedGenRef = useRef(0);

  const [qty, setQty] = useState("1");
  const [selectedUnit, setSelectedUnit] = useState<SelectedUnitKind>("main");
  const [cost, setCost] = useState("");
  const [markup, setMarkup] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focusGen, setFocusGen] = useState(0);

  const unitSource = useMemo(
    () => (line ? lineToUnitSource(line) : null),
    [line],
  );
  const canChooseUnit = Boolean(unitSource && productHasSecondaryUnit(unitSource));
  const unitMeta = unitSource
    ? unitMetaForSelection(unitSource, selectedUnit)
    : { conversionFactor: 1, selectedUnitName: null, selectedUnitType: null, unitType: null };

  const fieldOrder: LineField[] = [
    "qty",
    ...(def.editableCost ? (["cost"] as const) : []),
    ...(def.showPrice ? (["price"] as const) : []),
    ...(showMarkup ? (["markup"] as const) : []),
  ];
  const lastField = fieldOrder[fieldOrder.length - 1] ?? "qty";

  // Reset fields when the modal opens / line changes. Focus runs after
  // qty has committed so select() is not cleared by the value update.
  useEffect(() => {
    if (!open || !line) return;
    const nextCost = line.cost != null ? String(line.cost) : "";
    const nextPrice = line.price != null ? String(line.price) : "";
    setQty(String(line.quantity));
    setSelectedUnit("main");
    setCost(nextCost);
    setMarkup("");
    setPrice(nextPrice);
    setError("");
    setBusy(false);
    setFocusGen((g) => g + 1);

    if (!showMarkup) return;
    let cancelled = false;
    void loadPurchaseLineMarkup()
      .then((saved) => {
        if (cancelled) return;
        if (saved == null) return;
        setMarkup(String(saved));
        const costNum = Number(nextCost);
        const calculated = applyMarkupToCost(costNum, saved);
        if (calculated != null) setPrice(String(calculated));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, line, showMarkup]);

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

  const selectUnit = (next: SelectedUnitKind) => {
    if (!unitSource || next === selectedUnit) return;
    const entered = Number(qty);
    const currentMeta = unitMetaForSelection(unitSource, selectedUnit);
    const nextMeta = unitMetaForSelection(unitSource, next);
    if (Number.isFinite(entered) && entered > 0) {
      const base = toBaseQty(entered, currentMeta.conversionFactor);
      setQty(String(toEnteredQty(base, nextMeta.conversionFactor)));
    }
    setCost((prev) =>
      rescaleMoneyField(prev, currentMeta.conversionFactor, nextMeta.conversionFactor),
    );
    setPrice((prev) =>
      rescaleMoneyField(prev, currentMeta.conversionFactor, nextMeta.conversionFactor),
    );
    setSelectedUnit(next);
  };

  const submit = async () => {
    if (!token || busy || !line) return;
    const enteredQty = Number(qty);
    if (!Number.isFinite(enteredQty) || enteredQty <= 0) {
      setError(t("stock.errors.invalidQty", "Enter a valid quantity"));
      return;
    }
    const quantity = toBaseQty(enteredQty, unitMeta.conversionFactor);
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
          const raw = cost ? Number(cost) : 0;
          entry.cost = Number.isFinite(raw)
            ? toMainUnitMoney(raw, unitMeta.conversionFactor)
            : 0;
        }
        if (def.showPrice) {
          const raw = price ? Number(price) : 0;
          const p = Number.isFinite(raw)
            ? toMainUnitMoney(raw, unitMeta.conversionFactor)
            : 0;
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
    if (field === "markup") return markupRef.current;
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

  const onCostChange = (value: string) => {
    setCost(value);
    const markupPct = parseMarkupPercent(markup);
    if (markupPct == null) return;
    const calculated = applyMarkupToCost(Number(value), markupPct);
    if (calculated != null) setPrice(String(calculated));
  };

  const onMarkupChange = (value: string) => {
    setMarkup(value);
    const markupPct = parseMarkupPercent(value);
    void savePurchaseLineMarkup(markupPct).catch(() => undefined);
    if (markupPct == null) return;
    const calculated = applyMarkupToCost(Number(cost), markupPct);
    if (calculated != null) setPrice(String(calculated));
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
            {canChooseUnit && unitSource ? (
              <div className={`${styles.formField} ${styles.unitChoiceField}`}>
                <label>{t("pos.unitChoice.title", "Choose unit")}</label>
                <div className={styles.unitChoice} role="group">
                  <button
                    type="button"
                    className={`${styles.unitBtn} ${
                      selectedUnit === "main" ? styles.unitBtnActive : ""
                    }`}
                    onClick={() => selectUnit("main")}
                    disabled={busy}
                    tabIndex={-1}
                  >
                    {unitSource.unit_name?.trim() ||
                      t("pos.unitChoice.main", "Main unit")}
                  </button>
                  <button
                    type="button"
                    className={`${styles.unitBtn} ${
                      selectedUnit === "secondary" ? styles.unitBtnActive : ""
                    }`}
                    onClick={() => selectUnit("secondary")}
                    disabled={busy}
                    tabIndex={-1}
                  >
                    {unitSource.secondary_unit_name?.trim() ||
                      t("pos.unitChoice.secondary", "Secondary unit")}
                  </button>
                </div>
              </div>
            ) : null}
            <div className={styles.formField}>
              <label>
                {t("stock.detail.table.qty", "Qty")}
                {unitMeta.selectedUnitName
                  ? ` (${unitMeta.selectedUnitName})`
                  : ""}
              </label>
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
                  onChange={(e) => onCostChange(e.target.value)}
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
                  enterKeyHint={lastField === "price" ? "done" : "next"}
                  autoComplete="off"
                />
              </div>
            )}
            {showMarkup && (
              <div className={styles.formField}>
                <label>{t("stock.editLine.markup", "Markup %")}</label>
                <input
                  ref={markupRef}
                  name="markup"
                  value={markup}
                  onChange={(e) => onMarkupChange(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={onFieldKeyDown("markup")}
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
