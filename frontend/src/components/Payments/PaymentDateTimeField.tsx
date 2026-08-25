import { useState } from "react";
import { Calendar } from "lucide-react";
import { DateTimePickerModal } from "@/components/Payments/DateTimePickerModal";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { DATETIME_RU_PLACEHOLDER } from "@/lib/stock-doc-form";
import styles from "./Payments.module.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
};

export function PaymentDateTimeField({ value, onChange, label, disabled }: Props) {
  const { t } = useLanguage();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <div className={styles.dateTimeField}>
        {label ? <label>{label}</label> : null}
        <div className={styles.dateTimeRow}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={DATETIME_RU_PLACEHOLDER}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
          <Button
            type="button"
            size="icon"
            variant="secondary"
            disabled={disabled}
            aria-label={t("payments.dateTimeModal.title", "Choose date and time")}
            title={t("payments.dateTimeModal.title", "Choose date and time")}
            onClick={() => setPickerOpen(true)}
          >
            <Calendar size={16} />
          </Button>
        </div>
      </div>

      <DateTimePickerModal
        open={pickerOpen}
        value={value}
        onClose={() => setPickerOpen(false)}
        onApply={onChange}
      />
    </>
  );
}
