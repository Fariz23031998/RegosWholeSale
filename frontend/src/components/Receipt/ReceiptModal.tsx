import { useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { useReceiptTemplates } from "@/hooks/use-receipt-templates";
import { useReceiptShareSession } from "@/hooks/use-receipt-share-session";
import type { ReceiptPrintContext } from "@/lib/receipt-print-context";
import { fetchPartnerDebt } from "@/lib/partners-api";
import type { PartnerDebtLine } from "@/types/partners";
import { formatAuthError, useAuth } from "@/store/auth";
import {
  fetchDocumentStations,
  fetchMyDocumentPrintSettings,
} from "@/lib/documents-api";
import { fetchReceiptTemplates } from "@/lib/receipt-templates-api";
import {
  ChooseReceiptPrinterError,
  printReceiptWithService,
  receiptPrinterNames,
  RenderReceiptError,
  stationsForReceiptPrinter,
} from "@/lib/print-receipt";
import type {
  DocumentStation,
  ReceiptPrintService,
  UserDocumentPrintMethod,
} from "@/types/receipt-templates";
import { ReceiptTemplatePicker } from "./ReceiptTemplatePicker";
import { PrintAreaPortal } from "./PrintAreaPortal";
import { ReceiptSharePanel } from "./ReceiptSharePanel";
import {
  resolveDefaultTemplate,
  TemplatedReceiptView,
} from "./TemplatedReceiptView";
import styles from "./Receipt.module.css";

type Props = {
  context: ReceiptPrintContext | null;
  onClose: () => void;
  title?: string;
  closeLabel?: string;
};

function serviceLabel(service: ReceiptPrintService): string {
  return service.name.trim() || service.printer_name;
}

export function ReceiptModal({
  context,
  onClose,
  title,
  closeLabel,
}: Props) {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const companyId = useAuth((s) => s.user?.company_id);
  const { templates, defaultTemplateId } = useReceiptTemplates(token, companyId);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [preferredTemplateId, setPreferredTemplateId] = useState<string | null>(
    null,
  );
  const printRootRef = useRef<HTMLDivElement>(null);

  const [services, setServices] = useState<ReceiptPrintService[]>([]);
  const [preferredServiceId, setPreferredServiceId] = useState<string | null>(
    null,
  );
  const [stations, setStations] = useState<DocumentStation[]>([]);
  const [stationId, setStationId] = useState("");
  const [printerOverride, setPrinterOverride] = useState("");
  const [preferenceMethod, setPreferenceMethod] =
    useState<UserDocumentPrintMethod>("service");
  const [busy, setBusy] = useState<"service" | "browser" | null>(null);
  const [printError, setPrintError] = useState("");

  useEffect(() => {
    if (!context) return;
    const preferred = preferredTemplateId
      ? templates.find((template) => template.id === preferredTemplateId)
      : null;
    const fallback =
      preferred ?? resolveDefaultTemplate(templates, defaultTemplateId);
    setSelectedTemplateId(fallback?.id ?? "");
  }, [context, defaultTemplateId, preferredTemplateId, templates]);

  useEffect(() => {
    if (!context || !token) return;
    setPrintError("");
    void Promise.all([
      fetchReceiptTemplates(token).catch(() => null),
      fetchDocumentStations(token).catch(() => ({
        stations: [] as DocumentStation[],
        printer_name: "",
      })),
      fetchMyDocumentPrintSettings(token).catch(() => null),
    ]).then(([templatesResponse, stationsResponse, prefs]) => {
      const nextServices = templatesResponse?.settings.print?.services ?? [];
      setServices(nextServices);
      setStations(stationsResponse.stations);
      setStationId("");
      if (prefs) {
        setPreferenceMethod(prefs.settings.method ?? "service");
        setPreferredServiceId(prefs.settings.service_id);
        setPreferredTemplateId(prefs.settings.template_id);
        setPrinterOverride(prefs.settings.printer_name?.trim() ?? "");
      } else {
        setPreferenceMethod("service");
        setPreferredServiceId(null);
      }
    });
  }, [context, token]);

  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ??
    resolveDefaultTemplate(templates, defaultTemplateId);

  const selectedService =
    (preferredServiceId
      ? services.find((service) => service.id === preferredServiceId)
      : null) ??
    services.find((service) => service.is_default) ??
    services[0];
  const configuredPrinterName = selectedService?.printer_name ?? "";
  const matchingStations = stationsForReceiptPrinter(stations, configuredPrinterName);
  const connectedReceiptNames = receiptPrinterNames(stations);
  const matchedPrinter = matchingStations.length > 0;
  const printerOptions = connectedReceiptNames;

  const debtEnabled = Boolean(selectedTemplate?.partner_debt_enabled);
  const partnerId = context?.document.partner_id ?? null;
  const [debtLines, setDebtLines] = useState<PartnerDebtLine[] | null>(null);

  useEffect(() => {
    if (!token || !debtEnabled || !partnerId) {
      setDebtLines(null);
      return;
    }
    let cancelled = false;
    setDebtLines(null);
    void fetchPartnerDebt(token, partnerId)
      .then((response) => {
        if (!cancelled) setDebtLines(response.lines);
      })
      .catch(() => {
        if (!cancelled) setDebtLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, debtEnabled, partnerId]);

  const printContext = useMemo(() => {
    if (!context) return null;
    if (!debtEnabled) return context;
    return { ...context, partner_balances: debtLines ?? [] };
  }, [context, debtEnabled, debtLines]);

  const shareSession = useReceiptShareSession({
    accessToken: token,
    template: selectedTemplate,
    context: printContext,
    documentCode: context?.sale.id ?? context?.document_code ?? "receipt",
    templateName: selectedTemplate?.name ?? "",
    uploadErrorMessage: t(
      "receipt.share.errors.upload",
      "Failed to create share link.",
    ),
  });

  if (!context || !printContext) return null;

  const sale = context.sale;
  const closedWithoutPayment =
    (sale.amountPaid ?? 0) <= 0 && (sale.balanceDue ?? 0) > 0;

  const modalTitle =
    title ??
    (closedWithoutPayment
      ? t("receipt.closedWithoutPayment", "Closed without payment")
      : t("receipt.saleComplete", "Sale Complete"));

  const resolvedCloseLabel = closeLabel ?? t("common.done", "Done");
  const shareDisabled = !selectedTemplate || !token;
  const canPrint = Boolean(selectedTemplate) && busy == null;

  const printInBrowser = () => {
    setPrintError("");
    window.print();
  };

  const printWithService = async () => {
    if (!token || !selectedTemplate) return;
    setBusy("service");
    setPrintError("");
    try {
      await printReceiptWithService({
        token,
        template: selectedTemplate,
        context: printContext,
        printRoot: printRootRef.current,
        printerName: configuredPrinterName,
        stationId,
        printerOverride,
        stations,
      });
    } catch (err: unknown) {
      if (err instanceof ChooseReceiptPrinterError) {
        setPrintError(
          t("receipt.choosePrinter", "Choose a connected receipt printer."),
        );
      } else if (err instanceof RenderReceiptError) {
        setPrintError(
          t("receipt.errors.render", "Failed to prepare the document for printing."),
        );
      } else {
        setPrintError(
          formatAuthError(
            err,
            t("receipt.errors.printService", "Failed to print via Print Service."),
          ),
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const serviceButton = (
    <Button
      key="service"
      variant={preferenceMethod === "browser" ? "secondary" : "primary"}
      onClick={() => void printWithService()}
      disabled={!canPrint || !token}
    >
      <Printer size={16} /> {t("products.printService", "Print service")}
    </Button>
  );
  const browserButton = (
    <Button
      key="browser"
      variant={preferenceMethod === "browser" ? "primary" : "secondary"}
      onClick={printInBrowser}
      disabled={!canPrint}
    >
      <Printer size={16} /> {t("products.printBrowser", "Print in browser")}
    </Button>
  );

  return (
    <>
      <Modal
        open={!!context}
        onClose={onClose}
        title={modalTitle}
        size="lg"
        overlayClassName={styles.receiptOverlay}
        modalClassName={styles.receiptModal}
        bodyClassName={styles.receiptModalBody}
      >
        <ReceiptTemplatePicker
          templates={templates}
          value={selectedTemplateId}
          onChange={setSelectedTemplateId}
        />

        <div className={styles.receiptLayout}>
          <div className={styles.receiptShareColumn}>
            <ReceiptSharePanel
              disabled={shareDisabled}
              session={shareSession.session}
              linkExpired={shareSession.linkExpired}
              ensureShareUrl={shareSession.ensureShareUrl}
              onRegenerate={shareSession.reset}
            />
          </div>

          <div className={styles.receiptPreviewColumn}>
            <div className={styles.previewLarge}>
              {selectedTemplate ? (
                <div className={styles.previewScroll}>
                  <TemplatedReceiptView
                    template={selectedTemplate}
                    context={printContext}
                    className={styles.previewReceipt}
                    preview
                  />
                </div>
              ) : (
                <div className={styles.templatePickerLabel}>
                  {t("receipt.noTemplates", "Receipt templates are not available.")}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={styles.printControls}>
          {services.length > 1 ? (
            <label className={styles.printField}>
              <span className={styles.printLabel}>
                {t("products.service", "Print service")}
              </span>
              <select
                className={styles.printSelect}
                value={selectedService?.id ?? ""}
                onChange={(event) => {
                  setPreferredServiceId(event.target.value || null);
                  setStationId("");
                }}
              >
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {serviceLabel(service)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {matchingStations.length > 1 ? (
            <label className={styles.printField}>
              <span className={styles.printLabel}>
                {t("products.station", "Station")}
              </span>
              <select
                className={styles.printSelect}
                value={stationId}
                onChange={(event) => setStationId(event.target.value)}
              >
                <option value="">
                  {t("products.allStations", "All matching stations")}
                </option>
                {matchingStations.map((station) => (
                  <option key={station.station_id} value={station.station_id}>
                    {station.station_name || station.station_id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!matchedPrinter && printerOptions.length > 1 ? (
            <label className={styles.printField}>
              <span className={styles.printLabel}>
                {t("products.printer", "Printer")}
              </span>
              <select
                className={styles.printSelect}
                value={printerOverride}
                onChange={(event) => setPrinterOverride(event.target.value)}
              >
                <option value="">
                  {t("receipt.choosePrinter", "Choose a connected receipt printer.")}
                </option>
                {printerOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!matchedPrinter && connectedReceiptNames.length === 1 ? (
            <p className={styles.printHint}>
              {t(
                "receipt.connectedPrinter",
                "Print service is connected. Documents print on {{name}}.",
                { name: connectedReceiptNames[0] },
              )}
            </p>
          ) : null}
          {services.length === 0 ? (
            <p className={styles.printHint}>
              {t(
                "receipt.noPrintServices",
                "No receipt print service is configured. You can still print in the browser.",
              )}
            </p>
          ) : null}
          {printError ? <p className={styles.printError}>{printError}</p> : null}
        </div>

        <div className={styles.footerActions}>
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
          <Button onClick={onClose}>{resolvedCloseLabel}</Button>
        </div>
      </Modal>

      <PrintAreaPortal active={Boolean(selectedTemplate)} ref={printRootRef}>
        {selectedTemplate ? (
          <TemplatedReceiptView template={selectedTemplate} context={printContext} />
        ) : null}
      </PrintAreaPortal>
    </>
  );
}
