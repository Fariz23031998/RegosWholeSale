import { Star } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { ProductGroup } from "@/types/catalog";
import { CategoryPickerModal } from "./CategoryPickerModal";
import styles from "./POS.module.css";

const CATEGORY_GAP = 8;

type Props = {
  groups: ProductGroup[];
  featuredOnly: boolean;
  selectedGroupId: number | null;
  onSelectFeatured: () => void;
  onSelectAll: () => void;
  onSelectGroup: (groupId: number) => void;
};

export function CategoryBar({
  groups,
  featuredOnly,
  selectedGroupId,
  onSelectFeatured,
  onSelectAll,
  onSelectGroup,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [visibleGroupCount, setVisibleGroupCount] = useState(groups.length);

  const recomputeVisible = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const containerWidth = container.clientWidth;
    if (containerWidth <= 0) {
      setVisibleGroupCount(0);
      return;
    }

    const chipEls = Array.from(measure.querySelectorAll<HTMLElement>("[data-chip]"));
    if (chipEls.length < 3) {
      setVisibleGroupCount(groups.length);
      return;
    }

    const fixedWidth =
      chipEls[0].offsetWidth + CATEGORY_GAP + chipEls[1].offsetWidth;
    const showAllWidth = chipEls[chipEls.length - 1].offsetWidth;
    const groupChips = chipEls.slice(2, -1);

    let used = fixedWidth;
    let fit = 0;

    for (let index = 0; index < groupChips.length; index += 1) {
      const chipWidth = groupChips[index].offsetWidth;
      const gap = CATEGORY_GAP;
      const withChip = used + gap + chipWidth;
      const remaining = groupChips.length - (index + 1);
      const required =
        remaining > 0 ? withChip + CATEGORY_GAP + showAllWidth : withChip;

      if (required > containerWidth) break;

      used = withChip;
      fit += 1;
    }

    setVisibleGroupCount(fit);
  }, [groups]);

  useLayoutEffect(() => {
    recomputeVisible();

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => recomputeVisible());
    observer.observe(container);
    return () => observer.disconnect();
  }, [groups, recomputeVisible]);

  const hiddenGroupCount = Math.max(0, groups.length - visibleGroupCount);
  const showToggle = hiddenGroupCount > 0;
  const visibleGroups = groups.slice(0, visibleGroupCount);

  return (
    <div className={styles.categoriesWrap}>
      <div ref={measureRef} className={styles.categoriesMeasure} aria-hidden>
        <button type="button" className={clsx(styles.chip, styles.chipIcon)} data-chip>
          <Star size={14} />
        </button>
        <button type="button" className={styles.chip} data-chip>
          All
        </button>
        {groups.map((group) => (
          <button key={group.id} type="button" className={styles.chip} data-chip>
            {group.name}
          </button>
        ))}
        <button type="button" className={styles.chip} data-chip>
          Show all
        </button>
      </div>

      <div ref={containerRef} className={styles.categories}>
        <button
          type="button"
          className={clsx(styles.chip, styles.chipIcon, featuredOnly && styles.chipActive)}
          onClick={onSelectFeatured}
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
          onClick={onSelectAll}
        >
          All
        </button>
        {visibleGroups.map((group) => (
          <button
            key={group.id}
            type="button"
            className={clsx(
              styles.chip,
              !featuredOnly && selectedGroupId === group.id && styles.chipActive,
            )}
            onClick={() => onSelectGroup(group.id)}
            title={group.path}
          >
            {group.name}
          </button>
        ))}
        {showToggle ? (
          <button
            type="button"
            className={clsx(styles.chip, styles.chipShowAll)}
            onClick={() => setModalOpen(true)}
          >
            Show all
          </button>
        ) : null}
      </div>

      <CategoryPickerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        groups={groups}
        featuredOnly={featuredOnly}
        selectedGroupId={selectedGroupId}
        onSelectFeatured={onSelectFeatured}
        onSelectAll={onSelectAll}
        onSelectGroup={onSelectGroup}
      />
    </div>
  );
}
