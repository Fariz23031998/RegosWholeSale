export const CATALOG_PAGE_SIZE = 20;

type CatalogPageMeta = {
  products: unknown[];
  next_offset: number;
  total: number;
};

export function catalogSearchExhausted(
  res: CatalogPageMeta,
  loadedCount: number,
  pageSize = CATALOG_PAGE_SIZE,
): boolean {
  if (res.total > 0 && loadedCount >= res.total && res.products.length < pageSize) {
    return true;
  }
  return res.products.length < pageSize;
}

export function catalogEffectiveNextOffset(
  res: CatalogPageMeta,
  loadedCount: number,
  isSearch: boolean,
  pageSize = CATALOG_PAGE_SIZE,
): number {
  if (!isSearch) return res.next_offset;
  if (catalogSearchExhausted(res, loadedCount, pageSize)) return 0;
  if (res.total > 0 && loadedCount >= res.total) return 0;
  return res.next_offset;
}

export function catalogCanLoadMore(
  nextOffset: number,
  total: number,
  loadedCount: number,
  isSearch: boolean,
  lastPageProductCount: number,
  pageSize = CATALOG_PAGE_SIZE,
): boolean {
  if (isSearch) {
    // A short page means the search is exhausted; Regos total is catalog-wide, not hit count.
    if (lastPageProductCount < pageSize) return false;
    return nextOffset > 0;
  }
  return nextOffset > 0 || (total > 0 && loadedCount < total);
}

export function catalogHasMore(
  res: CatalogPageMeta,
  cursor: number,
  loadedCount: number,
  pageSize = CATALOG_PAGE_SIZE,
): boolean {
  if (res.next_offset > cursor) return true;
  if (res.total > 0 && loadedCount < res.total) return true;
  // Regos sometimes omits total; a full client page usually means more rows exist.
  if (res.total <= 0 && res.products.length >= pageSize) return true;
  return false;
}

export function nextCatalogCursor(
  cursor: number,
  productsReturned: number,
  nextOffset: number,
  total: number,
  loadedCount: number,
  pageSize = CATALOG_PAGE_SIZE,
): number {
  if (nextOffset > cursor) return nextOffset;
  if (total > 0) {
    if (loadedCount >= total) return 0;
    if (productsReturned > 0) return nextOffset > 0 ? nextOffset : cursor + productsReturned;
    return 0;
  }
  if (nextOffset === 0 && productsReturned < pageSize) return 0;
  if (productsReturned > 0) return cursor + productsReturned;
  return 0;
}
