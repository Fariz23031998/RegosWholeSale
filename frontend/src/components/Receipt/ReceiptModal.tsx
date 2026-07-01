import { useCallback, useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { useReceiptTemplates } from "@/hooks/use-receipt-templates";
import { useReceiptShareSession } from "@/hooks/use-receipt-share-session";
import type { ReceiptPrintContext } from "@/lib/receipt-print-context";
import { useAuth } from "@/store/auth";
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

export function ReceiptModal({
  context,
  onClose,
  title,
  closeLabel,
}: Props) {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const { templates, defaultTemplateId } = useReceiptTemplates(token);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [printRoot, setPrintRoot] = useState<HTMLDivElement | null>(null);
  const printRootRef = useCallback((node: HTMLDivElement | null) => {
    setPrintRoot(node);
  }, []);

  useEffect(() => {
    if (!context) return;
    const fallback = resolveDefaultTemplate(templates, defaultTemplateId);
    setSelectedTemplateId(fallback?.id ?? "");
  }, [context, defaultTemplateId, templates]);

  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ??
    resolveDefaultTemplate(templates, defaultTemplateId);

  const shareSession = useReceiptShareSession({
    accessToken: token,
    printRoot,
    format: selectedTemplate?.format ?? null,
    documentCode: context?.sale.id ?? context?.document_code ?? "receipt",
    templateName: selectedTemplate?.name ?? "",
    generateErrorMessage: t(
      "receipt.share.errors.generate",
      "Could not create PDF. Try Print instead.",
    ),
    uploadErrorMessage: t(
      "receipt.share.errors.upload",
      "Failed to upload receipt for sharing.",
    ),
  });

  if (!context) return null;

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
              documentCode={context.sale.id ?? context.document_code ?? "receipt"}
              session={shareSession.session}
              linkExpired={shareSession.linkExpired}
              getPdfBlob={shareSession.getPdfBlob}
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
                    context={context}
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

        <div className={styles.footerActions}>
          <Button
            variant="secondary"
            onClick={() => window.print()}
            disabled={!selectedTemplate}
          >
            <Printer size={16} /> {t("receipt.print", "Print")}
          </Button>
          <Button onClick={onClose}>{resolvedCloseLabel}</Button>
        </div>
      </Modal>

      <PrintAreaPortal active={Boolean(selectedTemplate)} ref={printRootRef}>
        {selectedTemplate ? (
          <TemplatedReceiptView template={selectedTemplate} context={context} />
        ) : null}
      </PrintAreaPortal>
    </>
  );
}
