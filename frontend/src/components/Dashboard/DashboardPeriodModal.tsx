import { useEffect, useState } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import type { DashboardCustomRange } from "@/lib/dashboard-api";
import styles from "./Dashboard.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  initialRange: DashboardCustomRange;
  onApply: (range: DashboardCustomRange) => void;
};

export function DashboardPeriodModal({ open, onClose, initialRange, onApply }: Props) {
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setStartDate(initialRange.startDate);
    setEndDate(initialRange.endDate);
    setError("");
  }, [open, initialRange.endDate, initialRange.startDate]);

  const handleApply = () => {
    if (!startDate || !endDate) {
      setError("Choose both start and end dates.");
      return;
    }
    if (startDate > endDate) {
      setError("Start date must be on or before end date.");
      return;
    }
    onApply({ startDate, endDate });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Choose period" size="md">
      <div className={styles.modalForm}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>From</span>
          <input
            type="date"
            className={styles.fieldInput}
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>To</span>
          <input
            type="date"
            className={styles.fieldInput}
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
        {error && <div className={styles.fieldError}>{error}</div>}
        <div className={styles.modalActions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply}>
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}
