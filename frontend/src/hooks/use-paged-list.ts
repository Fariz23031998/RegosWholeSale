import { useCallback, useEffect, useRef, useState } from "react";

export const DOCUMENT_LIST_PAGE_SIZE = 100;

export type PagedListPage<T> = {
  items: T[];
  next_offset: number;
  total: number;
};

export function listHasMore(
  loadedCount: number,
  nextOffset: number,
  total: number,
  lastPageCount: number,
  pageSize: number,
): boolean {
  if (total > 0 && loadedCount < total) return true;
  if (nextOffset > loadedCount) return true;
  if (total <= 0 && lastPageCount >= pageSize) return true;
  return false;
}

type UsePagedListOptions<T extends { id: number }> = {
  enabled: boolean;
  /** Changing this resets the list and reloads from offset 0. */
  depsKey: string;
  pageSize?: number;
  fetchPage: (args: { offset: number; limit: number }) => Promise<PagedListPage<T>>;
  mapError?: (err: unknown) => string;
};

export function usePagedList<T extends { id: number }>({
  enabled,
  depsKey,
  pageSize = DOCUMENT_LIST_PAGE_SIZE,
  fetchPage,
  mapError,
}: UsePagedListOptions<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [lastPageCount, setLastPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const mapErrorRef = useRef(mapError);
  mapErrorRef.current = mapError;
  const loadingMoreRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const nextOffsetRef = useRef(nextOffset);
  nextOffsetRef.current = nextOffset;
  const totalRef = useRef(total);
  totalRef.current = total;
  const lastPageCountRef = useRef(lastPageCount);
  lastPageCountRef.current = lastPageCount;

  const hasMore = listHasMore(items.length, nextOffset, total, lastPageCount, pageSize);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setTotal(0);
      setNextOffset(0);
      setLastPageCount(0);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    setItems([]);
    setTotal(0);
    setNextOffset(0);
    setLastPageCount(0);

    void fetchPageRef
      .current({ offset: 0, limit: pageSize })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
        setNextOffset(res.next_offset);
        setLastPageCount(res.items.length);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        setNextOffset(0);
        setLastPageCount(0);
        setError(mapErrorRef.current?.(err) ?? (err instanceof Error ? err.message : "Request failed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [depsKey, enabled, pageSize]);

  const loadMore = useCallback(async () => {
    if (!enabled || loading || loadingMoreRef.current) return;
    if (
      !listHasMore(
        itemsRef.current.length,
        nextOffsetRef.current,
        totalRef.current,
        lastPageCountRef.current,
        pageSize,
      )
    ) {
      return;
    }

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError("");
    const offset =
      nextOffsetRef.current > 0 ? nextOffsetRef.current : itemsRef.current.length;

    try {
      const res = await fetchPageRef.current({ offset, limit: pageSize });
      const seen = new Set(itemsRef.current.map((item) => item.id));
      const appended = res.items.filter((item) => !seen.has(item.id));
      if (appended.length === 0) {
        setTotal(res.total > 0 ? res.total : itemsRef.current.length);
        setNextOffset(0);
        setLastPageCount(0);
        return;
      }
      setItems((prev) => [...prev, ...appended]);
      setTotal(res.total);
      setNextOffset(res.next_offset);
      setLastPageCount(res.items.length);
    } catch (err: unknown) {
      setError(mapErrorRef.current?.(err) ?? (err instanceof Error ? err.message : "Request failed"));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [enabled, loading, pageSize]);

  return {
    items,
    setItems,
    total,
    setTotal,
    loading,
    loadingMore,
    error,
    setError,
    hasMore,
    loadMore,
  };
}
