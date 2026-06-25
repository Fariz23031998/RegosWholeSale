import { useEffect, useState } from "react";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { TemplatedReceiptView } from "@/components/Receipt/TemplatedReceiptView";
import { ReceiptTemplatePreviewBoundary } from "@/components/Settings/ReceiptTemplatePreviewBoundary";
import { useLanguage } from "@/contexts/LanguageContext";
import { invalidateReceiptTemplateCache } from "@/lib/receipt-template-engine";
import { SAMPLE_RECEIPT_CONTEXT } from "@/lib/receipt-print-context";
import {
  cloneReceiptTemplate,
  defaultCssTemplate,
  defaultHtmlTemplate,
  loadNakladnayaStarterMarkup,
  prepareReceiptTemplateForSave,
  RECEIPT_TEMPLATE_VARIABLE_GROUPS,
} from "@/lib/receipt-template-utils";
import { RECEIPT_LINE_SORT_COLUMNS } from "@/lib/receipt-line-sort";
import { ReceiptTemplateLogosEditor } from "@/components/Settings/ReceiptTemplateLogosEditor";
import type { ReceiptFormat, ReceiptTemplate, ReceiptTemplateEngine } from "@/types/receipt-templates";
import { getReceiptLineSortColumnLabels, getReceiptSectionLabels } from "@/types/receipt-templates";
import styles from "./ReceiptTemplates.module.css";

type EditorTab = "settings" | "html" | "css" | "variables";

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
  const [editorTab, setEditorTab] = useState<EditorTab>("settings");
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    if (!open || !template) {
      setDraft(null);
      setEditorTab("settings");
      return;
    }
    setDraft(cloneReceiptTemplate(template));
    setEditorTab(template.engine === "html" ? "html" : "settings");
    setValidationError("");
  }, [open, template]);

  useEffect(() => {
    if (draft?.engine === "html") {
      invalidateReceiptTemplateCache(draft.id);
    }
  }, [draft?.css, draft?.html, draft?.id, draft?.engine]);

  if (!open || !draft) return null;

  const isHtml = draft.engine === "html";
  const sectionLabels = getReceiptSectionLabels(t);
  const sortColumnLabels = getReceiptLineSortColumnLabels(t);
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
      const next = {
        ...current,
        format,
        invoice_title: format === "a4" ? "INVOICE" : "",
        sections: {
          ...current.sections,
          partner: format === "a4",
        },
      };
      if (current.engine === "html") {
        return {
          ...next,
          html: defaultHtmlTemplate(format),
          css: defaultCssTemplate(format),
        };
      }
      return next;
    });
  };

  const handleEngineChange = (engine: ReceiptTemplateEngine) => {
    if (!isNew) return;
    setDraft((current) => {
      if (!current) return current;
      if (engine === current.engine) return current;
      if (engine === "html") {
        return {
          ...current,
          engine,
          html: defaultHtmlTemplate(current.format),
          css: defaultCssTemplate(current.format),
        };
      }
      return {
        ...current,
        engine,
        html: "",
        css: "",
      };
    });
    setEditorTab(engine === "html" ? "html" : "settings");
  };

  const loadStarterTemplate = () => {
    setDraft((current) => {
      if (!current) return current;
      const starter = loadNakladnayaStarterMarkup(current.format);
      return {
        ...current,
        html: starter.html,
        css: starter.css,
      };
    });
  };

  const handleSave = () => {
    if (!draft) return;
    try {
      const prepared = prepareReceiptTemplateForSave(draft);
      invalidateReceiptTemplateCache(prepared.id);
      onSave(prepared);
    } catch (err: unknown) {
      setValidationError(
        err instanceof Error ? err.message : "Template markup is not allowed.",
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      fullscreen
      bodyClassName={styles.editorModalBody}
      title={
        isNew
          ? t("settings.receiptTemplates.createTitle", "Create receipt template")
          : t("settings.receiptTemplates.editTitle", "Edit receipt template")
      }
    >
      {validationError ? <p className={styles.error}>{validationError}</p> : null}
      <div className={styles.editorLayout}>
        <div className={styles.editorForm}>
          {isHtml ? (
            <div className={styles.editorTabs}>
              {(["settings", "html", "css", "variables"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`${styles.editorTab} ${editorTab === tab ? styles.editorTabActive : ""}`}
                  onClick={() => setEditorTab(tab)}
                >
                  {tab === "settings"
                    ? t("settings.receiptTemplates.tabSettings", "Settings")
                    : tab === "html"
                      ? t("settings.receiptTemplates.tabHtml", "HTML")
                      : tab === "css"
                        ? t("settings.receiptTemplates.tabCss", "CSS")
                        : t("settings.receiptTemplates.tabVariables", "Variables")}
                </button>
              ))}
            </div>
          ) : null}

          {(editorTab === "settings" || !isHtml) && (
            <>
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

              {isNew ? (
                <>
                  <label className={styles.field}>
                    <span className={styles.label}>
                      {t("settings.receiptTemplates.templateType", "Template type")}
                    </span>
                    <select
                      className={styles.select}
                      value={draft.engine}
                      onChange={(e) =>
                        handleEngineChange(e.target.value as ReceiptTemplateEngine)
                      }
                    >
                      <option value="builtin">
                        {t("settings.receiptTemplates.engineBuiltin", "Built-in layout")}
                      </option>
                      <option value="html">
                        {t("settings.receiptTemplates.engineHtml", "Custom HTML")}
                      </option>
                    </select>
                  </label>

                  <label className={styles.field}>
                    <span className={styles.label}>{t("common.format", "Format")}</span>
                    <select
                      className={styles.select}
                      value={draft.format}
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
                </>
              ) : (
                <div className={styles.readonlyMeta}>
                  {draft.engine === "html"
                    ? t("settings.receiptTemplates.engineHtml", "Custom HTML")
                    : t("settings.receiptTemplates.engineBuiltin", "Built-in layout")}
                  {" · "}
                  {draft.format === "a4"
                    ? t("settings.receiptTemplates.formatA4", "A4 invoice")
                    : t("settings.receiptTemplates.format80mm", "80mm receipt")}
                </div>
              )}

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

              <ReceiptTemplateLogosEditor
                logos={draft.logos}
                onChange={(logos) => {
                  setValidationError("");
                  setDraft({ ...draft, logos });
                }}
                onError={setValidationError}
              />

              {(draft.format === "a4" || isHtml) && (
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

              <label className={styles.field}>
                <span className={styles.label}>
                  {t(
                    "settings.receiptTemplates.amountInWordsLanguage",
                    "Total amount in words (language)",
                  )}
                </span>
                <select
                  className={styles.select}
                  value={draft.amount_in_words_language ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      amount_in_words_language: e.target.value
                        ? (e.target.value as typeof draft.amount_in_words_language)
                        : null,
                    })
                  }
                >
                  <option value="">
                    {t("settings.receiptTemplates.amountInWordsOff", "Off")}
                  </option>
                  <option value="ru">
                    {t("settings.receiptTemplates.amountInWordsRu", "Russian")}
                  </option>
                  <option value="uz">
                    {t("settings.receiptTemplates.amountInWordsUz", "Uzbek")}
                  </option>
                  <option value="en">
                    {t("settings.receiptTemplates.amountInWordsEn", "English")}
                  </option>
                  <option value="tj">
                    {t("settings.receiptTemplates.amountInWordsTj", "Tajik")}
                  </option>
                </select>
                <p className={styles.sortHelp}>
                  {t(
                    "settings.receiptTemplates.amountInWordsHelp",
                    "Use {{sale.total_with_words}} in HTML templates, or {{formatAmountWithWords sale.total document.currency}} for custom amounts.",
                  )}
                </p>
              </label>

              <div className={styles.sortSettings}>
                <div className={styles.label}>
                  {t("settings.receiptTemplates.sort.title", "Line item sorting")}
                </div>
                <p className={styles.sortHelp}>
                  {t(
                    "settings.receiptTemplates.sort.help",
                    "Applies to line items in built-in layouts and to operations / operation_groups in HTML templates.",
                  )}
                </p>
                <div className={styles.sortRow}>
                  <label className={styles.field}>
                    <span className={styles.label}>
                      {t("settings.receiptTemplates.sort.column", "Sort by")}
                    </span>
                    <select
                      className={styles.select}
                      value={draft.line_sort.column}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          line_sort: {
                            ...draft.line_sort,
                            column: e.target.value as typeof draft.line_sort.column,
                          },
                        })
                      }
                    >
                      {RECEIPT_LINE_SORT_COLUMNS.map((column) => (
                        <option key={column} value={column}>
                          {sortColumnLabels[column]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>
                      {t("settings.receiptTemplates.sort.direction", "Direction")}
                    </span>
                    <select
                      className={styles.select}
                      value={draft.line_sort.direction}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          line_sort: {
                            ...draft.line_sort,
                            direction: e.target.value as "asc" | "desc",
                          },
                        })
                      }
                    >
                      <option value="asc">
                        {t("settings.receiptTemplates.sort.asc", "Ascending")}
                      </option>
                      <option value="desc">
                        {t("settings.receiptTemplates.sort.desc", "Descending")}
                      </option>
                    </select>
                  </label>
                </div>
              </div>

              {!isHtml ? (
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
              ) : null}
            </>
          )}

          {isHtml && editorTab === "html" ? (
            <>
              <div className={styles.toolbar}>
                <button type="button" className={styles.actionBtn} onClick={loadStarterTemplate}>
                  {t("settings.receiptTemplates.loadStarter", "Load starter template")}
                </button>
              </div>
              <label className={`${styles.field} ${styles.codeField}`}>
                <span className={styles.label}>
                  {t("settings.receiptTemplates.htmlLabel", "Handlebars HTML")}
                </span>
                <textarea
                  className={styles.codeArea}
                  value={draft.html}
                  onChange={(e) => {
                    setValidationError("");
                    setDraft({ ...draft, html: e.target.value });
                  }}
                  spellCheck={false}
                />
              </label>
            </>
          ) : null}

          {isHtml && editorTab === "css" ? (
            <label className={`${styles.field} ${styles.codeField}`}>
              <span className={styles.label}>{t("settings.receiptTemplates.tabCss", "CSS")}</span>
              <textarea
                className={styles.codeArea}
                value={draft.css}
                onChange={(e) => {
                  setValidationError("");
                  setDraft({ ...draft, css: e.target.value });
                }}
                spellCheck={false}
              />
            </label>
          ) : null}

          {isHtml && editorTab === "variables" ? (
            <div className={styles.variablePanel}>
              <p className={styles.variableIntro}>
                {t(
                  "settings.receiptTemplates.variablesHelp",
                  "Use Handlebars expressions in HTML. Arrays support {{#each operations}}...{{/each}}.",
                )}
              </p>
              {RECEIPT_TEMPLATE_VARIABLE_GROUPS.map((group) => (
                <div key={group.label} className={styles.variableGroup}>
                  <div className={styles.variableGroupTitle}>{group.label}</div>
                  <div className={styles.variableList}>
                    {group.variables.map((variable) => {
                      const expression =
                        group.label === "operations[]" || group.label === "payments[]"
                          ? `{{${variable}}}`
                          : group.label === "logos[]"
                            ? variable === "src"
                              ? "{{logoImg name}}"
                              : `{{${variable}}}`
                          : group.label === "operation_groups[]"
                            ? variable === "lines"
                              ? "{{#each lines}}...{{/each}}"
                              : `{{${variable}}}`
                          : group.label === "Root" || group.label === "sale" || group.label === "template" || group.label === "totals"
                            ? `{{${variable}}}`
                            : `{{${group.label}.${variable}}}`;
                      return (
                        <code key={variable} className={styles.variableChip}>
                          {expression}
                        </code>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.previewPane}>
          <div className={styles.previewTitle}>{t("common.preview", "Preview")}</div>
          <div className={styles.previewContent}>
            <ReceiptTemplatePreviewBoundary resetKey={draft.html}>
              <TemplatedReceiptView
                template={draft}
                context={SAMPLE_RECEIPT_CONTEXT}
                preview
              />
            </ReceiptTemplatePreviewBoundary>
          </div>
        </div>
      </div>

      <div className={styles.modalActions}>
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button onClick={handleSave} disabled={!draft.name.trim() || (isHtml && !draft.html.trim())}>
          {t("settings.receiptTemplates.save", "Save template")}
        </Button>
      </div>
    </Modal>
  );
}
