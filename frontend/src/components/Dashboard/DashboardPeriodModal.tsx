import { useEffect, useState } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import type { DashboardCustomRange } from "@/lib/dashboard-api";
import styles from "./Dashboard.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  initialRange: DashboardCustomRange;
  onApply: (range: DashboardCustomRange) => void;
};

export function DashboardPeriodModal({ open, onClose, initialRange, onApply }: Props) {
  const { t } = useLanguage();
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
      setError(t("dashboard.periodModal.bothDatesRequired"));
      return;
    }
    if (startDate > endDate) {
      setError(t("dashboard.periodModal.startBeforeEnd"));
      return;
    }
    onApply({ startDate, endDate });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("dashboard.periodModal.title")} size="md">
      <div className={styles.modalForm}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t("common.from")}</span>
          <input
            type="date"
            className={styles.fieldInput}
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t("common.to")}</span>
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
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleApply}>
            {t("common.apply")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
