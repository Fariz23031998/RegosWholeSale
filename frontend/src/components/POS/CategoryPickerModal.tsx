import { Search, Star } from "lucide-react";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/posui/Modal";
import type { ProductGroup } from "@/types/catalog";
import styles from "./POS.module.css";

function categoryPathDepth(path: string): number {
  const segments = path.split("/").map((segment) => segment.trim()).filter(Boolean);
  return Math.max(0, segments.length - 1);
}

function categoryParentPath(path: string): string | null {
  const segments = path.split("/").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length <= 1) return null;
  return segments.slice(0, -1).join(" / ");
}

type Props = {
  open: boolean;
  onClose: () => void;
  groups: ProductGroup[];
  featuredOnly: boolean;
  selectedGroupId: number | null;
  onSelectFeatured: () => void;
  onSelectAll: () => void;
  onSelectGroup: (groupId: number) => void;
};

export function CategoryPickerModal({
  open,
  onClose,
  groups,
  featuredOnly,
  selectedGroupId,
  onSelectFeatured,
  onSelectAll,
  onSelectGroup,
}: Props) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter(
      (group) =>
        group.name.toLowerCase().includes(query) ||
        group.path.toLowerCase().includes(query),
    );
  }, [groups, search]);

  const selectFeatured = () => {
    onSelectFeatured();
    onClose();
  };

  const selectAll = () => {
    onSelectAll();
    onClose();
  };

  const selectGroup = (groupId: number) => {
    onSelectGroup(groupId);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Categories"
      size="lg"
      bodyClassName={styles.categoryModalBody}
    >
      <div className={styles.categoryModalQuick}>
        <button
          type="button"
          className={clsx(styles.chip, styles.chipIcon, featuredOnly && styles.chipActive)}
          onClick={selectFeatured}
          aria-label="Featured products"
          title="Featured"
        >
          <Star size={14} fill={featuredOnly ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          className={clsx(
            styles.chip,
            !featuredOnly && selectedGroupId === null && styles.chipActive,
          )}
          onClick={selectAll}
        >
          All
        </button>
      </div>

      <div className={styles.categoryModalSearch}>
        <Search size={16} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Search categories..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search categories"
        />
      </div>

      <div className={styles.categoryModalList} role="listbox" aria-label="Product categories">
        {filteredGroups.length === 0 ? (
          <div className={styles.categoryModalEmpty}>No categories match your search.</div>
        ) : (
          filteredGroups.map((group) => {
          const depth = categoryPathDepth(group.path);
          const parentPath = categoryParentPath(group.path);
          const isActive = !featuredOnly && selectedGroupId === group.id;

          return (
            <button
              key={group.id}
              type="button"
              role="option"
              aria-selected={isActive}
              className={clsx(styles.categoryModalItem, isActive && styles.categoryModalItemActive)}
              style={{ paddingLeft: `calc(12px + ${depth} * 20px)` }}
              title={group.path}
              onClick={() => selectGroup(group.id)}
            >
              <span className={styles.categoryModalItemName}>{group.name}</span>
              {parentPath ? (
                <span className={styles.categoryModalItemPath}>{parentPath}</span>
              ) : null}
            </button>
          );
        })
        )}
      </div>
    </Modal>
  );
}
