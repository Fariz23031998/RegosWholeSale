import { useEffect, useState } from "react";
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
  onClose: () => void;
  onConfirm: (qty: number, price?: number) => void;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "DEL"];

export function QtyKeypad({
  open,
  initial,
  initialPrice,
  productName,
  maxQty,
  onClose,
  onConfirm,
}: Props) {
  const hasPrice = initialPrice !== undefined;
  const [qty, setQtyVal] = useState(String(initial));
  const [price, setPriceVal] = useState(String(initialPrice ?? 0));
  const [focus, setFocus] = useState<Field>("qty");
  const [replaceOnNextInput, setReplaceOnNextInput] = useState(true);

  const focusField = (field: Field) => {
    setFocus(field);
    setReplaceOnNextInput(true);
  };

  useEffect(() => {
    if (open) {
      setQtyVal(String(initial));
      setPriceVal(String(initialPrice ?? 0));
      setFocus("qty");
      setReplaceOnNextInput(true);
    }
  }, [open, initial, initialPrice]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === "." || e.key === ",") {
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
  }, [open, qty, price, focus, replaceOnNextInput]);

  function replaceValue(setter: (value: string) => void, k: string) {
    if (k === "DEL") {
      setter("0");
      return;
    }
    if (k === ".") {
      setter("0.");
      return;
    }
    setter(k);
  }

  function update(setter: (u: (v: string) => string) => void, k: string) {
    if (k === "DEL")
      return setter((v) => (v.length <= 1 ? "0" : v.slice(0, -1)));
    if (k === ".") {
      return setter((v) => (v.includes(".") ? v : (v || "0") + "."));
    }
    setter((v) => {
      const next = v === "0" ? k : v + k;
      return next.length > 8 ? v : next;
    });
  }

  function press(k: string) {
    const setter = focus === "price" ? setPriceVal : setQtyVal;

    if (replaceOnNextInput) {
      replaceValue(setter, k);
      if (k !== "DEL") setReplaceOnNextInput(false);
      return;
    }

    update(setter, k);
  }

  function confirm() {
    const n = Math.max(0, parseFloat(qty || "0") || 0);
    let rounded = Math.round(n * 1000) / 1000;
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
          {KEYS.map((k) => (
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
