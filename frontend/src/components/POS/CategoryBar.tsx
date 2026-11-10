import { Star } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ProductGroup } from "@/types/catalog";
import { CategoryPickerModal } from "./CategoryPickerModal";
import styles from "./POS.module.css";

const CATEGORY_GAP = 8;

type Props = {
  groups: ProductGroup[];
  featuredOnly: boolean;
  showFeatured?: boolean;
  selectedGroupId: number | null;
  onSelectFeatured?: () => void;
  onSelectAll: () => void;
  onSelectGroup: (groupId: number) => void;
  className?: string;
};

export function CategoryBar({
  groups,
  featuredOnly,
  showFeatured = true,
  selectedGroupId,
  onSelectFeatured,
  onSelectAll,
  onSelectGroup,
  className,
}: Props) {
  const { t } = useLanguage();
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
    const prefixCount = showFeatured ? 2 : 1;
    if (chipEls.length < prefixCount + 1) {
      setVisibleGroupCount(groups.length);
      return;
    }

    let fixedWidth = 0;
    for (let index = 0; index < prefixCount; index += 1) {
      fixedWidth += chipEls[index].offsetWidth;
      if (index > 0) fixedWidth += CATEGORY_GAP;
    }
    const showAllWidth = chipEls[chipEls.length - 1].offsetWidth;
    const groupChips = chipEls.slice(prefixCount, -1);

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
  }, [groups, showFeatured]);

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
    <div className={clsx(styles.categoriesWrap, className)}>
      <div ref={measureRef} className={styles.categoriesMeasure} aria-hidden>
        {showFeatured ? (
          <button type="button" className={clsx(styles.chip, styles.chipIcon)} data-chip>
            <Star size={14} />
          </button>
        ) : null}
        <button type="button" className={styles.chip} data-chip>
          {t("pos.categories.all", "All")}
        </button>
        {groups.map((group) => (
          <button key={group.id} type="button" className={styles.chip} data-chip>
            {group.name}
          </button>
        ))}
        <button type="button" className={styles.chip} data-chip>
          {t("pos.categories.showAll", "Show all")}
        </button>
      </div>

      <div ref={containerRef} className={styles.categories}>
        {showFeatured ? (
          <button
            type="button"
            className={clsx(styles.chip, styles.chipIcon, featuredOnly && styles.chipActive)}
            onClick={() => onSelectFeatured?.()}
            aria-label={t("pos.categories.featuredAria", "Featured products")}
            title={t("pos.categories.featured", "Featured")}
          >
            <Star size={14} fill={featuredOnly ? "currentColor" : "none"} />
          </button>
        ) : null}
        <button
          type="button"
          className={clsx(
            styles.chip,
            !featuredOnly && selectedGroupId === null && styles.chipActive,
          )}
          onClick={onSelectAll}
        >
          {t("pos.categories.all", "All")}
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
            {t("pos.categories.showAll", "Show all")}
          </button>
        ) : null}
      </div>

      <CategoryPickerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        groups={groups}
        featuredOnly={featuredOnly}
        showFeatured={showFeatured}
        selectedGroupId={selectedGroupId}
        onSelectFeatured={onSelectFeatured}
        onSelectAll={onSelectAll}
        onSelectGroup={onSelectGroup}
      />
    </div>
  );
}
