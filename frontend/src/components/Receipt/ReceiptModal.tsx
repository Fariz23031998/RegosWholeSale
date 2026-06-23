import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { useReceiptTemplates } from "@/hooks/use-receipt-templates";
import type { ReceiptPrintContext } from "@/lib/receipt-print-context";
import { useAuth } from "@/store/auth";
import { ReceiptTemplatePicker } from "./ReceiptTemplatePicker";
import { PrintAreaPortal } from "./PrintAreaPortal";
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

  useEffect(() => {
    if (!context) return;
    const fallback = resolveDefaultTemplate(templates, defaultTemplateId);
    setSelectedTemplateId(fallback?.id ?? "");
  }, [context, defaultTemplateId, templates]);

  if (!context) return null;

  const sale = context.sale;
  const closedWithoutPayment =
    (sale.amountPaid ?? 0) <= 0 && (sale.balanceDue ?? 0) > 0;
  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ??
    resolveDefaultTemplate(templates, defaultTemplateId);

  const modalTitle =
    title ??
    (closedWithoutPayment
      ? t("receipt.closedWithoutPayment", "Closed without payment")
      : t("receipt.saleComplete", "Sale Complete"));

  const resolvedCloseLabel = closeLabel ?? t("common.done", "Done");

  return (
    <>
      <Modal open={!!context} onClose={onClose} title={modalTitle} size="md">
        <ReceiptTemplatePicker
          templates={templates}
          value={selectedTemplateId}
          onChange={setSelectedTemplateId}
        />
        <div className={styles.preview}>
          {selectedTemplate ? (
            <TemplatedReceiptView template={selectedTemplate} context={context} />
          ) : (
            <div className={styles.templatePickerLabel}>
              {t("receipt.noTemplates", "Receipt templates are not available.")}
            </div>
          )}
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            full
            onClick={() => window.print()}
            disabled={!selectedTemplate}
          >
            <Printer size={16} /> {t("receipt.print", "Print")}
          </Button>
          <Button full onClick={onClose}>
            {resolvedCloseLabel}
          </Button>
        </div>
      </Modal>

      <PrintAreaPortal active={Boolean(selectedTemplate)}>
        {selectedTemplate ? (
          <TemplatedReceiptView template={selectedTemplate} context={context} />
        ) : null}
      </PrintAreaPortal>
    </>
  );
}
