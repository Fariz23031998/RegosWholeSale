import { useEffect, useRef } from "react";

/**
 * Observes a bottom sentinel and calls onLoadMore when it nears the viewport.
 * Re-attaches when `itemsLength` changes so auto-fill continues if the sentinel
 * stays visible after appending a page.
 */
export function useInfiniteScrollSentinel(
  onLoadMore: () => void,
  options: {
    enabled: boolean;
    itemsLength: number;
    rootMargin?: string;
  },
) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    if (!options.enabled) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMoreRef.current();
        }
      },
      { root: null, rootMargin: options.rootMargin ?? "240px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [options.enabled, options.itemsLength, options.rootMargin]);

  return sentinelRef;
}
