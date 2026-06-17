import { Star } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { ProductGroup } from "@/types/catalog";
import styles from "./POS.module.css";

const CATEGORY_GAP = 8;
const MIN_PRODUCT_GRID_HEIGHT = 180;

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
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [visibleGroupCount, setVisibleGroupCount] = useState(groups.length);
  const [expandedMaxHeight, setExpandedMaxHeight] = useState<number | null>(null);

  const recomputeExpandedMaxHeight = useCallback(() => {
    const wrap = wrapRef.current;
    const catalog = wrap?.parentElement;
    if (!wrap || !catalog) return;

    const wrapTop = wrap.getBoundingClientRect().top;
    const catalogBottom = catalog.getBoundingClientRect().bottom;
    const maxHeight = catalogBottom - wrapTop - MIN_PRODUCT_GRID_HEIGHT;

    setExpandedMaxHeight(Math.max(96, Math.floor(maxHeight)));
  }, []);

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
    if (expanded) return;

    recomputeVisible();

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => recomputeVisible());
    observer.observe(container);
    return () => observer.disconnect();
  }, [expanded, groups, recomputeVisible]);

  useLayoutEffect(() => {
    if (!expanded) {
      setExpandedMaxHeight(null);
      return;
    }

    recomputeExpandedMaxHeight();

    const catalog = wrapRef.current?.parentElement;
    if (!catalog) return;

    const observer = new ResizeObserver(() => recomputeExpandedMaxHeight());
    observer.observe(catalog);
    window.addEventListener("resize", recomputeExpandedMaxHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recomputeExpandedMaxHeight);
    };
  }, [expanded, recomputeExpandedMaxHeight]);

  const hiddenGroupCount = Math.max(0, groups.length - visibleGroupCount);
  const showToggle = !expanded && hiddenGroupCount > 0;
  const visibleGroups = expanded ? groups : groups.slice(0, visibleGroupCount);

  return (
    <div ref={wrapRef} className={styles.categoriesWrap}>
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

      <div
        ref={containerRef}
        className={clsx(styles.categories, expanded && styles.categoriesExpanded)}
        style={expanded && expandedMaxHeight ? { maxHeight: expandedMaxHeight } : undefined}
      >
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
            onClick={() => setExpanded(true)}
          >
            Show all
          </button>
        ) : null}
        {expanded && groups.length > 0 ? (
          <button
            type="button"
            className={clsx(styles.chip, styles.chipShowAll)}
            onClick={() => setExpanded(false)}
          >
            Show less
          </button>
        ) : null}
      </div>
    </div>
  );
}
