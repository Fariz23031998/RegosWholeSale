import { useEffect, useState } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { PrintAreaPortal } from "@/components/Receipt/PrintAreaPortal";
import { useLanguage } from "@/contexts/LanguageContext";
import { fetchLabelStations, fetchLabelTemplates } from "@/lib/label-templates-api";
import {
  labelPrinterNames,
  printLabelsWithService,
  renderLabelsInBrowser,
  stationsForPrinter,
  ChooseLabelPrinterError,
  NoLabelQuantityError,
  RenderLabelError,
} from "@/lib/print-product-labels";
import { formatAuthError, useAuth } from "@/store/auth";
import type { LabelPrintService, LabelStation, LabelTemplate, UserLabelPrintMethod } from "@/types/label-templates";
import styles from "./Products.module.css";

type Props = {
  open: boolean;
  productIds: number[];
  warehouseId?: number;
  priceTypeId?: number;
  preferenceTemplateId?: string | null;
  preferenceServiceId?: string | null;
  preferencePrinterName?: string | null;
  preferenceMethod?: UserLabelPrintMethod;
  preferenceUseWarehouseQuantity?: boolean;
  /** When set, each product uses its own copy count instead of the global copies field. */
  copiesByProductId?: Record<number, number>;
  onClose: () => void;
};

export function LabelPrintDialog({
  open,
  productIds,
  warehouseId,
  priceTypeId,
  preferenceTemplateId,
  preferenceServiceId,
  preferencePrinterName,
  preferenceMethod = "service",
  preferenceUseWarehouseQuantity = false,
  copiesByProductId,
  onClose,
}: Props) {
  const usePerProductCopies = Boolean(copiesByProductId) && !preferenceUseWarehouseQuantity;
  const { t } = useLanguage();
  const token = useAuth((state) => state.accessToken);
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [services, setServices] = useState<LabelPrintService[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [copies, setCopies] = useState(1);
  const [stations, setStations] = useState<LabelStation[]>([]);
  const [stationId, setStationId] = useState("");
  const [printerOverride, setPrinterOverride] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"service" | "browser" | null>(null);
  const [printHtml, setPrintHtml] = useState("");

  useEffect(() => {
    if (!open || !token) return;
    setError("");
    setPrintHtml("");
    void fetchLabelTemplates(token)
      .then((response) => {
        const nextServices = response.settings.print.services ?? [];
        const preferredService = nextServices.find((service) => service.id === preferenceServiceId);
        const defaultService =
          preferredService ?? nextServices.find((service) => service.is_default) ?? nextServices[0];
        const preferredTemplate = response.settings.templates.find(
          (template) => template.id === preferenceTemplateId,
        );
        setTemplates(response.settings.templates);
        setTemplateId(
          preferredTemplate?.id ??
            response.settings.default_template_id ??
            response.settings.templates[0]?.id ??
            "",
        );
        setServices(nextServices);
        setServiceId(defaultService?.id ?? "");
      })
      .catch((err: unknown) => {
        setError(formatAuthError(err, t("products.errors.print", "Failed to print labels")));
      });
    void fetchLabelStations(token)
      .then((response) => {
        setStations(response.stations);
        setStationId("");
        setPrinterOverride(preferencePrinterName?.trim() ?? "");
      })
      .catch(() => {
        setStations([]);
        setPrinterOverride(preferencePrinterName?.trim() ?? "");
      });
  }, [open, preferencePrinterName, preferenceServiceId, preferenceTemplateId, t, token]);

  useEffect(() => {
    if (!printHtml) return;
    const timer = window.setTimeout(() => window.print(), 50);
    return () => window.clearTimeout(timer);
  }, [printHtml]);

  if (!open) return null;

  const selectedService =
    services.find((service) => service.id === serviceId) ??
    services.find((service) => service.is_default) ??
    services[0];
  const selectedPrinterName = selectedService?.printer_name ?? "";
  const matchingStations = stationsForPrinter(stations, selectedPrinterName);
  const connectedLabelNames = labelPrinterNames(stations);
  const matchedPrinter = matchingStations.length > 0;
  const printerOptions = (() => {
    const names = [...connectedLabelNames];
    const preferred = printerOverride.trim() || preferencePrinterName?.trim() || "";
    if (preferred && !names.some((name) => name.toLowerCase() === preferred.toLowerCase())) {
      names.unshift(preferred);
    }
    return names;
  })();

  const target = {
    templateId,
    productIds,
    copies: preferenceUseWarehouseQuantity || usePerProductCopies ? 1 : copies,
    warehouseId,
    priceTypeId,
    useWarehouseQuantity: preferenceUseWarehouseQuantity,
    copiesByProductId: usePerProductCopies ? copiesByProductId : undefined,
  };

  const printWithService = async () => {
    if (!token) return;
    setBusy("service");
    setError("");
    try {
      await printLabelsWithService(token, {
        ...target,
        printerName: selectedPrinterName,
        stationId,
        printerOverride,
        stations,
      });
      onClose();
    } catch (err: unknown) {
      if (err instanceof ChooseLabelPrinterError) {
        setError(t("products.choosePrinter", "Choose a connected label printer."));
        return;
      }
      if (err instanceof NoLabelQuantityError) {
        setError(
          t(
            "products.errors.noQuantity",
            "No labels to print for the selected warehouse quantity.",
          ),
        );
        return;
      }
      if (err instanceof RenderLabelError) {
        setError(t("products.errors.render", "Failed to prepare labels"));
        return;
      }
      setError(
        formatAuthError(
          err,
          t(
            "products.noStation",
            "No label printer is connected. Jobs stay queued until the Print Service connects, or print in the browser.",
          ),
        ),
      );
    } finally {
      setBusy(null);
    }
  };

  const printInBrowser = async () => {
    if (!token) return;
    setBusy("browser");
    setError("");
    try {
      setPrintHtml(await renderLabelsInBrowser(token, target));
    } catch (err: unknown) {
      if (err instanceof NoLabelQuantityError) {
        setError(
          t(
            "products.errors.noQuantity",
            "No labels to print for the selected warehouse quantity.",
          ),
        );
        return;
      }
      setError(
        err instanceof RenderLabelError
          ? t("products.errors.render", "Failed to prepare labels")
          : formatAuthError(err, t("products.errors.render", "Failed to prepare labels")),
      );
    } finally {
      setBusy(null);
    }
  };

  const serviceButton = (
    <Button
      key="service"
      type="button"
      variant={preferenceMethod === "browser" ? "secondary" : "primary"}
      disabled={busy != null || productIds.length === 0}
      onClick={() => void printWithService()}
    >
      {t("products.printService", "Print service")}
    </Button>
  );
  const browserButton = (
    <Button
      key="browser"
      type="button"
      variant={preferenceMethod === "browser" ? "primary" : "secondary"}
      disabled={busy != null || productIds.length === 0}
      onClick={() => void printInBrowser()}
    >
      {t("products.printBrowser", "Print in browser")}
    </Button>
  );

  return (
    <>
      <Modal
        open
        title={t("products.printTitle", "Print labels")}
        onClose={onClose}
        elevated
      >
        <div className={styles.dialogFields}>
          <label className={styles.field}>
            <span className={styles.label}>{t("products.template", "Template")}</span>
            <select
              className={styles.select}
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          {services.length > 1 ? (
            <label className={styles.field}>
              <span className={styles.label}>{t("products.service", "Print service")}</span>
              <select
                className={styles.select}
                value={selectedService?.id ?? ""}
                onChange={(event) => {
                  setServiceId(event.target.value);
                  setStationId("");
                  setPrinterOverride(preferencePrinterName?.trim() ?? "");
                }}
              >
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {usePerProductCopies ? (
            <p className={styles.hint}>
              {t(
                "products.perProductCopiesHint",
                "Label counts are set per product in the selected list.",
              )}
            </p>
          ) : (
            <label className={styles.field}>
              <span className={styles.label}>{t("products.copies", "Copies")}</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={99}
                value={copies}
                disabled={preferenceUseWarehouseQuantity}
                onChange={(event) =>
                  setCopies(Math.min(99, Math.max(1, Number(event.target.value) || 1)))
                }
              />
              {preferenceUseWarehouseQuantity ? (
                <p className={styles.hint}>
                  {t(
                    "products.useWarehouseQuantityDesc",
                    "Print one label per unit in stock for the selected warehouse.",
                  )}
                </p>
              ) : null}
            </label>
          )}
          {matchingStations.length > 1 ? (
            <label className={styles.field}>
              <span className={styles.label}>{t("products.station", "Station")}</span>
              <select
                className={styles.select}
                value={stationId}
                onChange={(event) => setStationId(event.target.value)}
              >
                <option value="">{t("products.allStations", "All matching stations")}</option>
                {matchingStations.map((station) => (
                  <option key={station.station_id} value={station.station_id}>
                    {station.station_name || station.station_id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!matchedPrinter && printerOptions.length > 1 ? (
            <label className={styles.field}>
              <span className={styles.label}>{t("products.printer", "Printer")}</span>
              <select
                className={styles.select}
                value={printerOverride}
                onChange={(event) => setPrinterOverride(event.target.value)}
              >
                <option value="">{t("products.choosePrinter", "Choose a connected label printer.")}</option>
                {printerOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!matchedPrinter && connectedLabelNames.length === 1 ? (
            <p className={styles.hint}>
              {t("products.connectedPrinter", "Print service is connected. Labels print on {{name}}.", {
                name: connectedLabelNames[0],
              })}
            </p>
          ) : null}
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.dialogActions}>
            {preferenceMethod === "browser" ? (
              <>
                {browserButton}
                {serviceButton}
              </>
            ) : (
              <>
                {serviceButton}
                {browserButton}
              </>
            )}
          </div>
        </div>
      </Modal>
      <PrintAreaPortal active={Boolean(printHtml)}>
        <div dangerouslySetInnerHTML={{ __html: printHtml }} />
      </PrintAreaPortal>
    </>
  );
}
