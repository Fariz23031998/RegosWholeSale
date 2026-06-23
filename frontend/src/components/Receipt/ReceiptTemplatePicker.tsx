import { useLanguage } from "@/contexts/LanguageContext";
import type { ReceiptTemplate } from "@/types/receipt-templates";
import styles from "./Receipt.module.css";

type Props = {
  templates: ReceiptTemplate[];
  value: string;
  onChange: (templateId: string) => void;
  disabled?: boolean;
};

export function ReceiptTemplatePicker({
  templates,
  value,
  onChange,
  disabled = false,
}: Props) {
  const { t } = useLanguage();

  if (templates.length <= 1) return null;

  return (
    <label className={styles.templatePicker}>
      <span className={styles.templatePickerLabel}>
        {t("receipt.template", "Template")}
      </span>
      <select
        className={styles.templateSelect}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name} (
            {template.format === "a4"
              ? t("receipt.format.a4Short", "A4")
              : t("receipt.format.80mmShort", "80mm")}
            ){template.is_default ? ` ${t("receipt.defaultSuffix", "· default")}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
