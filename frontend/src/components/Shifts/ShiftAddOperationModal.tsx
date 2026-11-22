import { useEffect, useState } from "react";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { RegosCurrencyOption } from "@/types/settings";
import {
  SHIFT_OPERATION_TYPES,
  type ShiftOperationCreateRequest,
  type ShiftOperationType,
} from "@/types/shifts";
import styles from "./Shifts.module.css";

type ShiftAddOperationModalProps = {
  open: boolean;
  currencies: RegosCurrencyOption[];
  saving?: boolean;
  onClose: () => void;
  onSubmit: (payload: ShiftOperationCreateRequest) => void | Promise<void>;
};

export function ShiftAddOperationModal({
  open,
  currencies,
  saving = false,
  onClose,
  onSubmit,
}: ShiftAddOperationModalProps) {
  const { t } = useLanguage();
  const [opType, setOpType] = useState<ShiftOperationType>("cash_out");
  const [opAmount, setOpAmount] = useState("");
  const [opCurrencyId, setOpCurrencyId] = useState<number | "">("");
  const [opNote, setOpNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setOpType("cash_out");
    setOpAmount("");
    setOpNote("");
    setOpCurrencyId((prev) => {
      if (prev !== "" && currencies.some((c) => c.id === prev)) return prev;
      return currencies[0]?.id ?? "";
    });
  }, [currencies, open]);

  if (!open) return null;

  const handleSubmit = () => {
    if (opCurrencyId === "") return;
    const amount = Number(opAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    void onSubmit({
      operation_type: opType,
      amount,
      currency_id: opCurrencyId,
      note: opNote.trim() || null,
    });
  };

  return (
    <div
      className={`${styles.modalOverlay} ${styles.modalOverlayRaised}`}
      onClick={() => !saving && onClose()}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>{t("shifts.addOperation", "Add operation")}</div>
        <div className={styles.formGrid}>
          <label className={styles.fieldLabel}>
            {t("shifts.operationType", "Operation type")}
            <select
              className={styles.select}
              value={opType}
              onChange={(e) => setOpType(e.target.value as ShiftOperationType)}
            >
              {SHIFT_OPERATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`shifts.ops.${type}`, type)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.fieldLabel}>
            {t("shifts.currency", "Currency")}
            <select
              className={styles.select}
              value={opCurrencyId === "" ? "" : String(opCurrencyId)}
              onChange={(e) =>
                setOpCurrencyId(e.target.value ? Number(e.target.value) : "")
              }
            >
              {currencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code_chr || c.name || `#${c.id}`}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.fieldLabel}>
            {t("shifts.amount", "Amount")}
            <input
              className={styles.input}
              type="number"
              min={0.01}
              step="0.01"
              value={opAmount}
              onChange={(e) => setOpAmount(e.target.value)}
            />
          </label>
          <label className={styles.fieldLabel}>
            {t("shifts.note", "Note")}
            <textarea
              className={styles.textarea}
              value={opNote}
              onChange={(e) => setOpNote(e.target.value)}
            />
          </label>
        </div>
        <div className={styles.modalActions}>
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            type="button"
            disabled={saving || opCurrencyId === ""}
            onClick={handleSubmit}
          >
            {t("shifts.addOperation", "Add operation")}
          </Button>
        </div>
      </div>
    </div>
  );
}
