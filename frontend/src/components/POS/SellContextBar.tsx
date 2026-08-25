import clsx from "clsx";

import { ChevronDown, SlidersHorizontal, User } from "lucide-react";

import { useEffect, useMemo, useState } from "react";

import { useLanguage } from "@/contexts/LanguageContext";

import { Modal } from "@/components/posui/Modal";

import { PartnerPickerModal } from "@/components/POS/PartnerPickerModal";

import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/store/auth";

import { useSellContext } from "@/store/sell-context";

import type { Partner } from "@/types/partners";

import styles from "./POS.module.css";



type SellContextBarProps = {

  className?: string;

};



function SellContextPartnerField({
  layout,
}: {
  layout: "inline" | "stacked" | "compact";
}) {
  const { t } = useLanguage();
  const { canChangePartner } = usePermissions();
  const token = useAuth((s) => s.accessToken);
  const options = useSellContext((s) => s.options);
  const partnerId = useSellContext((s) => s.partnerId);
  const setPartnerId = useSellContext((s) => s.setPartnerId);
  const refreshPartnerOptions = useSellContext((s) => s.refreshPartnerOptions);
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [partnerLabel, setPartnerLabel] = useState<string | null>(null);

  const selectedPartnerName = useMemo(() => {
    if (partnerLabel) return partnerLabel;
    const match = options.partners.find((item) => item.id === partnerId);
    return match?.name ?? null;
  }, [options.partners, partnerId, partnerLabel]);

  useEffect(() => {
    if (!partnerId) {
      setPartnerLabel(null);
      return;
    }
    const match = options.partners.find((item) => item.id === partnerId);
    if (match) {
      setPartnerLabel(match.name);
    }
  }, [options.partners, partnerId]);

  const handlePartnerSelect = (partner: Partner) => {
    setPartnerId(partner.id);
    setPartnerLabel(partner.name);
  };

  const handlePartnersChanged = async () => {
    if (!token) return;
    await refreshPartnerOptions(token);
  };

  if (!canChangePartner()) return null;

  const partnerLabelText =
    selectedPartnerName ?? t("pos.sellContext.selectPartner", "Select partner");

  return (
    <>
      {layout === "compact" ? (
        <button
          type="button"
          className={styles.sellContextMobileBtn}
          onClick={() => setPartnerModalOpen(true)}
          aria-label={
            selectedPartnerName
              ? t("pos.sellContext.partnerSelected", "Partner: {{name}}", {
                  name: selectedPartnerName,
                })
              : t("pos.sellContext.selectPartner", "Select partner")
          }
        >
          <User size={20} />
        </button>
      ) : (
        <div
          className={
            layout === "stacked"
              ? styles.sellContextFieldStacked
              : styles.sellContextField
          }
        >
          <span className={styles.sellContextLabel}>
            {t("pos.sellContext.partner", "Partner")}
          </span>
          <button
            type="button"
            className={clsx(styles.sellContextSelect, styles.sellContextPartnerBtn)}
            onClick={() => setPartnerModalOpen(true)}
          >
            <span className={styles.sellContextPartnerLabel}>{partnerLabelText}</span>
            <ChevronDown size={14} className={styles.sellContextPartnerIcon} />
          </button>
        </div>
      )}

      {token ? (
        <PartnerPickerModal
          open={partnerModalOpen}
          onClose={() => setPartnerModalOpen(false)}
          token={token}
          selectedPartnerId={partnerId}
          onSelect={handlePartnerSelect}
          onPartnersChanged={handlePartnersChanged}
        />
      ) : null}
    </>
  );
}

function SellContextFields({
  layout,
  showPartner = true,
}: {
  layout: "inline" | "stacked";
  showPartner?: boolean;
}) {

  const { t } = useLanguage();

  const { canChangeWarehouse, canChangePriceType } = usePermissions();

  const options = useSellContext((s) => s.options);

  const warehouseId = useSellContext((s) => s.warehouseId);

  const priceTypeId = useSellContext((s) => s.priceTypeId);

  const setWarehouseId = useSellContext((s) => s.setWarehouseId);

  const setPriceTypeId = useSellContext((s) => s.setPriceTypeId);

  const fieldClassName =

    layout === "stacked" ? styles.sellContextFieldStacked : styles.sellContextField;

  return (

    <>

      {canChangeWarehouse() && (
      <label className={fieldClassName}>

        <span className={styles.sellContextLabel}>{t("pos.sellContext.warehouse", "Warehouse")}</span>

        <select

          className={styles.sellContextSelect}

          value={warehouseId ?? ""}

          onChange={(e) =>

            setWarehouseId(e.target.value ? Number(e.target.value) : null)

          }

        >

          <option value="" disabled>

            {t("pos.sellContext.selectWarehouse", "Select warehouse")}

          </option>

          {options.warehouses.map((item) => (

            <option key={item.id} value={item.id}>

              {item.name}

            </option>

          ))}

        </select>

      </label>
      )}



      {canChangePriceType() && (
      <label className={fieldClassName}>

        <span className={styles.sellContextLabel}>{t("pos.sellContext.priceType", "Price type")}</span>

        <select

          className={styles.sellContextSelect}

          value={priceTypeId ?? ""}

          onChange={(e) =>

            setPriceTypeId(e.target.value ? Number(e.target.value) : null)

          }

        >

          <option value="" disabled>

            {t("pos.sellContext.selectPriceType", "Select price type")}

          </option>

          {options.price_types.map((item) => (

            <option key={item.id} value={item.id}>

              {item.name}

            </option>

          ))}

        </select>

      </label>
      )}

      {showPartner ? <SellContextPartnerField layout={layout} /> : null}
    </>
  );
}



export function SellContextBar({ className }: SellContextBarProps) {

  const { t } = useLanguage();

  const [isCompact, setIsCompact] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);



  useEffect(() => {

    const mq = window.matchMedia("(max-width: 900px)");

    const onChange = () => setIsCompact(mq.matches);

    onChange();

    mq.addEventListener("change", onChange);

    return () => mq.removeEventListener("change", onChange);

  }, []);



  if (isCompact) {

    return (

      <>

        <div className={clsx(styles.sellContextMobileActions, className)}>

          <button

            type="button"

            className={styles.sellContextMobileBtn}

            onClick={() => setModalOpen(true)}

            aria-label={t("pos.sellContext.ariaLabelMobile", "Warehouse and price type")}

          >

            <SlidersHorizontal size={20} />

          </button>

          <SellContextPartnerField layout="compact" />

        </div>

        <Modal

          open={modalOpen}

          onClose={() => setModalOpen(false)}

          title={t("pos.sellContext.title", "Sell context")}

          bodyClassName={styles.sellContextModalBody}

        >

          <div className={styles.sellContextStacked}>

            <SellContextFields layout="stacked" showPartner={false} />

          </div>

        </Modal>

      </>

    );

  }



  return (

    <div className={clsx(styles.sellContext, className)}>

      <SellContextFields layout="inline" />

    </div>

  );

}

