import { useRef } from "react";
import { Calendar } from "lucide-react";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  DATETIME_RU_PLACEHOLDER,
  nativeDatetimeLocalToRuValue,
  ruValueToNativeDatetimeLocal,
} from "@/lib/stock-doc-form";
import styles from "./StockDocs.module.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function StockDocDateTimeField({ value, onChange, disabled }: Props) {
  const { t } = useLanguage();
  const pickerRef = useRef<HTMLInputElement>(null);
  const nativeValue = ruValueToNativeDatetimeLocal(value);

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el || disabled) return;
    try {
      if (typeof el.showPicker === "function") {
        el.showPicker();
      }
    } catch {
      // Overlay input still receives the click as fallback.
    }
  };

  return (
    <div className={styles.formField}>
      <label>{t("stock.fields.dateTime", "Date and time")}</label>
      <div className={styles.dateTimeRow}>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={DATETIME_RU_PLACEHOLDER}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className={styles.dateTimePickerWrap}>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            disabled={disabled}
            tabIndex={-1}
            aria-hidden
            onClick={openPicker}
          >
            <Calendar size={16} />
          </Button>
          <input
            ref={pickerRef}
            type="datetime-local"
            className={styles.dateTimePicker}
            value={nativeValue}
            disabled={disabled}
            aria-label={t("stock.fields.pickDateTime", "Choose date and time")}
            title={t("stock.fields.pickDateTime", "Choose date and time")}
            onClick={openPicker}
            onChange={(e) => {
              const next = nativeDatetimeLocalToRuValue(e.target.value);
              if (next) onChange(next);
            }}
          />
        </div>
      </div>
    </div>
  );
}
