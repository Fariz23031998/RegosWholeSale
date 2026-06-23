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
  warehouses: RegosDefaultOption[];
  allStocks: boolean;
  selectedStockIds: number[];
  onApply: (value: { allStocks: boolean; stockIds: number[] }) => void;
};

export function DashboardWarehousesModal({
  open,
  onClose,
  warehouses,
  allStocks,
  selectedStockIds,
  onApply,
}: Props) {
  const { t } = useLanguage();
  const [draftAllStocks, setDraftAllStocks] = useState(allStocks);
  const [draftIds, setDraftIds] = useState<number[]>(selectedStockIds);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraftAllStocks(allStocks);
    setDraftIds(selectedStockIds);
    setError("");
  }, [allStocks, open, selectedStockIds]);

  const toggleWarehouse = (warehouseId: number) => {
    setDraftAllStocks(false);
    setDraftIds((current) =>
      current.includes(warehouseId)
        ? current.filter((id) => id !== warehouseId)
        : [...current, warehouseId],
    );
  };

  const handleSelectAll = () => {
    setDraftAllStocks(true);
    setDraftIds(warehouses.map((warehouse) => warehouse.id));
  };

  const handleApply = () => {
    if (!draftAllStocks && draftIds.length === 0) {
      setError(t("dashboard.warehouses.selectOneOrAll"));
      return;
    }
    const everySelected = draftIds.length === warehouses.length && warehouses.length > 0;
    onApply({
      allStocks: draftAllStocks || everySelected,
      stockIds: draftAllStocks || everySelected ? warehouses.map((warehouse) => warehouse.id) : draftIds,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("dashboard.warehousesModal.title")} size="md">
      <div className={styles.modalForm}>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={draftAllStocks}
            onChange={(event) => {
              if (event.target.checked) {
                handleSelectAll();
              } else {
                setDraftAllStocks(false);
                setDraftIds([]);
              }
            }}
          />
          <span>{t("dashboard.warehouses.all")}</span>
        </label>

        <div className={styles.checkList}>
          {warehouses.map((warehouse) => {
            const checked = draftAllStocks || draftIds.includes(warehouse.id);
            return (
              <label key={warehouse.id} className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    if (draftAllStocks) {
                      setDraftAllStocks(false);
                      setDraftIds(
                        warehouses
                          .map((item) => item.id)
                          .filter((id) => id !== warehouse.id),
                      );
                      return;
                    }
                    toggleWarehouse(warehouse.id);
                  }}
                />
                <span className={styles.checkLabel}>{warehouse.name}</span>
              </label>
            );
          })}
          {warehouses.length === 0 && (
            <div className={styles.emptyList}>{t("dashboard.warehouses.noneAvailable")}</div>
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

export function formatWarehouseFilterLabel(
  allStocks: boolean,
  selectedStockIds: number[],
  warehouses: RegosDefaultOption[],
  t: TranslateFn,
): string {
  if (allStocks || (warehouses.length > 0 && selectedStockIds.length === warehouses.length)) {
    return t("dashboard.warehouses.all");
  }
  if (selectedStockIds.length === 1) {
    const warehouse = warehouses.find((item) => item.id === selectedStockIds[0]);
    return warehouse?.name ?? t("dashboard.warehouses.one");
  }
  return t("dashboard.warehouses.count", undefined, { n: selectedStockIds.length });
}
