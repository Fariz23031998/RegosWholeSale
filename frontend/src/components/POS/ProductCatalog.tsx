import { Camera, ImageOff, Search, Undo2 } from "lucide-react";
import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import { useBookedOrderContinuation } from "@/hooks/use-booked-order-continuation";
import { usePermissions } from "@/hooks/use-permissions";
import { fetchCatalogProducts, fetchProductGroups } from "@/lib/catalog-api";
import { canAddProductToCart } from "@/lib/cart-stock";
import { isBarcodeInput } from "@/lib/barcode";
import {
  lookupProductForBarcode,
  type BarcodeLookupFailureReason,
} from "@/lib/barcode-lookup";
import {
  addFeaturedProduct,
  fetchFeaturedProductIds,
  removeFeaturedProduct,
} from "@/lib/featured-api";
import { formatAuthError, useAuth } from "@/store/auth";
import { useCatalog } from "@/store/catalog";
import { useCheckoutTabs, getReservedQtyInOtherTabs } from "@/store/checkout-tabs";
import { useCart } from "@/store/cart";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";
import { applyDefaultCategory } from "@/lib/default-category";
import {
  catalogCanLoadMore,
  catalogEffectiveNextOffset,
  catalogHasMore,
  CATALOG_PAGE_SIZE,
  nextCatalogCursor,
} from "@/lib/catalog-pagination";
import type { Product } from "@/types/catalog";
import type { ProductGroup } from "@/types/catalog";
import { CategoryBar } from "./CategoryBar";
import { CatalogProductCard } from "./CatalogProductCard";
import { ReturnModal } from "@/components/Returns/ReturnModal";
import { toast } from "sonner";
import styles from "./POS.module.css";

const BarcodeScannerModal = lazy(() =>
  import("./BarcodeScannerModal").then((mod) => ({ default: mod.BarcodeScannerModal })),
);

function barcodeLookupErrorMessage(
  reason: BarcodeLookupFailureReason,
  t: (key: string, fallback: string) => string,
): string {
  switch (reason) {
    case "invalid_qty":
      return t(
        "pos.barcode.invalidQty",
        "This barcode quantity is not valid for the product unit.",
      );
    case "out_of_stock":
      return t("pos.barcode.outOfStock", "Cannot add more of this product to the cart.");
    default:
      return t("pos.barcode.productNotFound", "No product found for this barcode.");
  }
}

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

function getInCartQty(productId: string): number {
  return useCart.getState().items.find((item) => item.productId === productId)?.qty ?? 0;
}

export function ProductCatalog() {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const { canChangeWarehouse, canChangePriceType, canChangePosContext } = usePermissions();
  const canChangeWarehousePerm = canChangeWarehouse();
  const canChangePriceTypePerm = canChangePriceType();
  const canChangePosContextPerm = canChangePosContext();
  const products = useCatalog((s) => s.products);
  const setProducts = useCatalog((s) => s.setProducts);
  const appendProducts = useCatalog((s) => s.appendProducts);
  const refreshNonce = useCatalog((s) => s.refreshNonce);
  const add = useCart((s) => s.add);
  const addWithQty = useCart((s) => s.addWithQty);
  const checkoutTabs = useCheckoutTabs((s) => s.tabs);
  const activeCheckoutTabId = useCheckoutTabs((s) => s.activeTabId);
  const allowOutOfStock = usePosConfig((s) => s.allowOutOfStock);
  const bookedOrderContinuation = useBookedOrderContinuation();
  const catalogStockOptions = bookedOrderContinuation
    ? { bookedOrderContinuation: true as const }
    : undefined;
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
  const [scannerOpen, setScannerOpen] = useState(false);
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
      void hydrateSellContext(token, canChangePosContextPerm, {
        force: true,
        userId: user?.id,
        companyId: user?.company_id,
      });
      void hydratePosConfig(token, { force: true });
    }, PREPARE_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [
    canChangePosContextPerm,
    hydratePosConfig,
    hydrateSellContext,
    isPreparing,
    token,
    user?.company_id,
    user?.id,
  ]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const isGlobalSearch = search.length > 0;

  const catalogOverrides = useMemo(() => {
    const overrides: { warehouseId?: number; priceTypeId?: number } = {};
    if (canChangeWarehousePerm && warehouseId) overrides.warehouseId = warehouseId;
    if (canChangePriceTypePerm && priceTypeId) overrides.priceTypeId = priceTypeId;
    return overrides;
  }, [canChangePriceTypePerm, canChangeWarehousePerm, priceTypeId, warehouseId]);

  const getReservedInOtherTabs = useCallback(
    (productId: string) =>
      getReservedQtyInOtherTabs(checkoutTabs, activeCheckoutTabId, productId),
    [activeCheckoutTabId, checkoutTabs],
  );

  const canAddToCart = useCallback(
    (product: Product) => {
      const inCart = getInCartQty(product.id);
      return canAddProductToCart(
        product,
        inCart,
        allowOutOfStock,
        getReservedInOtherTabs(product.id),
        catalogStockOptions,
      );
    },
    [allowOutOfStock, catalogStockOptions, getReservedInOtherTabs],
  );

  const firstAddableProduct = (items: Product[]) =>
    items.find((product) => canAddToCart(product));

  const handleAddToCart = useCallback(
    (product: Product) => {
      if (
        !canAddProductToCart(
          product,
          getInCartQty(product.id),
          allowOutOfStock,
          getReservedInOtherTabs(product.id),
          catalogStockOptions,
        )
      ) {
        return;
      }
      startTransition(() => {
        add(product);
      });
    },
    [add, allowOutOfStock, catalogStockOptions, getReservedInOtherTabs],
  );

  const catalogFetchParams = useCallback(
    (offset: number) => ({
      offset,
      limit: PAGE_SIZE,
      search,
      groupId: isGlobalSearch ? null : selectedGroupId,
      featuredOnly: isGlobalSearch ? false : featuredOnly,
      ...(Object.keys(catalogOverrides).length > 0 ? catalogOverrides : {}),
    }),
    [catalogOverrides, featuredOnly, isGlobalSearch, search, selectedGroupId],
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
    if (!canChangePosContextPerm || !sellContextHydrated) return;

    const prev = prevCatalogContextRef.current;
    const catalogContextChanged =
      prev.warehouseId !== warehouseId || prev.priceTypeId !== priceTypeId;
    prevCatalogContextRef.current = { warehouseId, priceTypeId };

    if (catalogContextChanged && (prev.warehouseId !== null || prev.priceTypeId !== null)) {
      clearCart();
    }
  }, [canChangePosContextPerm, clearCart, priceTypeId, sellContextHydrated, warehouseId]);

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
    void hydrateSellContext(token, canChangePosContextPerm, {
      force: true,
      userId: user?.id,
      companyId: user?.company_id,
    });
    void hydratePosConfig(token, { force: true });
  };

  const toggleFeatured = useCallback(
    async (product: Product) => {
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
    },
    [featuredIds, featuredOnly, products, setProducts, token],
  );

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
          ...(Object.keys(catalogOverrides).length > 0 ? catalogOverrides : {}),
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

  const barcodeLookupOptions = useMemo(
    () => ({
      prefixes: {
        weightPrefix: internalBarcodeWeightPrefix,
        piecePrefix: internalBarcodePiecePrefix,
      },
      catalogOverrides,
      allowOutOfStock,
      bookedOrderContinuation,
      getInCartQty,
      getReservedInOtherTabs,
    }),
    [
      allowOutOfStock,
      bookedOrderContinuation,
      catalogOverrides,
      getReservedInOtherTabs,
      internalBarcodePiecePrefix,
      internalBarcodeWeightPrefix,
    ],
  );

  const submitBarcodeScan = async (term: string) => {
    if (!term || !token) return;

    try {
      const result = await lookupProductForBarcode(token, term, barcodeLookupOptions);
      if (!result.ok) {
        setError(barcodeLookupErrorMessage(result.reason, t));
        return;
      }

      startTransition(() => {
        if (result.qty === 1) {
          add(result.product);
        } else {
          addWithQty(result.product, result.qty, { skipKeypad: true });
        }
      });
      setError("");
      setQ("");
      setSearch("");
    } catch (err) {
      setError(formatAuthError(err));
    }
  };

  const handleCameraBarcodeScan = useCallback(
    async (term: string) => {
      if (!term || !token) return;

      try {
        const result = await lookupProductForBarcode(token, term, barcodeLookupOptions);
        if (!result.ok) {
          toast.error(barcodeLookupErrorMessage(result.reason, t));
          return;
        }

        startTransition(() => {
          if (result.qty === 1) {
            add(result.product);
          } else {
            addWithQty(result.product, result.qty, { skipKeypad: true });
          }
        });
        toast.success(
          t("pos.barcode.scanSuccess", "Added {{name}} to cart", {
            name: result.product.name,
          }),
        );
        setScannerOpen(false);
      } catch (err) {
        toast.error(formatAuthError(err));
      }
    },
    [add, addWithQty, barcodeLookupOptions, t, token],
  );

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
          <div className={clsx(styles.search, styles.searchWithScan)}>
            <Search size={16} className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              placeholder={t("pos.searchPlaceholder", "Search by name or SKU...")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button
              type="button"
              className={styles.searchScanBtn}
              aria-label={t("pos.scanBarcodeAria", "Scan barcode with camera")}
              title={t("pos.scanBarcode", "Scan barcode")}
              onClick={() => setScannerOpen(true)}
            >
              <Camera size={24} />
            </button>
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
              {products.map((p) => (
                <CatalogProductCard
                  key={p.id}
                  product={p}
                  categoryName={selectedGroup?.name ?? p.category}
                  hideCardImages={hideCardImages}
                  isFeatured={featuredIds.has(productIdNumber(p))}
                  isMobile={isMobile}
                  view={view}
                  allowOutOfStock={allowOutOfStock}
                  reservedInOtherTabs={getReservedInOtherTabs(p.id)}
                  bookedOrderContinuation={bookedOrderContinuation}
                  onAdd={handleAddToCart}
                  onToggleFeatured={toggleFeatured}
                />
              ))}
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
      {scannerOpen ? (
        <Suspense fallback={null}>
          <BarcodeScannerModal
            open={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onScan={handleCameraBarcodeScan}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
