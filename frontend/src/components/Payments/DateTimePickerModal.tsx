import { useEffect, useState } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  nativeDatetimeLocalToRuValue,
  ruValueToNativeDatetimeLocal,
} from "@/lib/stock-doc-form";
import styles from "./Payments.module.css";

type Props = {
  open: boolean;
  value: string;
  onClose: () => void;
  onApply: (value: string) => void;
};

function splitNative(native: string): { date: string; time: string } {
  const [date = "", time = ""] = native.split("T");
  return { date, time: time.slice(0, 5) };
}

export function DateTimePickerModal({ open, value, onClose, onApply }: Props) {
  const { t } = useLanguage();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const parts = splitNative(ruValueToNativeDatetimeLocal(value));
    setDate(parts.date);
    setTime(parts.time);
    setError("");
  }, [open, value]);

  const handleApply = () => {
    if (!date || !time) {
      setError(
        t("payments.dateTimeModal.bothRequired", "Date and time are required."),
      );
      return;
    }
    const next = nativeDatetimeLocalToRuValue(`${date}T${time}`);
    if (!next) {
      setError(
        t(
          "stock.errors.invalidDate",
          "Enter a valid date and time (dd.MM.yyyy HH:MM)",
        ),
      );
      return;
    }
    onApply(next);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("payments.dateTimeModal.title", "Choose date and time")}
      size="md"
      elevated
    >
      <div className={styles.dateTimeModalForm}>
        <label className={styles.dateTimeModalField}>
          <span>{t("payments.table.date", "Date")}</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label className={styles.dateTimeModalField}>
          <span>{t("payments.dateTimeModal.time", "Time")}</span>
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.dateTimeModalActions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button type="button" onClick={handleApply}>
            {t("common.apply", "Apply")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
