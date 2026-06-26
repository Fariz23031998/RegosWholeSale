import clsx from "clsx";

import { ChevronDown, SlidersHorizontal } from "lucide-react";

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



function SellContextFields({ layout }: { layout: "inline" | "stacked" }) {

  const { t } = useLanguage();

  const { canChangeWarehouse, canChangePriceType, canChangePartner } = usePermissions();
  const token = useAuth((s) => s.accessToken);

  const options = useSellContext((s) => s.options);

  const warehouseId = useSellContext((s) => s.warehouseId);

  const priceTypeId = useSellContext((s) => s.priceTypeId);

  const partnerId = useSellContext((s) => s.partnerId);

  const setWarehouseId = useSellContext((s) => s.setWarehouseId);

  const setPriceTypeId = useSellContext((s) => s.setPriceTypeId);

  const setPartnerId = useSellContext((s) => s.setPartnerId);

  const refreshPartnerOptions = useSellContext((s) => s.refreshPartnerOptions);

  const [partnerModalOpen, setPartnerModalOpen] = useState(false);

  const [partnerLabel, setPartnerLabel] = useState<string | null>(null);



  const fieldClassName =

    layout === "stacked" ? styles.sellContextFieldStacked : styles.sellContextField;



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



      {canChangePartner() && (
      <div className={fieldClassName}>

        <span className={styles.sellContextLabel}>{t("pos.sellContext.partner", "Partner")}</span>

        <button

          type="button"

          className={clsx(styles.sellContextSelect, styles.sellContextPartnerBtn)}

          onClick={() => setPartnerModalOpen(true)}

        >

          <span className={styles.sellContextPartnerLabel}>

            {selectedPartnerName ?? t("pos.sellContext.selectPartner", "Select partner")}

          </span>

          <ChevronDown size={14} className={styles.sellContextPartnerIcon} />

        </button>

      </div>
      )}



      {canChangePartner() && token ? (

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

        <button

          type="button"

          className={styles.sellContextMobileBtn}

          onClick={() => setModalOpen(true)}

          aria-label={t("pos.sellContext.ariaLabel", "Warehouse, price type, and partner")}

        >

          <SlidersHorizontal size={20} />

        </button>

        <Modal

          open={modalOpen}

          onClose={() => setModalOpen(false)}

          title={t("pos.sellContext.title", "Sell context")}

          bodyClassName={styles.sellContextModalBody}

        >

          <div className={styles.sellContextStacked}>

            <SellContextFields layout="stacked" />

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

