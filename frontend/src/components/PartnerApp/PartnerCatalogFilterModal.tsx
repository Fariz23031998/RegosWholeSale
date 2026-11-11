import { useLanguage } from "@/contexts/LanguageContext";
import { Modal } from "@/components/posui/Modal";
import styles from "./PartnerPortal.module.css";

export type PartnerCatalogFilter =
  | "all"
  | "in-stock"
  | "low-stock"
  | "cheap"
  | "expensive";

type Props = {
  open: boolean;
  onClose: () => void;
  filter: string;
  showZeroQuantity: boolean;
  onSelect: (filter: PartnerCatalogFilter) => void;
};

function filterLabelKey(item: PartnerCatalogFilter): string {
  if (item === "all") return "allProducts";
  if (item === "in-stock") return "inStock";
  if (item === "low-stock") return "lowStock";
  return item;
}

function filterFallback(item: PartnerCatalogFilter): string {
  if (item === "all") return "All";
  if (item === "in-stock") return "In stock";
  if (item === "low-stock") return "Low stock";
  if (item === "cheap") return "Lower price";
  return "Higher price";
}

export function PartnerCatalogFilterModal({
  open,
  onClose,
  filter,
  showZeroQuantity,
  onSelect,
}: Props) {
  const { t } = useLanguage();
  const options: PartnerCatalogFilter[] = showZeroQuantity
    ? ["all", "in-stock", "low-stock", "cheap", "expensive"]
    : ["in-stock", "low-stock", "cheap", "expensive"];

  return (
    <Modal open={open} onClose={onClose} title={t("partnerApp.filters", "Filters")} size="md">
      <div className={styles.filterModalOptions} role="listbox" aria-label={t("partnerApp.filters", "Filters")}>
        {options.map((item) => (
          <button
            key={item}
            type="button"
            role="option"
            aria-selected={filter === item}
            className={filter === item ? styles.chipOn : styles.chip}
            onClick={() => {
              onSelect(item);
              onClose();
            }}
          >
            {t(`partnerApp.${filterLabelKey(item)}`, filterFallback(item))}
          </button>
        ))}
      </div>
    </Modal>
  );
}
