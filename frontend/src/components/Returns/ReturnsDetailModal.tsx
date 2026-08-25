import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import type {
  WholesaleOperationLine,
  WholesalePaymentLine,
  WholesaleReturnDocument,
} from "@/lib/sales-api";
import { ReturnsDetailContent } from "./ReturnsDetailContent";

type Props = {
  document: WholesaleReturnDocument;
  operations: WholesaleOperationLine[];
  payments: WholesalePaymentLine[];
  loading?: boolean;
  onClose: () => void;
};

export function ReturnsDetailModal({
  document,
  operations,
  payments,
  loading = false,
  onClose,
}: Props) {
  const { t } = useLanguage();
  const title = t("returns.detail.title", undefined, { code: document.code || document.id });

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <ReturnsDetailContent
        document={document}
        operations={operations}
        payments={payments}
        loading={loading}
      />
    </Modal>
  );
}
