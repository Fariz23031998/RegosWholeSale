import { useEffect, useMemo, useState } from "react";
import { Delete } from "lucide-react";
import clsx from "clsx";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { formatCurrency } from "@/lib/format";
import styles from "./QtyKeypad.module.css";

type Field = "qty" | "price";

type Props = {
  open: boolean;
  initial: number;
  initialPrice?: number;
  productName?: string;
  maxQty?: number | null;
  allowDecimals?: boolean;
  onClose: () => void;
  onConfirm: (qty: number, price?: number) => void;
};

const QTY_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "DEL"];
const INTEGER_QTY_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "DEL"];

function sanitizeIntegerQtyInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "0";
  return digits.replace(/^0+(?=\d)/, "") || "0";
}

export function QtyKeypad({
  open,
  initial,
  initialPrice,
  productName,
  maxQty,
  allowDecimals = true,
  onClose,
  onConfirm,
}: Props) {
  const hasPrice = initialPrice !== undefined;
  const [qty, setQtyVal] = useState(String(initial));
  const [price, setPriceVal] = useState(String(initialPrice ?? 0));
  const [focus, setFocus] = useState<Field>("qty");
  const [replaceOnNextInput, setReplaceOnNextInput] = useState(true);

  const qtyAllowsDecimalInput = allowDecimals || (hasPrice && focus === "price");
  const keys = useMemo(
    () => (qtyAllowsDecimalInput ? QTY_KEYS : INTEGER_QTY_KEYS),
    [qtyAllowsDecimalInput],
  );

  const focusField = (field: Field) => {
    setFocus(field);
    setReplaceOnNextInput(true);
  };

  useEffect(() => {
    if (open) {
      const initialQty = allowDecimals ? initial : Math.round(initial);
      setQtyVal(String(initialQty));
      setPriceVal(String(initialPrice ?? 0));
      setFocus("qty");
      setReplaceOnNextInput(true);
    }
  }, [open, initial, initialPrice, allowDecimals]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === "." || e.key === ",") {
        if (focus === "qty" && !allowDecimals) return;
        e.preventDefault();
        press(".");
      } else if (e.key === "Backspace") {
        e.preventDefault();
        press("DEL");
      } else if (e.key === "Tab" && hasPrice) {
        e.preventDefault();
        focusField(focus === "qty" ? "price" : "qty");
      } else if (e.key === "Enter") {
        e.preventDefault();
        confirm();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, qty, price, focus, replaceOnNextInput, allowDecimals, hasPrice]);

  function replaceValue(setter: (value: string) => void, k: string, field: Field) {
    if (k === "DEL") {
      setter("0");
      return;
    }
    if (k === ".") {
      setter("0.");
      return;
    }
    if (field === "qty" && !allowDecimals) {
      setter(sanitizeIntegerQtyInput(k));
      return;
    }
    setter(k);
  }

  function update(
    setter: (u: (v: string) => string) => void,
    k: string,
    field: Field,
  ) {
    if (k === "DEL") {
      return setter((v) => {
        const next = v.length <= 1 ? "0" : v.slice(0, -1);
        return field === "qty" && !allowDecimals
          ? sanitizeIntegerQtyInput(next)
          : next;
      });
    }
    if (k === ".") {
      return setter((v) => (v.includes(".") ? v : (v || "0") + "."));
    }
    setter((v) => {
      if (field === "qty" && !allowDecimals) {
        const next = sanitizeIntegerQtyInput(v === "0" ? k : v + k);
        return next.length > 8 ? v : next;
      }
      const next = v === "0" ? k : v + k;
      return next.length > 8 ? v : next;
    });
  }

  function press(k: string) {
    if (k === "." && focus === "qty" && !allowDecimals) return;

    const field = focus;
    const setter = field === "price" ? setPriceVal : setQtyVal;

    if (replaceOnNextInput) {
      replaceValue(setter, k, field);
      if (k !== "DEL") setReplaceOnNextInput(false);
      return;
    }

    update(setter, k, field);
  }

  function confirm() {
    const parsed = Math.max(0, parseFloat(qty || "0") || 0);
    let rounded = allowDecimals
      ? Math.round(parsed * 1000) / 1000
      : Math.round(parsed);
    if (maxQty !== null && maxQty !== undefined) {
      rounded = Math.min(rounded, maxQty);
    }
    if (hasPrice) {
      const p = Math.max(0, parseFloat(price || "0") || 0);
      onConfirm(rounded, Math.round(p * 100) / 100);
    } else {
      onConfirm(rounded);
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Set quantity">
      <div className={styles.wrap}>
        {productName && <div className={styles.product}>{productName}</div>}
        {maxQty !== null && maxQty !== undefined ? (
          <div className={styles.limit}>Max available: {maxQty}</div>
        ) : null}

        {hasPrice ? (
          <div className={styles.fields}>
            <button
              type="button"
              className={clsx(
                styles.field,
                focus === "qty" && styles.fieldActive,
              )}
              onClick={() => focusField("qty")}
            >
              <span className={styles.fieldLabel}>Quantity</span>
              <span
                className={clsx(
                  styles.fieldValue,
                  focus === "qty" && replaceOnNextInput && styles.fieldValueSelected,
                )}
              >
                {qty || "0"}
              </span>
            </button>
            <button
              type="button"
              className={clsx(
                styles.field,
                focus === "price" && styles.fieldActive,
              )}
              onClick={() => focusField("price")}
            >
              <span className={styles.fieldLabel}>Price</span>
              <span
                className={clsx(
                  styles.fieldValue,
                  focus === "price" && replaceOnNextInput && styles.fieldValueSelected,
                )}
              >
                {formatCurrency(parseFloat(price || "0") || 0)}
              </span>
            </button>
          </div>
        ) : (
          <div
            className={clsx(
              styles.display,
              replaceOnNextInput && styles.displaySelected,
            )}
          >
            {qty || "0"}
          </div>
        )}

        <div className={styles.grid}>
          {keys.map((k) => (
            <button
              key={k}
              className={`${styles.key} ${k === "DEL" ? styles.action : ""}`}
              onClick={() => press(k)}
              type="button"
            >
              {k === "DEL" ? <Delete size={18} /> : k}
            </button>
          ))}
        </div>
        <div className={styles.footer}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm}>Set</Button>
        </div>
      </div>
    </Modal>
  );
}
