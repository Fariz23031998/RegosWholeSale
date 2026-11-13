import { useEffect, useState } from "react";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import type {
  WholesaleDocument,
  WholesaleOperationLine,
  WholesalePaymentLine,
} from "@/lib/sales-api";
import { SalesDetailContent } from "./SalesDetailContent";
import styles from "./Sales.module.css";

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
  const [isMobile, setIsMobile] = useState(false);
  const title = t("sales.detail.title", undefined, { code: document.code || document.id });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="lg"
      fullscreen={isMobile}
      modalClassName={styles.detailModal}
      bodyClassName={styles.detailModalBody}
    >
      <SalesDetailContent
        document={document}
        operations={operations}
        payments={payments}
        loading={loading}
      />
    </Modal>
  );
}
