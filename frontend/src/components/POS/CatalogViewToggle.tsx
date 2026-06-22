import { LayoutGrid, List, Square } from "lucide-react";
import clsx from "clsx";
import { useCatalog, type CatalogViewMode } from "@/store/catalog";
import styles from "./POS.module.css";

type CatalogViewToggleProps = {
  className?: string;
};

export function CatalogViewToggle({ className }: CatalogViewToggleProps) {
  const view = useCatalog((s) => s.mobileViewMode);
  const setView = useCatalog((s) => s.setMobileViewMode);

  const setMode = (mode: CatalogViewMode) => setView(mode);

  return (
    <div
      className={clsx(styles.viewToggle, className)}
      role="group"
      aria-label="View mode"
    >
      <button
        type="button"
        className={clsx(styles.viewBtn, view === "single" && styles.viewBtnActive)}
        onClick={() => setMode("single")}
        aria-label="One per row"
        aria-pressed={view === "single"}
      >
        <Square size={16} />
      </button>
      <button
        type="button"
        className={clsx(styles.viewBtn, view === "double" && styles.viewBtnActive)}
        onClick={() => setMode("double")}
        aria-label="Two per row"
        aria-pressed={view === "double"}
      >
        <LayoutGrid size={16} />
      </button>
      <button
        type="button"
        className={clsx(styles.viewBtn, view === "list" && styles.viewBtnActive)}
        onClick={() => setMode("list")}
        aria-label="Compact list"
        aria-pressed={view === "list"}
      >
        <List size={16} />
      </button>
    </div>
  );
}
