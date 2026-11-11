import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  fetchLabelStations,
  fetchLabelTemplates,
  fetchMyLabelPrintSettings,
  patchMyLabelPrintSettings,
} from "@/lib/label-templates-api";
import { labelPrinterNames } from "@/lib/print-product-labels";
import { formatAuthError, useAuth } from "@/store/auth";
import type {
  LabelPrintService,
  LabelTemplate,
  UserLabelPrintMethod,
  UserLabelPrintSettings,
} from "@/types/label-templates";
import styles from "./Products.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (settings: UserLabelPrintSettings) => void;
};

function serviceLabel(service: LabelPrintService): string {
  if (service.name.trim().toLowerCase() === service.printer_name.trim().toLowerCase()) {
    return service.name;
  }
  return `${service.name} (${service.printer_name})`;
}

export function LabelPrintSettingsDialog({ open, onClose, onSaved }: Props) {
  const { t } = useLanguage();
  const token = useAuth((state) => state.accessToken);
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [services, setServices] = useState<LabelPrintService[]>([]);
  const [connectedPrinters, setConnectedPrinters] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [printerName, setPrinterName] = useState("");
  const [method, setMethod] = useState<UserLabelPrintMethod>("service");
  const [promptBeforePrint, setPromptBeforePrint] = useState(true);
  const [useWarehouseQuantity, setUseWarehouseQuantity] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void Promise.all([
      fetchLabelTemplates(token),
      fetchMyLabelPrintSettings(token),
      fetchLabelStations(token).catch(() => ({ stations: [] })),
    ])
      .then(([templatesResponse, settingsResponse, stationsResponse]) => {
        if (cancelled) return;
        const nextTemplates = templatesResponse.settings.templates;
        const nextServices = templatesResponse.settings.print.services ?? [];
        const settings = settingsResponse.settings;
        const savedPrinter = settings.printer_name?.trim() ?? "";
        setTemplates(nextTemplates);
        setServices(nextServices);
        setConnectedPrinters(labelPrinterNames(stationsResponse.stations));
        setTemplateId(settings.template_id ?? nextTemplates[0]?.id ?? "");
        setServiceId(settings.service_id ?? nextServices[0]?.id ?? "");
        setPrinterName(savedPrinter);
        setMethod(settings.method);
        setPromptBeforePrint(settings.prompt_before_print);
        setUseWarehouseQuantity(settings.use_warehouse_quantity);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(formatAuthError(err, t("settings.labelTemplates.errors.load", "Failed to load label templates")));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, t, token]);

  const printerOptions = useMemo(() => {
    const names = [...connectedPrinters];
    const saved = printerName.trim();
    if (saved && !names.some((name) => name.toLowerCase() === saved.toLowerCase())) {
      names.unshift(saved);
    }
    return names;
  }, [connectedPrinters, printerName]);

  if (!open) return null;

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setError("");
    try {
      const response = await patchMyLabelPrintSettings(token, {
        template_id: templateId || null,
        service_id: serviceId || null,
        printer_name: printerName.trim() || null,
        method,
        prompt_before_print: promptBeforePrint,
        use_warehouse_quantity: useWarehouseQuantity,
      });
      onSaved(response.settings);
      onClose();
    } catch (err: unknown) {
      setError(formatAuthError(err, t("products.errors.settings", "Failed to save print settings")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={t("products.settingsTitle", "Print settings")}
      onClose={onClose}
      elevated
    >
      <div className={styles.dialogFields}>
        {loading ? <p className={styles.hint}>{t("common.loading", "Loading...")}</p> : null}
        <label className={styles.field}>
          <span className={styles.label}>{t("products.defaultTemplate", "Default template")}</span>
          <select
            className={styles.select}
            value={templateId}
            disabled={loading || saving || templates.length === 0}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
        {templates.length === 0 && !loading ? (
          <p className={styles.hint}>{t("products.noTemplates", "No label template is configured.")}</p>
        ) : null}
        <label className={styles.field}>
          <span className={styles.label}>{t("products.service", "Print service")}</span>
          <select
            className={styles.select}
            value={serviceId}
            disabled={loading || saving || services.length === 0}
            onChange={(event) => setServiceId(event.target.value)}
          >
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {serviceLabel(service)}
              </option>
            ))}
          </select>
        </label>
        {services.length === 0 && !loading ? (
          <p className={styles.hint}>{t("products.noServices", "No print service is configured.")}</p>
        ) : null}
        <label className={styles.field}>
          <span className={styles.label}>{t("products.defaultPrinter", "Default printer")}</span>
          <select
            className={styles.select}
            value={printerName}
            disabled={loading || saving}
            onChange={(event) => setPrinterName(event.target.value)}
          >
            <option value="">{t("products.noPrinterPreference", "No preference")}</option>
            {printerOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {printerOptions.length === 0 && !loading ? (
          <p className={styles.hint}>
            {t(
              "products.noConnectedPrinters",
              "No connected label printers. Connect Print Service to choose a default.",
            )}
          </p>
        ) : null}
        <label className={styles.field}>
          <span className={styles.label}>{t("products.printMethod", "Printing method")}</span>
          <select
            className={styles.select}
            value={method}
            disabled={loading || saving}
            onChange={(event) => setMethod(event.target.value as UserLabelPrintMethod)}
          >
            <option value="service">{t("products.printMethodService", "Print Service")}</option>
            <option value="browser">{t("products.printMethodBrowser", "Browser")}</option>
          </select>
        </label>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={promptBeforePrint}
            disabled={loading || saving}
            onChange={(event) => setPromptBeforePrint(event.target.checked)}
          />
          <span>
            <span className={styles.label}>
              {t("products.promptBeforePrint", "Open print settings before printing")}
            </span>
            <p className={styles.hint}>
              {t(
                "products.promptBeforePrintDesc",
                "Show the Print settings window before each print.",
              )}
            </p>
          </span>
        </label>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={useWarehouseQuantity}
            disabled={loading || saving}
            onChange={(event) => setUseWarehouseQuantity(event.target.checked)}
          />
          <span>
            <span className={styles.label}>
              {t("products.useWarehouseQuantity", "Print by warehouse quantity")}
            </span>
            <p className={styles.hint}>
              {t(
                "products.useWarehouseQuantityDesc",
                "Print one label per unit in stock for the selected warehouse.",
              )}
            </p>
          </span>
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.dialogActions}>
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button type="button" disabled={loading || saving} onClick={() => void save()}>
            {saving ? t("common.saving", "Saving…") : t("common.save", "Save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
