import { useEffect, useState } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslateFn } from "@/lib/dashboard-api";
import type { RegosDefaultOption } from "@/types/settings";
import styles from "./Dashboard.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  partners: RegosDefaultOption[];
  allPartners: boolean;
  selectedPartnerIds: number[];
  onApply: (value: { allPartners: boolean; partnerIds: number[] }) => void;
};

export function DashboardPartnersModal({
  open,
  onClose,
  partners,
  allPartners,
  selectedPartnerIds,
  onApply,
}: Props) {
  const { t } = useLanguage();
  const [draftAllPartners, setDraftAllPartners] = useState(allPartners);
  const [draftIds, setDraftIds] = useState<number[]>(selectedPartnerIds);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraftAllPartners(allPartners);
    setDraftIds(selectedPartnerIds);
    setError("");
  }, [allPartners, open, selectedPartnerIds]);

  const togglePartner = (partnerId: number) => {
    setDraftAllPartners(false);
    setDraftIds((current) =>
      current.includes(partnerId)
        ? current.filter((id) => id !== partnerId)
        : [...current, partnerId],
    );
  };

  const handleSelectAll = () => {
    setDraftAllPartners(true);
    setDraftIds(partners.map((partner) => partner.id));
  };

  const handleApply = () => {
    if (!draftAllPartners && draftIds.length === 0) {
      setError(t("dashboard.partners.selectOneOrAll"));
      return;
    }
    const everySelected = draftIds.length === partners.length && partners.length > 0;
    onApply({
      allPartners: draftAllPartners || everySelected,
      partnerIds:
        draftAllPartners || everySelected
          ? partners.map((partner) => partner.id)
          : draftIds,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("dashboard.partnersModal.title")} size="md">
      <div className={styles.modalForm}>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={draftAllPartners}
            onChange={(event) => {
              if (event.target.checked) {
                handleSelectAll();
              } else {
                setDraftAllPartners(false);
                setDraftIds([]);
              }
            }}
          />
          <span>{t("dashboard.partners.all")}</span>
        </label>

        <div className={styles.checkList}>
          {partners.map((partner) => {
            const checked = draftAllPartners || draftIds.includes(partner.id);
            return (
              <label key={partner.id} className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    if (draftAllPartners) {
                      setDraftAllPartners(false);
                      setDraftIds(
                        partners.map((item) => item.id).filter((id) => id !== partner.id),
                      );
                      return;
                    }
                    togglePartner(partner.id);
                  }}
                />
                <span className={styles.checkLabel}>{partner.name}</span>
              </label>
            );
          })}
          {partners.length === 0 && (
            <div className={styles.emptyList}>{t("dashboard.partners.noneAvailable")}</div>
          )}
        </div>

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

export function formatPartnerFilterLabel(
  allPartners: boolean,
  selectedPartnerIds: number[],
  partners: RegosDefaultOption[],
  t: TranslateFn,
): string {
  if (allPartners || (partners.length > 0 && selectedPartnerIds.length === partners.length)) {
    return t("dashboard.partners.all");
  }
  if (selectedPartnerIds.length === 1) {
    const partner = partners.find((item) => item.id === selectedPartnerIds[0]);
    return partner?.name ?? t("dashboard.partners.one");
  }
  return t("dashboard.partners.count", undefined, { n: selectedPartnerIds.length });
}
