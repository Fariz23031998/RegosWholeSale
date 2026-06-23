import { useEffect, useState } from "react";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { TemplatedReceiptView } from "@/components/Receipt/TemplatedReceiptView";
import { useLanguage } from "@/contexts/LanguageContext";
import { SAMPLE_RECEIPT_CONTEXT } from "@/lib/receipt-print-context";
import { cloneReceiptTemplate } from "@/lib/receipt-template-utils";
import type { ReceiptFormat, ReceiptTemplate } from "@/types/receipt-templates";
import { getReceiptSectionLabels } from "@/types/receipt-templates";
import styles from "./ReceiptTemplates.module.css";

type Props = {
  open: boolean;
  template: ReceiptTemplate | null;
  isNew: boolean;
  onClose: () => void;
  onSave: (template: ReceiptTemplate) => void;
};

export function ReceiptTemplateEditorModal({
  open,
  template,
  isNew,
  onClose,
  onSave,
}: Props) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<ReceiptTemplate | null>(null);

  useEffect(() => {
    if (!open || !template) {
      setDraft(null);
      return;
    }
    setDraft(cloneReceiptTemplate(template));
  }, [open, template]);

  if (!open || !draft) return null;

  const sectionLabels = getReceiptSectionLabels(t);
  const sectionKeys = Object.keys(sectionLabels) as Array<keyof typeof sectionLabels>;

  const updateHeader = (field: keyof ReceiptTemplate["header"], value: string) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            header: { ...current.header, [field]: value },
          }
        : current,
    );
  };

  const updateSection = (key: keyof ReceiptTemplate["sections"], value: boolean) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            sections: { ...current.sections, [key]: value },
          }
        : current,
    );
  };

  const handleFormatChange = (format: ReceiptFormat) => {
    if (!isNew) return;
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        format,
        invoice_title: format === "a4" ? "INVOICE" : "",
        sections: {
          ...current.sections,
          partner: format === "a4",
        },
      };
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        isNew
          ? t("settings.receiptTemplates.createTitle", "Create receipt template")
          : t("settings.receiptTemplates.editTitle", "Edit receipt template")
      }
      size="lg"
    >
      <div className={styles.editorLayout}>
        <div className={styles.editorForm}>
          <label className={styles.field}>
            <span className={styles.label}>
              {t("settings.receiptTemplates.templateName", "Template name")}
            </span>
            <input
              className={styles.input}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>{t("common.format", "Format")}</span>
            <select
              className={styles.select}
              value={draft.format}
              disabled={!isNew}
              onChange={(e) => handleFormatChange(e.target.value as ReceiptFormat)}
            >
              <option value="80mm">
                {t("settings.receiptTemplates.format80mm", "80mm receipt")}
              </option>
              <option value="a4">
                {t("settings.receiptTemplates.formatA4", "A4 invoice")}
              </option>
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>
              {t("settings.receiptTemplates.companyName", "Company name")}
            </span>
            <input
              className={styles.input}
              value={draft.header.company_name}
              onChange={(e) => updateHeader("company_name", e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>
              {t("settings.receiptTemplates.address", "Address")}
            </span>
            <input
              className={styles.input}
              value={draft.header.address}
              onChange={(e) => updateHeader("address", e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>
              {t("settings.receiptTemplates.phone", "Phone")}
            </span>
            <input
              className={styles.input}
              value={draft.header.phone}
              onChange={(e) => updateHeader("phone", e.target.value)}
            />
          </label>

          {draft.format === "a4" && (
            <>
              <label className={styles.field}>
                <span className={styles.label}>
                  {t("settings.receiptTemplates.taxId", "Tax ID")}
                </span>
                <input
                  className={styles.input}
                  value={draft.header.tax_id}
                  onChange={(e) => updateHeader("tax_id", e.target.value)}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>
                  {t("settings.receiptTemplates.invoiceTitle", "Invoice title")}
                </span>
                <input
                  className={styles.input}
                  value={draft.invoice_title}
                  onChange={(e) => setDraft({ ...draft, invoice_title: e.target.value })}
                />
              </label>
            </>
          )}

          <label className={styles.field}>
            <span className={styles.label}>
              {t("settings.receiptTemplates.footerMessage", "Footer message")}
            </span>
            <textarea
              className={styles.textarea}
              value={draft.footer_text}
              onChange={(e) => setDraft({ ...draft, footer_text: e.target.value })}
            />
          </label>

          <div className={styles.sectionToggles}>
            <div className={styles.label}>
              {t("settings.receiptTemplates.visibleSections", "Visible sections")}
            </div>
            {sectionKeys.map((key) => {
              const disabled = draft.format === "80mm" && key === "partner";
              return (
                <label
                  key={key}
                  className={`${styles.toggleRow} ${disabled ? styles.toggleRowDisabled : ""}`}
                >
                  <span>{sectionLabels[key]}</span>
                  <input
                    type="checkbox"
                    checked={draft.sections[key]}
                    disabled={disabled}
                    onChange={(e) => updateSection(key, e.target.checked)}
                  />
                </label>
              );
            })}
          </div>
        </div>

        <div className={styles.previewPane}>
          <div className={styles.previewTitle}>{t("common.preview", "Preview")}</div>
          <TemplatedReceiptView template={draft} context={SAMPLE_RECEIPT_CONTEXT} />
        </div>
      </div>

      <div className={styles.modalActions}>
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button onClick={() => onSave(draft)} disabled={!draft.name.trim()}>
          {t("settings.receiptTemplates.save", "Save template")}
        </Button>
      </div>
    </Modal>
  );
}
