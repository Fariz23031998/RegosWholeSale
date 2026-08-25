import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ProductGroup } from "@/types/catalog";
import styles from "./StockDocs.module.css";

type Props = {
  groups: ProductGroup[];
  value: number;
  disabled?: boolean;
  onChange: (groupId: number) => void;
  onCreate?: () => void;
  onEdit?: (group: ProductGroup) => void;
};

export function ProductGroupPicker({
  groups,
  value,
  disabled,
  onChange,
  onCreate,
  onEdit,
}: Props) {
  const { t } = useLanguage();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => groups.find((g) => g.id === value) ?? null,
    [groups, value],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(term) ||
        g.path.toLowerCase().includes(term),
    );
  }, [groups, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const displayValue = open ? query : selected?.path || selected?.name || "";

  return (
    <div className={styles.groupPicker} ref={rootRef}>
      <div className={styles.groupPickerRow}>
        <div className={styles.groupPickerControl}>
          <input
            className={styles.groupPickerInput}
            value={displayValue}
            disabled={disabled}
            placeholder={t("stock.item.group.search", "Search groups…")}
            onFocus={() => {
              if (disabled) return;
              setOpen(true);
              setQuery("");
            }}
            onChange={(e) => {
              setOpen(true);
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
                setQuery("");
              }
            }}
          />
          <ChevronDown size={16} className={styles.groupPickerChevron} aria-hidden />
        </div>
        {onCreate ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            disabled={disabled}
            aria-label={t("stock.item.group.create", "Create group")}
            title={t("stock.item.group.create", "Create group")}
            onClick={() => {
              setOpen(false);
              setQuery("");
              onCreate();
            }}
          >
            <Plus size={18} />
          </Button>
        ) : null}
      </div>

      {open ? (
        <ul className={styles.groupPickerList} role="listbox">
          {filtered.length === 0 ? (
            <li className={styles.groupPickerEmpty}>
              {t("stock.item.group.empty", "No groups found")}
            </li>
          ) : (
            filtered.map((group) => (
              <li key={group.id} className={styles.groupPickerItem}>
                <button
                  type="button"
                  className={styles.groupPickerOption}
                  role="option"
                  aria-selected={group.id === value}
                  onClick={() => {
                    onChange(group.id);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {group.path || group.name}
                </button>
                {onEdit ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={styles.groupPickerEdit}
                    aria-label={t("common.edit", "Edit")}
                    title={t("common.edit", "Edit")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      setQuery("");
                      onEdit(group);
                    }}
                  >
                    <Pencil size={16} />
                  </Button>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
