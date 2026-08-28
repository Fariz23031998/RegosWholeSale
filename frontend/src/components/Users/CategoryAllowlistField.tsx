import clsx from "clsx";
import { categoryPathDepth } from "@/lib/category-scope";
import styles from "./Users.module.css";

export type CategoryAllowlistItem = {
  id: number;
  name: string;
  path?: string;
};

type Props = {
  label: string;
  hint: string;
  allLabel: string;
  items: CategoryAllowlistItem[];
  selectedIds: number[];
  disabled?: boolean;
  indentByPath?: boolean;
  onChange: (ids: number[]) => void;
};

export function CategoryAllowlistField({
  label,
  hint,
  allLabel,
  items,
  selectedIds,
  disabled,
  indentByPath,
  onChange,
}: Props) {
  if (items.length === 0) return null;

  const allSelected = selectedIds.length === 0;
  const selectedSet = new Set(selectedIds);

  const toggleItem = (itemId: number) => {
    const next = allSelected
      ? items.map((item) => item.id).filter((id) => id !== itemId)
      : selectedSet.has(itemId)
        ? selectedIds.filter((id) => id !== itemId)
        : [...selectedIds, itemId];
    onChange(next.length === items.length ? [] : next);
  };

  return (
    <div className={styles.field}>
      <div className={styles.label}>{label}</div>
      <p className={styles.hint}>{hint}</p>
      <div className={styles.allowlist}>
        <label className={styles.allowlistRow}>
          <input
            type="checkbox"
            checked={allSelected}
            disabled={disabled}
            onChange={(event) => {
              if (event.target.checked) onChange([]);
            }}
          />
          <span>{allLabel}</span>
        </label>
        <div className={styles.allowlistItems}>
          {items.map((item) => {
            const checked = allSelected || selectedSet.has(item.id);
            const depth = indentByPath && item.path ? categoryPathDepth(item.path) : 0;
            return (
              <label
                key={item.id}
                className={clsx(styles.allowlistRow, styles.allowlistItem)}
                style={depth > 0 ? { paddingLeft: `calc(8px + ${depth} * 16px)` } : undefined}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggleItem(item.id)}
                />
                <span title={item.path}>{indentByPath ? item.name : item.path || item.name}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
