import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  createLabelTemplate,
  fetchLabelStations,
  fetchLabelTemplates,
  patchLabelPrintSettings,
  patchLabelTemplates,
  printGatewayUrl,
  printerNamesMatch,
} from "@/lib/label-templates-api";
import { subscribeSettingsEvents } from "@/lib/settings-events";
import { formatAuthError, useAuth } from "@/store/auth";
import { normalizeReceiptTemplateLogos } from "@/lib/receipt-template-logos";
import type { LabelPrintService, LabelStation, LabelTemplate } from "@/types/label-templates";
import { Modal } from "@/components/posui/Modal";
import { LabelTemplateEditorModal } from "./LabelTemplateEditorModal";
import styles from "./ReceiptTemplates.module.css";
import pageStyles from "@/routes/settings.module.css";

type EditorState = {
  template: LabelTemplate;
  isNew: boolean;
} | null;

type PageTab = "printer" | "templates";

function matchedServiceNames(station: LabelStation, services: LabelPrintService[]): string[] {
  return services
    .filter((service) =>
      station.printers.some(
        (printer) =>
          printer.enabled &&
          printer.kind === "label" &&
          printerNamesMatch(printer.name, service.printer_name),
      ),
    )
    .map((service) => service.name);
}

async function writeClipboardText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission or insecure origin. Fall back to a selected textarea.
  }

  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "true");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

function withSingleDefault(templates: LabelTemplate[], defaultId: string | null): LabelTemplate[] {
  const resolved = defaultId && templates.some((item) => item.id === defaultId)
    ? defaultId
    : (templates[0]?.id ?? null);
  return templates.map((item) => ({ ...item, is_default: item.id === resolved }));
}

export function LabelTemplatesPage() {
  const { t } = useLanguage();
  const token = useAuth((state) => state.accessToken);
  const user = useAuth((state) => state.user);
  const canManageSettings = Boolean(user?.permissions.includes("settings.manage"));
  const [pageTab, setPageTab] = useState<PageTab>("printer");
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [services, setServices] = useState<LabelPrintService[]>([]);
  const [serviceName, setServiceName] = useState("");
  const [servicePrinterName, setServicePrinterName] = useState("");
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [gatewayToken, setGatewayToken] = useState("");
  const [stations, setStations] = useState<LabelStation[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const loadRef = useRef<() => Promise<void>>(async () => undefined);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetchLabelTemplates(token);
      setTemplates(
        response.settings.templates.map((item) => ({
          ...item,
          logos: Array.isArray(item.logos) ? item.logos : [],
        })),
      );
      setDefaultTemplateId(response.settings.default_template_id);
      setServices(response.settings.print.services ?? []);
      setGatewayToken(response.settings.print.token);
      const stationResponse = await fetchLabelStations(token);
      setStations(stationResponse.stations);
    } catch (err: unknown) {
      setError(
        formatAuthError(err, t("settings.labelTemplates.errors.load", "Failed to load label templates")),
      );
    } finally {
      setLoading(false);
    }
  };

  loadRef.current = load;

  useEffect(() => {
    void load();
  }, [token]);

  useEffect(() => {
    return subscribeSettingsEvents((event) => {
      if (event.scope !== "company") return;
      if (event.namespace !== "label_templates" && event.namespace !== "label_print") return;
      void loadRef.current();
    });
  }, []);

  const persistTemplates = async (nextTemplates: LabelTemplate[], nextDefaultId: string | null) => {
    if (!token || !canManageSettings) return;
    setSaving(true);
    setError("");
    try {
      const normalized = withSingleDefault(nextTemplates, nextDefaultId);
      const resolvedDefaultId = normalized.find((item) => item.is_default)?.id ?? null;
      const response = await patchLabelTemplates(token, {
        templates: normalized,
        default_template_id: resolvedDefaultId,
      });
      setTemplates(response.settings.templates);
      setDefaultTemplateId(response.settings.default_template_id);
    } catch (err: unknown) {
      setError(
        formatAuthError(err, t("settings.labelTemplates.errors.save", "Failed to save label templates")),
      );
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const persistServices = async (next: LabelPrintService[], regenerate = false) => {
    if (!token || !canManageSettings) return false;
    setSaving(true);
    setError("");
    try {
      const response = await patchLabelPrintSettings(token, {
        services: next,
        regenerate_token: regenerate,
      });
      setServices(response.settings.print.services ?? []);
      setGatewayToken(response.settings.print.token);
      return true;
    } catch (err: unknown) {
      setError(
        formatAuthError(err, t("settings.labelTemplates.errors.save", "Failed to save label templates")),
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const resetServiceForm = () => {
    setServiceName("");
    setServicePrinterName("");
    setEditingServiceId(null);
    setServiceModalOpen(false);
  };

  const saveService = async () => {
    const name = serviceName.trim();
    const printerName = servicePrinterName.trim();
    if (!name || !printerName) return;
    const next = editingServiceId
      ? services.map((service) =>
          service.id === editingServiceId
            ? { ...service, name, printer_name: printerName }
            : service,
        )
      : [
          ...services,
          {
            id: crypto.randomUUID(),
            name,
            printer_name: printerName,
            is_default: services.length === 0,
          },
        ];
    const saved = await persistServices(next);
    if (!saved) return;
    resetServiceForm();
  };

  const openNewService = () => {
    setEditingServiceId(null);
    setServiceName("");
    setServicePrinterName("");
    setServiceModalOpen(true);
  };

  const openEditService = (service: LabelPrintService) => {
    setEditingServiceId(service.id);
    setServiceName(service.name);
    setServicePrinterName(service.printer_name);
    setServiceModalOpen(true);
  };

  const copyText = async (value: string, key: string) => {
    if (!value) {
      setCopied("");
      setError(t("settings.labelTemplates.errors.copy", "Nothing to copy yet."));
      return;
    }
    const ok = await writeClipboardText(value);
    if (!ok) {
      setCopied("");
      setError(t("settings.labelTemplates.errors.copy", "Could not copy. Select the field and press Ctrl+C."));
      return;
    }
    setError("");
    setCopied(key);
    window.setTimeout(() => {
      setCopied((current) => (current === key ? "" : current));
    }, 2000);
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canManageSettings) return;
    try {
      const parsed = JSON.parse(await file.text()) as { template?: LabelTemplate };
      const imported = parsed.template;
      if (!imported || typeof imported.html !== "string" || typeof imported.name !== "string") {
        throw new Error(t("settings.labelTemplates.errors.import", "Failed to import template"));
      }
      setEditor({
        template: {
          ...createLabelTemplate(),
          ...imported,
          id: crypto.randomUUID(),
          is_default: false,
          version: 1,
          css: typeof imported.css === "string" ? imported.css : "",
          logos: normalizeReceiptTemplateLogos(imported.logos),
          paper: {
            width_mm: Number(imported.paper?.width_mm) || 58,
            height_mm: Number(imported.paper?.height_mm) || 40,
          },
        },
        isNew: true,
      });
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : t("settings.labelTemplates.errors.import", "Failed to import template"),
      );
    }
  };

  const gatewayUrl = printGatewayUrl();

  return (
    <div className={pageStyles.page}>
      <Link to="/settings" className={styles.backLink}>
        <ArrowLeft size={16} />
        {t("settings.labelTemplates.backToSettings", "Back to settings")}
      </Link>
      <header className={pageStyles.header}>
        <h1 className={pageStyles.title}>
          {t("settings.labelTemplates.pageTitle", "Product label templates")}
        </h1>
        <p className={pageStyles.subtitle}>
          {t(
            "settings.labelTemplates.description",
            "HTML templates for product labels printed by the Print Service or the browser.",
          )}
        </p>
      </header>

      {error ? <p className={pageStyles.note}>{error}</p> : null}

      <div className={`${styles.editorTabs} ${styles.pageTabs}`} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={pageTab === "printer"}
          className={`${styles.editorTab} ${pageTab === "printer" ? styles.editorTabActive : ""}`}
          onClick={() => setPageTab("printer")}
        >
          {t("settings.labelTemplates.tabPrinter", "Printer")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pageTab === "templates"}
          className={`${styles.editorTab} ${pageTab === "templates" ? styles.editorTabActive : ""}`}
          onClick={() => setPageTab("templates")}
        >
          {t("settings.labelTemplates.tabTemplates", "Templates")}
        </button>
      </div>

      {pageTab === "printer" ? (
      <section className={pageStyles.section}>
        <div className={styles.serviceSectionHead}>
          <h2 className={pageStyles.sectionTitle}>
            {t("settings.labelTemplates.services", "Print services")}
          </h2>
          {canManageSettings ? (
            <button
              type="button"
              className={styles.compactBtn}
              disabled={saving}
              onClick={openNewService}
            >
              {t("settings.labelTemplates.addService", "Add print service")}
            </button>
          ) : null}
        </div>
        <p className={pageStyles.sectionDesc}>
          {t(
            "settings.labelTemplates.serviceHint",
            "Each print service uses the shared gateway token. The printer name must match a logical label printer in the Windows Print Service.",
          )}
        </p>
        {services.length === 0 ? (
          <p className={`${pageStyles.note} ${styles.serviceEmpty}`}>
            {t("settings.labelTemplates.noServices", "No print services yet.")}
          </p>
        ) : (
          <div className={styles.serviceTableWrap}>
            <table className={styles.serviceTable}>
              <thead>
                <tr>
                  <th scope="col">{t("settings.labelTemplates.serviceName", "Display name")}</th>
                  <th scope="col">{t("settings.labelTemplates.printerName", "Label printer name")}</th>
                  {canManageSettings ? <th scope="col" className={styles.serviceActionsCell} /> : null}
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id}>
                    <td>
                      <span className={styles.templateName}>
                        {service.name}
                        {service.is_default ? (
                          <span className={styles.defaultBadge}>
                            {t("settings.labelTemplates.default", "Default")}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td>{service.printer_name}</td>
                    {canManageSettings ? (
                      <td className={styles.serviceActionsCell}>
                        <div className={styles.templateActions}>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => openEditService(service)}
                          >
                            {t("settings.labelTemplates.edit", "Edit")}
                          </button>
                          {!service.is_default ? (
                            <button
                              type="button"
                              className={styles.actionBtn}
                              onClick={() =>
                                void persistServices(
                                  services.map((item) => ({ ...item, is_default: item.id === service.id })),
                                )
                              }
                            >
                              {t("settings.labelTemplates.setDefault", "Set default")}
                            </button>
                          ) : null}
                          {services.length > 1 ? (
                            <button
                              type="button"
                              className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                              onClick={() => {
                                const next = services.filter((item) => item.id !== service.id);
                                const hasDefault = next.some((item) => item.is_default);
                                void persistServices(
                                  hasDefault ? next : next.map((item, index) => ({ ...item, is_default: index === 0 })),
                                );
                                if (editingServiceId === service.id) resetServiceForm();
                              }}
                            >
                              {t("settings.labelTemplates.delete", "Delete")}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <label className={pageStyles.field}>
          <span className={pageStyles.label}>{t("settings.labelTemplates.gatewayUrl", "WebSocket URL")}</span>
          <input className={pageStyles.input} readOnly value={gatewayUrl} />
        </label>
        <label className={pageStyles.field}>
          <span className={pageStyles.label}>{t("settings.labelTemplates.token", "Gateway token")}</span>
          <input
            className={pageStyles.input}
            readOnly
            value={gatewayToken}
            style={{ userSelect: "text" }}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <p className={pageStyles.sectionDesc}>
          {t(
            "settings.labelTemplates.tokenHint",
            "Paste this token into the Print Service settings.",
          )}
        </p>
        <div className={styles.toolbar}>
          <button type="button" className={pageStyles.btnSecondary} onClick={() => void copyText(gatewayUrl, "url")}>
            {copied === "url"
              ? t("settings.labelTemplates.copied", "Copied")
              : t("settings.labelTemplates.copy", "Copy")}{" "}
            URL
          </button>
          <button type="button" className={pageStyles.btnSecondary} onClick={() => void copyText(gatewayToken, "token")}>
            {copied === "token"
              ? t("settings.labelTemplates.copied", "Copied")
              : t("settings.labelTemplates.copy", "Copy")}{" "}
            {t("settings.labelTemplates.token", "Gateway token")}
          </button>
          {canManageSettings ? (
            <button
              type="button"
              className={pageStyles.btnSecondary}
              disabled={saving}
              onClick={() => void persistServices(services, true)}
            >
              {t("settings.labelTemplates.regenerate", "Regenerate token")}
            </button>
          ) : null}
        </div>

        <h2 className={pageStyles.sectionTitle}>
          {t("settings.labelTemplates.stations", "Connected stations")}
        </h2>
        {stations.length === 0 ? (
          <p className={pageStyles.note}>
            {t("settings.labelTemplates.noStations", "No Print Service is connected.")}
          </p>
        ) : (
          <div className={styles.templateList}>
            {stations.map((station) => {
              const matched = matchedServiceNames(station, services);
              return (
              <div key={station.station_id} className={styles.templateRow}>
                <div>
                  <div className={styles.templateName}>
                    {station.station_name || station.station_id}
                  </div>
                  <div className={styles.templateMeta}>
                    {t("settings.labelTemplates.stationOnline", "Online")}
                    {station.printers.some((printer) => printer.enabled)
                      ? ` · ${station.printers
                          .filter((printer) => printer.enabled)
                          .map((printer) => printer.name)
                          .join(", ")}`
                      : ""}
                    {matched.length > 0
                      ? ` · ${t("settings.labelTemplates.stationMatches", "Matches {{names}}", {
                          names: matched.join(", "),
                        })}`
                      : ` · ${t(
                          "settings.labelTemplates.stationNoMatch",
                          "Does not match a saved print service",
                        )}`}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </section>
      ) : (
      <section className={pageStyles.section}>
        {canManageSettings ? (
          <div className={styles.toolbar}>
            <button
              type="button"
              className={pageStyles.btn}
              disabled={loading || saving}
              onClick={() => setEditor({ template: createLabelTemplate(), isNew: true })}
            >
              {t("settings.labelTemplates.new", "New template")}
            </button>
            <button
              type="button"
              className={pageStyles.btnSecondary}
              disabled={loading || saving}
              onClick={() => importInputRef.current?.click()}
            >
              {t("settings.labelTemplates.import", "Import")}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(event) => void handleImportFile(event)}
            />
          </div>
        ) : null}
        <div className={styles.templateList}>
          {templates.map((template) => (
            <div key={template.id} className={styles.templateRow}>
              <div className={styles.templateMain}>
                <div className={styles.templateName}>
                  {template.name}
                  {template.is_default ? (
                    <span className={styles.defaultBadge}>
                      {t("settings.labelTemplates.default", "Default")}
                    </span>
                  ) : null}
                </div>
                <div className={styles.templateMeta}>
                  {template.paper.width_mm}×{template.paper.height_mm} mm
                </div>
              </div>
              {canManageSettings ? (
                <div className={styles.templateActions}>
                  <button type="button" className={styles.actionBtn} onClick={() => setEditor({ template, isNew: false })}>
                    {t("settings.labelTemplates.edit", "Edit")}
                  </button>
                  {!template.is_default ? (
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={() => void persistTemplates(templates, template.id)}
                    >
                      {t("settings.labelTemplates.setDefault", "Set default")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => {
                      const blob = new Blob(
                        [JSON.stringify({ version: 1, template }, null, 2)],
                        { type: "application/json" },
                      );
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `${template.name || "label"}.json`;
                      link.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    {t("settings.labelTemplates.export", "Export")}
                  </button>
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                    onClick={() => {
                      const next = templates.filter((item) => item.id !== template.id);
                      const nextDefault =
                        defaultTemplateId === template.id ? (next[0]?.id ?? null) : defaultTemplateId;
                      void persistTemplates(next, nextDefault);
                    }}
                  >
                    {t("settings.labelTemplates.delete", "Delete")}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      )}

      <Modal
        open={serviceModalOpen}
        onClose={resetServiceForm}
        title={
          editingServiceId
            ? t("settings.labelTemplates.editService", "Edit print service")
            : t("settings.labelTemplates.newService", "New print service")
        }
      >
        <div className={pageStyles.formGrid}>
          <label className={pageStyles.field}>
            <span className={pageStyles.label}>
              {t("settings.labelTemplates.serviceName", "Display name")}
            </span>
            <input
              className={pageStyles.input}
              value={serviceName}
              disabled={saving}
              onChange={(event) => setServiceName(event.target.value)}
            />
          </label>
          <label className={pageStyles.field}>
            <span className={pageStyles.label}>
              {t("settings.labelTemplates.printerName", "Label printer name")}
            </span>
            <input
              className={pageStyles.input}
              value={servicePrinterName}
              disabled={saving}
              onChange={(event) => setServicePrinterName(event.target.value)}
            />
          </label>
          <div className={pageStyles.buttonRow}>
            <button
              type="button"
              className={pageStyles.btn}
              disabled={saving || !serviceName.trim() || !servicePrinterName.trim()}
              onClick={() => void saveService()}
            >
              {t("settings.labelTemplates.saveService", "Save")}
            </button>
            <button
              type="button"
              className={pageStyles.btnSecondary}
              disabled={saving}
              onClick={resetServiceForm}
            >
              {t("settings.labelTemplates.cancelEdit", "Cancel")}
            </button>
          </div>
        </div>
      </Modal>

      <LabelTemplateEditorModal
        open={editor != null}
        template={editor?.template ?? null}
        isNew={Boolean(editor?.isNew)}
        onClose={() => setEditor(null)}
        onSave={(saved) => {
          const next = editor?.isNew
            ? [...templates, saved]
            : templates.map((item) => (item.id === saved.id ? saved : item));
          void persistTemplates(next, defaultTemplateId).then(() => setEditor(null));
        }}
      />
    </div>
  );
}
