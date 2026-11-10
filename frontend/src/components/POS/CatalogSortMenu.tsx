import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  CATALOG_SORT_OPTIONS,
  catalogSortFromOptionId,
  catalogSortToOptionId,
  type CatalogSort,
} from "@/lib/catalog-sort";
import styles from "./POS.module.css";

type Props = {
  open: boolean;
  catalogSort: CatalogSort;
  anchorRef: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onSelect: (sort: CatalogSort) => void;
};

type MenuPosition = {
  top: number;
  left: number;
};

export function CatalogSortMenu({
  open,
  catalogSort,
  anchorRef,
  menuRef,
  onClose,
  onSelect,
}: Props) {
  const { t } = useLanguage();
  const [position, setPosition] = useState<MenuPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menuWidth = Math.max(menuRef.current?.offsetWidth ?? 176, 176);
      const left = Math.min(
        Math.max(8, rect.right - menuWidth),
        window.innerWidth - menuWidth - 8,
      );
      setPosition({
        top: Math.min(rect.bottom + 6, window.innerHeight - 8),
        left,
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, menuRef, open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, menuRef, onClose, open]);

  if (!open || !position || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      className={clsx(styles.sortMenu, styles.sortMenuPortal)}
      style={{ top: position.top, left: position.left }}
      role="menu"
      aria-label={t("pos.sortBy", "Sort by")}
    >
      <div className={styles.sortMenuLabel}>{t("pos.sortBy", "Sort by")}</div>
      {CATALOG_SORT_OPTIONS.map((option) => {
        const isActive = catalogSortToOptionId(catalogSort) === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={isActive}
            className={clsx(styles.sortMenuItem, isActive && styles.sortMenuItemActive)}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(catalogSortFromOptionId(option.id));
              onClose();
            }}
          >
            {t(option.labelKey, option.fallback)}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
