import { useEffect, useState } from "react";
import {
  fetchReceiptTemplates,
  patchReceiptTemplates,
} from "@/lib/receipt-templates-api";
import {
  cloneReceiptTemplate,
  createReceiptTemplate,
  normalizeDefaultFlag,
} from "@/lib/receipt-template-utils";
import { formatAuthError } from "@/store/auth";
import type { ReceiptFormat, ReceiptTemplate } from "@/types/receipt-templates";
import { ReceiptTemplateEditorModal } from "./ReceiptTemplateEditorModal";
import styles from "./ReceiptTemplates.module.css";
import settingsStyles from "@/routes/settings.module.css";

type Props = {
  token: string;
  companyName: string;
};

type EditorState = {
  template: ReceiptTemplate;
  isNew: boolean;
} | null;

export function ReceiptTemplatesSection({ token, companyName }: Props) {
  const [templates, setTemplates] = useState<ReceiptTemplate[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);

  const loadTemplates = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchReceiptTemplates(token);
      setTemplates(response.settings.templates);
      setDefaultTemplateId(response.settings.default_template_id);
    } catch (err: unknown) {
      setError(formatAuthError(err, "Failed to load receipt templates"));
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
      setTemplates(response.settings.templates);
      setDefaultTemplateId(response.settings.default_template_id);
    } catch (err: unknown) {
      setError(formatAuthError(err, "Failed to save receipt templates"));
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const openCreate = (format: ReceiptFormat) => {
    setEditor({
      template: createReceiptTemplate(format, companyName),
      isNew: true,
    });
  };

  const openEdit = (template: ReceiptTemplate) => {
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

  return (
    <section className={settingsStyles.section}>
      <div className={settingsStyles.sectionHeader}>
        <div>
          <h2 className={settingsStyles.sectionTitle}>Receipt templates</h2>
          <p className={settingsStyles.sectionDesc}>
            Configure 80mm receipts and A4 invoices. Cashiers choose a template when
            printing after checkout; reprints use the company default.
          </p>
        </div>
      </div>

      <div className={styles.receiptTemplatesSection}>
        <div className={styles.toolbar}>
          <button
            type="button"
            className={settingsStyles.btn}
            disabled={loading || saving}
            onClick={() => openCreate("80mm")}
          >
            New 80mm receipt
          </button>
          <button
            type="button"
            className={settingsStyles.btnSecondary}
            disabled={loading || saving}
            onClick={() => openCreate("a4")}
          >
            New A4 invoice
          </button>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}

        <div className={styles.templateList}>
          {loading && templates.length === 0 ? (
            <p className={settingsStyles.note}>Loading templates…</p>
          ) : null}
          {templates.map((template) => (
            <div key={template.id} className={styles.templateRow}>
              <div className={styles.templateMain}>
                <div className={styles.templateName}>
                  {template.name}
                  {template.is_default ? (
                    <span className={styles.defaultBadge}>Default</span>
                  ) : null}
                </div>
                <div className={styles.templateMeta}>
                  {template.format === "a4" ? "A4 invoice" : "80mm receipt"}
                  {template.header.company_name
                    ? ` · ${template.header.company_name}`
                    : ""}
                </div>
              </div>
              <div className={styles.templateActions}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  disabled={saving}
                  onClick={() => openEdit(template)}
                >
                  Edit
                </button>
                {!template.is_default ? (
                  <button
                    type="button"
                    className={styles.actionBtn}
                    disabled={saving}
                    onClick={() => void handleSetDefault(template.id)}
                  >
                    Set default
                  </button>
                ) : null}
                {templates.length > 1 ? (
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                    disabled={saving}
                    onClick={() => void handleDelete(template.id)}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <ReceiptTemplateEditorModal
        open={editor !== null}
        template={editor?.template ?? null}
        isNew={editor?.isNew ?? false}
        onClose={() => setEditor(null)}
        onSave={(template) => void handleSaveEditor(template)}
      />
    </section>
  );
}
