import { ImageOff, Search, Star, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import { fetchCatalogProducts, fetchProductGroups } from "@/lib/catalog-api";
import { canAddProductToCart, clampCartQty } from "@/lib/cart-stock";
import {
  findProductByBarcode,
  findProductByCode,
  internalBarcodeToQty,
  isBarcodeInput,
  parseInternalBarcode,
} from "@/lib/barcode";
import {
  addFeaturedProduct,
  fetchFeaturedProductIds,
  removeFeaturedProduct,
} from "@/lib/featured-api";
import { formatAuthError, useAuth } from "@/store/auth";
import { useCatalog } from "@/store/catalog";
import { useCart } from "@/store/cart";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";
import { formatCurrency } from "@/lib/format";
import { applyDefaultCategory } from "@/lib/default-category";
import {
  catalogCanLoadMore,
  catalogEffectiveNextOffset,
  catalogHasMore,
  CATALOG_PAGE_SIZE,
  nextCatalogCursor,
} from "@/lib/catalog-pagination";
import { PRODUCT_FALLBACK_IMAGE } from "@/lib/product-image";
import type { Product } from "@/types/catalog";
import type { ProductGroup } from "@/types/catalog";
import { CategoryBar } from "./CategoryBar";
import { ReturnModal } from "@/components/Returns/ReturnModal";
import styles from "./POS.module.css";

const PAGE_SIZE = CATALOG_PAGE_SIZE;
const PREPARE_TIMEOUT_MS = 15_000;
const MAX_GRID_FILL_ROUNDS = 50;

function applyCatalogPage(
  res: { products: Product[] },
  mode: "replace" | "append",
  loadedCount: number,
  setProducts: (products: Product[]) => void,
  appendProducts: (products: Product[]) => void,
): number {
  if (mode === "replace") {
    setProducts(res.products);
    return res.products.length;
  }
  if (res.products.length > 0) {
    appendProducts(res.products);
    return useCatalog.getState().products.length;
  }
  return loadedCount;
}

function productIdNumber(product: Product): number {
  if (typeof product.regos_item_id === "number") return product.regos_item_id;
  const parsed = Number.parseInt(product.id, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function productDisplayName(product: Product): string {
  const unitName = product.unit_name?.trim();
  if (!unitName) return product.name;
  return `${product.name} (${unitName})`;
}

function productCodeLine(product: Product): string {
  const code = product.code?.trim();
  const barcode = product.barcode?.trim();
  if (code && barcode) return `${code} · ${barcode}`;
  return code || barcode || product.sku;
}

export function ProductCatalog() {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const canOverrideRegos = Boolean(user?.permissions.includes("pos.override_regos"));
  const products = useCatalog((s) => s.products);
  const setProducts = useCatalog((s) => s.setProducts);
  const appendProducts = useCatalog((s) => s.appendProducts);
  const refreshNonce = useCatalog((s) => s.refreshNonce);
  const add = useCart((s) => s.add);
  const addWithQty = useCart((s) => s.addWithQty);
  const cartItems = useCart((s) => s.items);
  const allowOutOfStock = usePosConfig((s) => s.allowOutOfStock);
  const internalBarcodeWeightPrefix = usePosConfig((s) => s.internalBarcodeWeightPrefix);
  const internalBarcodePiecePrefix = usePosConfig((s) => s.internalBarcodePiecePrefix);
  const posConfigHydrated = usePosConfig((s) => s.hydrated);
  const defaultCategory = usePosConfig((s) => s.defaultCategory);
  const hydratePosConfig = usePosConfig((s) => s.hydrate);
  const sellContextHydrated = useSellContext((s) => s.hydrated);
  const hydrateSellContext = useSellContext((s) => s.hydrate);
  const warehouseId = useSellContext((s) => s.warehouseId);
  const priceTypeId = useSellContext((s) => s.priceTypeId);
  const clearCart = useCart((s) => s.clear);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const isLoadingMoreRef = useRef(false);
  const isEnsuringGridRef = useRef(false);
  const isCatalogReloadingRef = useRef(false);
  const catalogLoadTokenRef = useRef("");
  const lastRequestedOffsetRef = useRef<number | null>(null);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const hideCardImages = useCatalog((s) => s.hideCardImages);
  const setHideCardImages = useCatalog((s) => s.setHideCardImages);
  const [returnOpen, setReturnOpen] = useState(false);
  const [categoryReady, setCategoryReady] = useState(false);
  const [featuredIds, setFeaturedIds] = useState<Set<number>>(() => new Set());
  const view = useCatalog((s) => s.mobileViewMode);
  const [isMobile, setIsMobile] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [nextOffset, setNextOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [lastPageProductCount, setLastPageProductCount] = useState(0);

  const isPreparing = Boolean(token && (!categoryReady || !sellContextHydrated || !posConfigHydrated));
  const isBarcodeMode = isBarcodeInput(q);

  useEffect(() => {
    if (isBarcodeMode) return;
    const timer = window.setTimeout(() => setSearch(q.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [isBarcodeMode, q]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!token) {
      setFeaturedIds(new Set());
      return;
    }

    let cancelled = false;

    void fetchFeaturedProductIds(token)
      .then((ids) => {
        if (!cancelled) setFeaturedIds(new Set(ids));
      })
      .catch(() => {
        if (!cancelled) setFeaturedIds(new Set());
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !posConfigHydrated) {
      if (!token) setCategoryReady(false);
      return;
    }

    const next = applyDefaultCategory(defaultCategory);
    setFeaturedOnly(next.featuredOnly);
    setSelectedGroupId(next.selectedGroupId);
    setCategoryReady(true);
  }, [defaultCategory, posConfigHydrated, token]);

  useEffect(() => {
    if (!isPreparing) return;

    const timer = window.setTimeout(() => {
      setCategoryReady(true);
      void hydrateSellContext(token, canOverrideRegos, { force: true });
      void hydratePosConfig(token, { force: true });
    }, PREPARE_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [canOverrideRegos, hydratePosConfig, hydrateSellContext, isPreparing, token]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const isGlobalSearch = search.length > 0;

  const catalogOverrides = useMemo(
    () =>
      canOverrideRegos
        ? {
            warehouseId: warehouseId ?? undefined,
            priceTypeId: priceTypeId ?? undefined,
          }
        : {},
    [canOverrideRegos, warehouseId, priceTypeId],
  );

  const cartQtyByProductId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of cartItems) {
      counts.set(item.productId, item.qty);
    }
    return counts;
  }, [cartItems]);

  const canAddToCart = (product: Product) => {
    const inCart = cartQtyByProductId.get(product.id) ?? 0;
    return canAddProductToCart(product, inCart, allowOutOfStock);
  };

  const firstAddableProduct = (items: Product[]) =>
    items.find((product) => canAddToCart(product));

  const handleAddToCart = (product: Product) => {
    if (!canAddToCart(product)) return;
    add(product);
  };

  const catalogFetchParams = useCallback(
    (offset: number) => ({
      offset,
      limit: PAGE_SIZE,
      search,
      groupId: isGlobalSearch ? null : selectedGroupId,
      featuredOnly: isGlobalSearch ? false : featuredOnly,
      ...(canOverrideRegos ? catalogOverrides : {}),
    }),
    [canOverrideRegos, catalogOverrides, featuredOnly, isGlobalSearch, search, selectedGroupId],
  );

  const catalogQueryKey = useMemo(
    () =>
      [
        search,
        selectedGroupId ?? "",
        featuredOnly ? "1" : "0",
        warehouseId ?? "",
        priceTypeId ?? "",
        refreshNonce,
      ].join("|"),
    [featuredOnly, priceTypeId, refreshNonce, search, selectedGroupId, warehouseId],
  );

  const catalogCursorRef = useRef(0);

  const applyCatalogResponse = useCallback(
    (res: { products: Product[]; next_offset: number; total: number }, loadedCount: number) => {
      const effectiveNextOffset = catalogEffectiveNextOffset(res, loadedCount, isGlobalSearch);
      setNextOffset(effectiveNextOffset);
      setTotal(res.total);
      setLastPageProductCount(res.products.length);
      catalogCursorRef.current = effectiveNextOffset;
      lastRequestedOffsetRef.current = null;
    },
    [isGlobalSearch],
  );

  const ensureMinimumGridProducts = useCallback(
    async (startOffset: number, mode: "replace" | "append") => {
      if (!token || isEnsuringGridRef.current) return;

      isEnsuringGridRef.current = true;
      let cursor = startOffset;
      let loadedCount = mode === "replace" ? 0 : useCatalog.getState().products.length;
      let pageMode: "replace" | "append" = mode;
      const maxGridFillRounds = isGlobalSearch ? 1 : MAX_GRID_FILL_ROUNDS;
      if (mode === "replace") {
        catalogCursorRef.current = 0;
      }

      try {
        for (let round = 0; round < maxGridFillRounds && loadedCount < PAGE_SIZE; round++) {
          const res = await fetchCatalogProducts(token, catalogFetchParams(cursor));
          const countBefore = loadedCount;

          loadedCount = applyCatalogPage(
            res,
            pageMode,
            loadedCount,
            setProducts,
            appendProducts,
          );
          pageMode = "append";

          applyCatalogResponse(res, loadedCount);

          if (isGlobalSearch || loadedCount >= PAGE_SIZE) break;

          const hasMore = catalogHasMore(res, cursor, loadedCount);
          if (!hasMore) break;

          const nextCursor = nextCatalogCursor(
            cursor,
            res.products.length,
            res.next_offset,
            res.total,
            loadedCount,
          );
          if (nextCursor <= cursor) break;

          const uniqueAdded = loadedCount - countBefore;
          if (uniqueAdded === 0 && res.products.length > 0) {
            if (res.next_offset > cursor) {
              cursor = res.next_offset;
              continue;
            }
            break;
          }

          cursor = nextCursor;
        }
      } finally {
        isEnsuringGridRef.current = false;
      }
    },
    [appendProducts, applyCatalogResponse, catalogFetchParams, isGlobalSearch, setProducts, token],
  );

  const prevCatalogContextRef = useRef({ warehouseId, priceTypeId });

  useEffect(() => {
    if (!canOverrideRegos || !sellContextHydrated) return;

    const prev = prevCatalogContextRef.current;
    const catalogContextChanged =
      prev.warehouseId !== warehouseId || prev.priceTypeId !== priceTypeId;
    prevCatalogContextRef.current = { warehouseId, priceTypeId };

    if (catalogContextChanged && (prev.warehouseId !== null || prev.priceTypeId !== null)) {
      clearCart();
    }
  }, [canOverrideRegos, clearCart, priceTypeId, sellContextHydrated, warehouseId]);

  useEffect(() => {
    if (!token || !categoryReady || !sellContextHydrated) {
      if (!token) setGroups([]);
      return;
    }

    let cancelled = false;

    void fetchProductGroups(token)
      .then((groupsRes) => {
        if (!cancelled) setGroups(groupsRes.groups);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });

    return () => {
      cancelled = true;
    };
  }, [categoryReady, sellContextHydrated, token]);

  useEffect(() => {
    if (!token || !categoryReady || !sellContextHydrated) {
      if (!token) {
        setProducts([]);
        setNextOffset(0);
        setTotal(0);
        setLastPageProductCount(0);
      }
      return;
    }

    const loadToken = catalogQueryKey;
    catalogLoadTokenRef.current = loadToken;
    isCatalogReloadingRef.current = true;
    lastRequestedOffsetRef.current = null;
    catalogCursorRef.current = 0;
    setNextOffset(0);
    setTotal(0);
    setLastPageProductCount(0);

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");
      setLoadMoreError("");
      try {
        await ensureMinimumGridProducts(0, "replace");
      } catch (err) {
        if (cancelled || catalogLoadTokenRef.current !== loadToken) return;
        lastRequestedOffsetRef.current = null;
        setProducts([]);
        setNextOffset(0);
        setTotal(0);
        setLastPageProductCount(0);
        setError(formatAuthError(err));
      } finally {
        if (!cancelled && catalogLoadTokenRef.current === loadToken) {
          setLoading(false);
          isCatalogReloadingRef.current = false;
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (catalogLoadTokenRef.current === loadToken) {
        isCatalogReloadingRef.current = false;
      }
    };
  }, [
    catalogQueryKey,
    categoryReady,
    ensureMinimumGridProducts,
    sellContextHydrated,
    setProducts,
    token,
  ]);

  const canLoadMore = catalogCanLoadMore(
    nextOffset,
    total,
    products.length,
    isGlobalSearch,
    lastPageProductCount,
  );

  const loadMore = useCallback(
    async (forcedOffset?: number) => {
      if (isCatalogReloadingRef.current || loading) return;

      const requestOffset =
        forcedOffset ?? (nextOffset > 0 ? nextOffset : catalogCursorRef.current);
      if (!token || isLoadingMoreRef.current) return;
      if (requestOffset <= 0) return;
      if (lastRequestedOffsetRef.current === requestOffset) return;
      if (
        isGlobalSearch &&
        !catalogCanLoadMore(
          requestOffset,
          total,
          products.length,
          true,
          lastPageProductCount,
        )
      ) {
        return;
      }

      isLoadingMoreRef.current = true;
      lastRequestedOffsetRef.current = requestOffset;
      setLoadingMore(true);
      setLoadMoreError("");
      try {
        const countBefore = useCatalog.getState().products.length;

        if (!isGlobalSearch && countBefore < PAGE_SIZE) {
          await ensureMinimumGridProducts(requestOffset, "append");
          return;
        }

        const res = await fetchCatalogProducts(token, catalogFetchParams(requestOffset));
        if (res.products.length > 0) {
          appendProducts(res.products);
        }
        applyCatalogResponse(res, useCatalog.getState().products.length);
      } catch (err) {
        lastRequestedOffsetRef.current = null;
        setLoadMoreError(formatAuthError(err));
      } finally {
        isLoadingMoreRef.current = false;
        setLoadingMore(false);
      }
    },
    [
      appendProducts,
      applyCatalogResponse,
      catalogFetchParams,
      ensureMinimumGridProducts,
      isGlobalSearch,
      lastPageProductCount,
      loading,
      nextOffset,
      products.length,
      token,
      total,
    ],
  );

  const fillViewportIfNeeded = useCallback(() => {
    if (isCatalogReloadingRef.current || loading || loadingMore) return;

    const el = gridRef.current;
    const needsMoreProducts =
      !isGlobalSearch && products.length < PAGE_SIZE && nextOffset > 0;

    if (
      !isLoadingMoreRef.current &&
      !isEnsuringGridRef.current &&
      !error &&
      !isPreparing &&
      needsMoreProducts
    ) {
      void ensureMinimumGridProducts(nextOffset, "append");
      return;
    }

    if (!el || isLoadingMoreRef.current || error || isPreparing || isGlobalSearch) {
      return;
    }

    if (!canLoadMore || products.length === 0) return;

    const remaining = el.scrollHeight - el.clientHeight;
    if (remaining <= 240) {
      void loadMore();
    }
  }, [
    canLoadMore,
    ensureMinimumGridProducts,
    error,
    isGlobalSearch,
    isPreparing,
    loadMore,
    loading,
    loadingMore,
    nextOffset,
    products.length,
  ]);

  useEffect(() => {
    fillViewportIfNeeded();
  }, [fillViewportIfNeeded, products.length, nextOffset, loading, loadingMore, canLoadMore]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => fillViewportIfNeeded());
    ro.observe(el);
    window.addEventListener("resize", fillViewportIfNeeded);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fillViewportIfNeeded);
    };
  }, [fillViewportIfNeeded]);

  const handleGridScroll = () => {
    const el = gridRef.current;
    if (!el || loading || isLoadingMoreRef.current || !canLoadMore) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < 240) {
      void loadMore();
    }
  };

  const fetchCatalogPage = async () => {
    if (!token) return;

    lastRequestedOffsetRef.current = null;
    const groupsRes = await fetchProductGroups(token);
    setGroups(groupsRes.groups);
    await ensureMinimumGridProducts(0, "replace");
  };

  const retry = async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    setLoadMoreError("");
    try {
      await fetchCatalogPage();
    } catch (err) {
      lastRequestedOffsetRef.current = null;
      setProducts([]);
      setGroups([]);
      setNextOffset(0);
      setTotal(0);
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const retryStartup = () => {
    if (!token) return;
    setError("");
    setLoadMoreError("");
    setCategoryReady(false);
    void hydrateSellContext(token, canOverrideRegos, { force: true });
    void hydratePosConfig(token, { force: true });
  };

  const toggleFeatured = async (product: Product) => {
    if (!token) return;
    const productId = productIdNumber(product);
    if (productId <= 0) return;

    const isFeatured = featuredIds.has(productId);
    try {
      const res = isFeatured
        ? await removeFeaturedProduct(token, productId)
        : await addFeaturedProduct(token, productId);
      setFeaturedIds(new Set(res.product_ids));
      if (featuredOnly && isFeatured) {
        setProducts(products.filter((item) => productIdNumber(item) !== productId));
        setTotal((value) => Math.max(0, value - 1));
      }
    } catch (err) {
      setError(formatAuthError(err));
    }
  };

  const submitSearchAddFirst = async (term: string) => {
    if (!term || !token) return;

    let firstProduct: Product | undefined;

    if (search === term && !loading) {
      firstProduct = firstAddableProduct(products);
    } else {
      try {
        const res = await fetchCatalogProducts(token, {
          offset: 0,
          limit: PAGE_SIZE,
          search: term,
          groupId: null,
          featuredOnly: false,
          ...(canOverrideRegos ? catalogOverrides : {}),
        });
        firstProduct = firstAddableProduct(res.products);
      } catch (err) {
        setError(formatAuthError(err));
        return;
      }
    }

    if (firstProduct) handleAddToCart(firstProduct);
    setQ("");
    setSearch("");
  };

  const submitBarcodeScan = async (term: string) => {
    if (!term || !token) return;

    const prefixes = {
      weightPrefix: internalBarcodeWeightPrefix,
      piecePrefix: internalBarcodePiecePrefix,
    };
    const parsedInternal = parseInternalBarcode(term, prefixes);

    try {
      if (parsedInternal) {
        const res = await fetchCatalogProducts(token, {
          offset: 0,
          limit: PAGE_SIZE,
          search: parsedInternal.productCode,
          groupId: null,
          featuredOnly: false,
          ...(canOverrideRegos ? catalogOverrides : {}),
        });
        const product = findProductByCode(res.products, parsedInternal.productCode);
        if (!product) {
          setError(
            t("pos.barcode.productNotFound", "No product found for this barcode."),
          );
          return;
        }

        const barcodeQty = internalBarcodeToQty(parsedInternal, product);
        if (barcodeQty == null || barcodeQty <= 0) {
          setError(
            t(
              "pos.barcode.invalidQty",
              "This barcode quantity is not valid for the product unit.",
            ),
          );
          return;
        }

        const inCart = cartQtyByProductId.get(product.id) ?? 0;
        const clampedTotal = clampCartQty(
          inCart + barcodeQty,
          product.stock,
          allowOutOfStock,
          product.unit_type,
        );
        const qtyToAdd = clampedTotal - inCart;
        if (qtyToAdd <= 0) {
          setError(
            t("pos.barcode.outOfStock", "Cannot add more of this product to the cart."),
          );
          return;
        }

        addWithQty(product, qtyToAdd, { skipKeypad: true });
        setError("");
        setQ("");
        setSearch("");
        return;
      }

      const res = await fetchCatalogProducts(token, {
        offset: 0,
        limit: PAGE_SIZE,
        search: term,
        groupId: null,
        featuredOnly: false,
        ...(canOverrideRegos ? catalogOverrides : {}),
      });
      const product = findProductByBarcode(res.products, term);
      if (!product || !canAddToCart(product)) {
        setError(
          t("pos.barcode.productNotFound", "No product found for this barcode."),
        );
        return;
      }

      handleAddToCart(product);
      setError("");
      setQ("");
      setSearch("");
    } catch (err) {
      setError(formatAuthError(err));
    }
  };

  const submitSearch = async (term: string) => {
    if (isBarcodeInput(term)) {
      await submitBarcodeScan(term);
      return;
    }
    await submitSearchAddFirst(term);
  };

  return (
    <div className={styles.catalog}>
      <div className={styles.catalogToolbar}>
        <form
          className={styles.searchRow}
          onSubmit={(event) => {
            event.preventDefault();
            void submitSearch(q.trim());
          }}
        >
          <div className={styles.search}>
            <Search size={16} className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              placeholder={t("pos.searchPlaceholder", "Search by name or SKU...")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={clsx(
              styles.catalogFilterBtn,
              hideCardImages && styles.catalogFilterBtnActive,
            )}
            aria-label={t("pos.hideImagesAria", "Hide product images")}
            aria-pressed={hideCardImages}
            title={t("pos.hideImages", "Hide images")}
            onClick={() => setHideCardImages(!hideCardImages)}
          >
            <ImageOff size={16} />
            <span className={styles.catalogFilterBtnLabel}>{t("pos.hideImages", "Hide images")}</span>
          </button>
          <button
            type="button"
            className={clsx(styles.catalogFilterBtn, styles.catalogFilterBtnReturn)}
            aria-label={t("pos.returnAria", "Return products")}
            title={t("pos.return", "Return")}
            onClick={() => setReturnOpen(true)}
          >
            <Undo2 size={16} />
            <span className={styles.catalogFilterBtnLabel}>{t("pos.return", "Return")}</span>
          </button>
        </form>

        <CategoryBar
          groups={groups}
          featuredOnly={featuredOnly}
          selectedGroupId={selectedGroupId}
          onSelectFeatured={() => {
            setFeaturedOnly(true);
            setSelectedGroupId(null);
          }}
          onSelectAll={() => {
            setFeaturedOnly(false);
            setSelectedGroupId(null);
          }}
          onSelectGroup={(groupId) => {
            setFeaturedOnly(false);
            setSelectedGroupId(groupId);
          }}
        />
      </div>

      <div
        ref={gridRef}
        onScroll={handleGridScroll}
        className={styles.gridScroll}
      >
        {error ? (
          <div className={styles.statusBox}>
            <div>{error}</div>
            <div className={styles.statusActions}>
              <button type="button" className={styles.retryBtn} onClick={() => void retry()}>
                {t("pos.retry", "Retry")}
              </button>
              {isPreparing ? (
                <button type="button" className={styles.retryBtn} onClick={retryStartup}>
                  {t("pos.restartSetup", "Restart setup")}
                </button>
              ) : null}
            </div>
          </div>
        ) : isPreparing ? (
          <div className={styles.empty}>{t("pos.preparing", "Preparing catalog...")}</div>
        ) : loading ? (
          <div className={styles.empty}>{t("pos.loading", "Loading products from Regos...")}</div>
        ) : products.length === 0 ? (
          <div className={styles.empty}>
            {featuredOnly
              ? t("pos.emptyFeatured", "No featured products yet. Star items to add them here.")
              : t("pos.emptySearch", "No products match your search.")}
            <div className={styles.statusActions}>
              <button type="button" className={styles.retryBtn} onClick={() => void retry()}>
                {t("pos.refresh", "Refresh")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className={clsx(
                styles.grid,
                hideCardImages && styles.gridNoImages,
                isMobile && view === "single" && styles.gridSingle,
                isMobile && view === "double" && styles.gridDouble,
                isMobile && view === "list" && styles.gridList,
              )}
            >
              {products.map((p) => {
              const out = p.stock <= 0;
              const low = p.stock > 0 && p.stock < 10;
              const cannotAdd = !canAddToCart(p);
              const productId = productIdNumber(p);
              const isFeatured = featuredIds.has(productId);
              const stockText = Number.isInteger(p.stock)
                ? t("pos.stockLeft", "{{n}} left", { n: p.stock })
                : t("pos.stockLeft", "{{n}} left", {
                    n: p.stock.toFixed(2).replace(/\.?0+$/, ""),
                  });
              return (
                <div
                  key={p.id}
                  className={clsx(
                    styles.card,
                    hideCardImages && styles.cardNoImage,
                    cannotAdd && styles.cardDisabled,
                  )}
                  role="button"
                  tabIndex={cannotAdd ? -1 : 0}
                  aria-disabled={cannotAdd}
                  onClick={() => handleAddToCart(p)}
                  onKeyDown={(event) => {
                    if (cannotAdd) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleAddToCart(p);
                    }
                  }}
                >
                  {!hideCardImages ? (
                    <div className={styles.cardMedia}>
                      <img
                        src={p.image || PRODUCT_FALLBACK_IMAGE}
                        alt={p.name}
                        className={styles.cardImg}
                        loading="lazy"
                      />
                      <button
                        type="button"
                        className={clsx(styles.featureBtn, isFeatured && styles.featureBtnActive)}
                        aria-label={
                          isFeatured
                            ? t("pos.featuredRemove", "Remove from featured")
                            : t("pos.featuredAdd", "Add to featured")
                        }
                        aria-pressed={isFeatured}
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleFeatured(p);
                        }}
                      >
                        <Star size={15} fill={isFeatured ? "currentColor" : "none"} />
                      </button>
                    </div>
                  ) : null}
                  <div className={styles.cardBody}>
                    <div className={styles.cardBodyHead}>
                      <div className={styles.cardName}>{productDisplayName(p)}</div>
                      {hideCardImages ? (
                        <button
                          type="button"
                          className={clsx(
                            styles.featureBtn,
                            styles.featureBtnInline,
                            isFeatured && styles.featureBtnActive,
                          )}
                          aria-label={
                          isFeatured
                            ? t("pos.featuredRemove", "Remove from featured")
                            : t("pos.featuredAdd", "Add to featured")
                        }
                          aria-pressed={isFeatured}
                          onClick={(event) => {
                            event.stopPropagation();
                            void toggleFeatured(p);
                          }}
                        >
                          <Star size={15} fill={isFeatured ? "currentColor" : "none"} />
                        </button>
                      ) : null}
                    </div>
                    <div className={styles.cardCategory}>
                      {selectedGroup?.name ?? p.category}
                    </div>
                    <div className={styles.cardSku}>{productCodeLine(p)}</div>
                    <div className={styles.cardFoot}>
                      <div className={styles.cardPrice}>{formatCurrency(p.price)}</div>
                      <span
                        className={clsx(
                          styles.stockBadge,
                          out && styles.stockOut,
                          low && styles.stockLow,
                        )}
                      >
                        {out ? t("pos.outOfStock", "Out") : stockText}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>

            {loadMoreError ? (
              <div className={styles.statusBox}>
                <div>{loadMoreError}</div>
                <button type="button" className={styles.retryBtn} onClick={() => void loadMore()}>
                  {t("pos.retryLoadMore", "Retry loading more")}
                </button>
              </div>
            ) : null}

            {loadingMore ? (
              <div className={styles.loadingMore}>{t("pos.loadingMore", "Loading more products...")}</div>
            ) : null}

            {canLoadMore && !loadingMore ? (
              <div className={styles.loadMoreWrap}>
                <p className={styles.loadMoreHint}>
                  {total > products.length
                    ? t("pos.showingCount", "Showing {{n}} · more available", { n: products.length })
                    : t("pos.showingCount", "Showing {{n}} · more available", { n: products.length }).replace(
                        " · more available",
                        "",
                      )}
                </p>
                <button type="button" className={styles.loadMoreBtn} onClick={() => void loadMore()}>
                  {t("pos.loadMore", "Load more")}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <ReturnModal open={returnOpen} onClose={() => setReturnOpen(false)} />
    </div>
  );
}
