import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  fetchReceiptTemplates,
  patchReceiptTemplates,
} from "@/lib/receipt-templates-api";
import {
  cloneReceiptTemplate,
  createNakladnayaTemplate,
  createReceiptTemplate,
  downloadReceiptTemplateExport,
  normalizeDefaultFlag,
  normalizeReceiptTemplates,
  parseImportedReceiptTemplate,
} from "@/lib/receipt-template-utils";
import { formatAuthError, useAuth } from "@/store/auth";
import type { ReceiptFormat, ReceiptTemplate, ReceiptTemplateEngine } from "@/types/receipt-templates";
import { ReceiptTemplateEditorModal } from "./ReceiptTemplateEditorModal";
import styles from "./ReceiptTemplates.module.css";
import pageStyles from "@/routes/settings.module.css";

type EditorState = {
  template: ReceiptTemplate;
  isNew: boolean;
} | null;

export function ReceiptTemplatesPage() {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const companyName = user?.company?.name ?? t("settings.companyFallback", "Company");
  const canManageSettings = Boolean(user?.permissions.includes("settings.manage"));

  const [templates, setTemplates] = useState<ReceiptTemplate[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const loadTemplates = async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetchReceiptTemplates(token);
      setTemplates(normalizeReceiptTemplates(response.settings.templates));
      setDefaultTemplateId(response.settings.default_template_id);
    } catch (err: unknown) {
      setError(
        formatAuthError(
          err,
          t("settings.receiptTemplates.errors.load", "Failed to load receipt templates"),
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, [token]);

  const persistTemplates = async (
    nextTemplates: ReceiptTemplate[],
    nextDefaultId: string | null,
  ) => {
    if (!token || !canManageSettings) return;
    setSaving(true);
    setError("");
    try {
      const normalized = normalizeDefaultFlag(nextTemplates, nextDefaultId);
      const resolvedDefaultId =
        normalized.find((template) => template.is_default)?.id ?? null;
      const response = await patchReceiptTemplates(token, {
        templates: normalized,
        default_template_id: resolvedDefaultId,
      });
      setTemplates(normalizeReceiptTemplates(response.settings.templates));
      setDefaultTemplateId(response.settings.default_template_id);
    } catch (err: unknown) {
      setError(
        formatAuthError(
          err,
          t("settings.receiptTemplates.errors.save", "Failed to save receipt templates"),
        ),
      );
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const openCreateNakladnaya = () => {
    if (!canManageSettings) return;
    setEditor({
      template: createNakladnayaTemplate(companyName),
      isNew: true,
    });
  };

  const openCreate = (format: ReceiptFormat, engine: ReceiptTemplateEngine = "builtin") => {
    if (!canManageSettings) return;
    setEditor({
      template: createReceiptTemplate(format, companyName, engine),
      isNew: true,
    });
  };

  const openEdit = (template: ReceiptTemplate) => {
    if (!canManageSettings) return;
    setEditor({
      template: cloneReceiptTemplate(template),
      isNew: false,
    });
  };

  const handleSaveEditor = async (template: ReceiptTemplate) => {
    const nextTemplates = editor?.isNew
      ? [...templates, template]
      : templates.map((item) => (item.id === template.id ? template : item));

    try {
      await persistTemplates(nextTemplates, defaultTemplateId);
      setEditor(null);
    } catch {
      // Error shown via state.
    }
  };

  const handleDelete = async (templateId: string) => {
    const nextTemplates = templates.filter((template) => template.id !== templateId);
    const nextDefaultId =
      defaultTemplateId === templateId ? (nextTemplates[0]?.id ?? null) : defaultTemplateId;
    await persistTemplates(nextTemplates, nextDefaultId);
  };

  const handleSetDefault = async (templateId: string) => {
    await persistTemplates(templates, templateId);
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!canManageSettings) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const imported = parseImportedReceiptTemplate(parsed, companyName);
      setEditor({ template: imported, isNew: true });
      setError("");
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : t("settings.receiptTemplates.errors.import", "Failed to import template"),
      );
    }
  };

  const formatLabel = (template: ReceiptTemplate) => {
    const format =
      template.format === "a4"
        ? t("settings.receiptTemplates.formatA4", "A4 invoice")
        : t("settings.receiptTemplates.format80mm", "80mm receipt");
    const engine =
      template.engine === "html"
        ? t("settings.receiptTemplates.engineHtml", "Custom HTML")
        : t("settings.receiptTemplates.engineBuiltin", "Built-in layout");
    return `${format} · ${engine}`;
  };

  return (
    <div className={pageStyles.page}>
      <Link to="/settings" className={styles.backLink}>
        <ArrowLeft size={16} />
        {t("settings.receiptTemplates.backToSettings", "Back to settings")}
      </Link>

      <header className={pageStyles.header}>
        <h1 className={pageStyles.title}>
          {t("settings.receiptTemplates.pageTitle", "Receipt templates")}
        </h1>
        <p className={pageStyles.subtitle}>
          {t(
            "settings.receiptTemplates.descExtendedHtml",
            "Configure built-in 80mm/A4 layouts or custom HTML templates. Import and export templates as JSON.",
          )}
        </p>
      </header>

      {!canManageSettings ? (
        <p className={pageStyles.note}>
          {t(
            "settings.receiptTemplates.readOnlyNotice",
            "You can preview templates here. Ask an administrator to edit receipt templates.",
          )}
        </p>
      ) : null}

      <section className={pageStyles.section}>
        <div className={styles.receiptTemplatesSection}>
          {canManageSettings ? (
            <div className={styles.toolbar}>
              <button
                type="button"
                className={pageStyles.btn}
                disabled={loading || saving}
                onClick={() => openCreate("80mm")}
              >
                {t("settings.receiptTemplates.new80mm", "New 80mm receipt")}
              </button>
              <button
                type="button"
                className={pageStyles.btnSecondary}
                disabled={loading || saving}
                onClick={() => openCreate("a4")}
              >
                {t("settings.receiptTemplates.newA4", "New A4 invoice")}
              </button>
              <button
                type="button"
                className={pageStyles.btnSecondary}
                disabled={loading || saving}
                onClick={openCreateNakladnaya}
              >
                {t("settings.receiptTemplates.newNakladnaya", "New HTML template (A4)")}
              </button>
              <button
                type="button"
                className={pageStyles.btnSecondary}
                disabled={loading || saving}
                onClick={() => openCreate("80mm", "html")}
              >
                {t("settings.receiptTemplates.newHtml80mm", "New HTML receipt")}
              </button>
              <button
                type="button"
                className={pageStyles.btnSecondary}
                disabled={loading || saving}
                onClick={() => importInputRef.current?.click()}
              >
                {t("settings.receiptTemplates.import", "Import template")}
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className={styles.hiddenFileInput}
                onChange={(event) => void handleImportFile(event)}
              />
            </div>
          ) : null}

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.templateList}>
            {loading && templates.length === 0 ? (
              <p className={pageStyles.note}>
                {t("settings.receiptTemplates.loading", "Loading templates…")}
              </p>
            ) : null}
            {templates.map((template) => (
              <div key={template.id} className={styles.templateRow}>
                <div className={styles.templateMain}>
                  <div className={styles.templateName}>
                    {template.name}
                    {template.is_default ? (
                      <span className={styles.defaultBadge}>
                        {t("settings.receiptTemplates.defaultBadge", "Default")}
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.templateMeta}>
                    {formatLabel(template)}
                    {template.header.company_name ? ` · ${template.header.company_name}` : ""}
                  </div>
                </div>
                <div className={styles.templateActions}>
                  {canManageSettings ? (
                    <>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        disabled={saving}
                        onClick={() => openEdit(template)}
                      >
                        {t("common.edit", "Edit")}
                      </button>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        disabled={saving}
                        onClick={() => downloadReceiptTemplateExport(template)}
                      >
                        {t("settings.receiptTemplates.export", "Export")}
                      </button>
                      {!template.is_default ? (
                        <button
                          type="button"
                          className={styles.actionBtn}
                          disabled={saving}
                          onClick={() => void handleSetDefault(template.id)}
                        >
                          {t("settings.receiptTemplates.setDefault", "Set default")}
                        </button>
                      ) : null}
                      {templates.length > 1 ? (
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                          disabled={saving}
                          onClick={() => void handleDelete(template.id)}
                        >
                          {t("common.delete", "Delete")}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={() => downloadReceiptTemplateExport(template)}
                    >
                      {t("settings.receiptTemplates.export", "Export")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ReceiptTemplateEditorModal
        open={editor !== null}
        template={editor?.template ?? null}
        isNew={editor?.isNew ?? false}
        onClose={() => setEditor(null)}
        onSave={(template) => void handleSaveEditor(template)}
      />
    </div>
  );
}
