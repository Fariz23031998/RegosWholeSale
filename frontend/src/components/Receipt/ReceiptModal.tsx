import { Printer } from "lucide-react";
import type { Sale } from "@/data/seed";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { ReceiptView } from "./ReceiptView";
import styles from "./Receipt.module.css";

type Props = {
  sale: Sale | null;
  onClose: () => void;
};

export function ReceiptModal({ sale, onClose }: Props) {
  if (!sale) return null;
  return (
    <Modal open={!!sale} onClose={onClose} title="Sale Complete" size="md">
      <div className="print-area">
        <ReceiptView sale={sale} />
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" full onClick={() => window.print()}>
          <Printer size={16} /> Print Receipt
        </Button>
        <Button full onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
