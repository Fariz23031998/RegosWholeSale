import { useEffect, useState } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
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
      setError("Select at least one warehouse or choose all warehouses.");
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
    <Modal open={open} onClose={onClose} title="Choose warehouses" size="md">
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
          <span>All warehouses</span>
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
            <div className={styles.emptyList}>No warehouses available from Regos.</div>
          )}
        </div>

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

export function formatWarehouseFilterLabel(
  allStocks: boolean,
  selectedStockIds: number[],
  warehouses: RegosDefaultOption[],
): string {
  if (allStocks || (warehouses.length > 0 && selectedStockIds.length === warehouses.length)) {
    return "All warehouses";
  }
  if (selectedStockIds.length === 1) {
    const warehouse = warehouses.find((item) => item.id === selectedStockIds[0]);
    return warehouse?.name ?? "1 warehouse";
  }
  return `${selectedStockIds.length} warehouses`;
}
