import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import type {
  WholesaleDocument,
  WholesaleOperationLine,
  WholesalePaymentLine,
} from "@/lib/sales-api";
import { SalesDetailContent } from "./SalesDetailContent";

type Props = {
  document: WholesaleDocument;
  operations: WholesaleOperationLine[];
  payments: WholesalePaymentLine[];
  loading?: boolean;
  onClose: () => void;
};

export function SalesDetailModal({
  document,
  operations,
  payments,
  loading = false,
  onClose,
}: Props) {
  const { t } = useLanguage();
  const title = t("sales.detail.title", undefined, { code: document.code || document.id });

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <SalesDetailContent
        document={document}
        operations={operations}
        payments={payments}
        loading={loading}
      />
    </Modal>
  );
}
