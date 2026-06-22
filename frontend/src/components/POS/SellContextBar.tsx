import clsx from "clsx";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "@/components/posui/Modal";
import { useSellContext } from "@/store/sell-context";
import styles from "./POS.module.css";

type SellContextBarProps = {
  className?: string;
};

function SellContextFields({ layout }: { layout: "inline" | "stacked" }) {
  const options = useSellContext((s) => s.options);
  const warehouseId = useSellContext((s) => s.warehouseId);
  const priceTypeId = useSellContext((s) => s.priceTypeId);
  const partnerId = useSellContext((s) => s.partnerId);
  const setWarehouseId = useSellContext((s) => s.setWarehouseId);
  const setPriceTypeId = useSellContext((s) => s.setPriceTypeId);
  const setPartnerId = useSellContext((s) => s.setPartnerId);

  const fieldClassName =
    layout === "stacked" ? styles.sellContextFieldStacked : styles.sellContextField;

  return (
    <>
      <label className={fieldClassName}>
        <span className={styles.sellContextLabel}>Warehouse</span>
        <select
          className={styles.sellContextSelect}
          value={warehouseId ?? ""}
          onChange={(e) =>
            setWarehouseId(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="" disabled>
            Select warehouse
          </option>
          {options.warehouses.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>

      <label className={fieldClassName}>
        <span className={styles.sellContextLabel}>Price type</span>
        <select
          className={styles.sellContextSelect}
          value={priceTypeId ?? ""}
          onChange={(e) =>
            setPriceTypeId(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="" disabled>
            Select price type
          </option>
          {options.price_types.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>

      <label className={fieldClassName}>
        <span className={styles.sellContextLabel}>Partner</span>
        <select
          className={styles.sellContextSelect}
          value={partnerId ?? ""}
          onChange={(e) => setPartnerId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="" disabled>
            Select partner
          </option>
          {options.partners.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export function SellContextBar({ className }: SellContextBarProps) {
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
          aria-label="Warehouse, price type, and partner"
        >
          <SlidersHorizontal size={20} />
        </button>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Sell context"
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
