import { LayoutGrid, List, Search, Square, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { fetchCatalogProducts, fetchProductGroups } from "@/lib/catalog-api";
import { canAddProductToCart } from "@/lib/cart-stock";
import {
  addFeaturedProduct,
  fetchFeaturedProductIds,
  removeFeaturedProduct,
} from "@/lib/featured-api";
import { formatAuthError, useAuth } from "@/store/auth";
import { useCatalog } from "@/store/catalog";
import { useCart } from "@/store/cart";
import { usePosConfig } from "@/store/pos-config";
import { formatCurrency } from "@/lib/format";
import { applyDefaultCategory } from "@/lib/default-category";
import { fetchUserPosSettings } from "@/lib/settings-api";
import { PRODUCT_FALLBACK_IMAGE } from "@/lib/product-image";
import type { Product } from "@/types/catalog";
import type { ProductGroup } from "@/types/catalog";
import { CategoryBar } from "./CategoryBar";
import styles from "./POS.module.css";

type ViewMode = "single" | "double" | "list";

const PAGE_SIZE = 20;

function productIdNumber(product: Product): number {
  if (typeof product.regos_item_id === "number") return product.regos_item_id;
  const parsed = Number.parseInt(product.id, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function ProductCatalog() {
  const token = useAuth((s) => s.accessToken);
  const products = useCatalog((s) => s.products);
  const setProducts = useCatalog((s) => s.setProducts);
  const appendProducts = useCatalog((s) => s.appendProducts);
  const refreshNonce = useCatalog((s) => s.refreshNonce);
  const add = useCart((s) => s.add);
  const cartItems = useCart((s) => s.items);
  const allowOutOfStock = usePosConfig((s) => s.allowOutOfStock);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const isLoadingMoreRef = useRef(false);
  const lastRequestedOffsetRef = useRef<number | null>(null);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [categoryReady, setCategoryReady] = useState(false);
  const [featuredIds, setFeaturedIds] = useState<Set<number>>(() => new Set());
  const [view, setView] = useState<ViewMode>("double");
  const [isMobile, setIsMobile] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [nextOffset, setNextOffset] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

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
    if (!token) {
      setCategoryReady(false);
      return;
    }

    let cancelled = false;

    void fetchUserPosSettings(token)
      .then((res) => {
        if (cancelled) return;
        const next = applyDefaultCategory(res.settings.default_category);
        setFeaturedOnly(next.featuredOnly);
        setSelectedGroupId(next.selectedGroupId);
      })
      .catch(() => {
        if (cancelled) return;
        setFeaturedOnly(false);
        setSelectedGroupId(null);
      })
      .finally(() => {
        if (!cancelled) setCategoryReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const isGlobalSearch = search.length > 0;

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

  useEffect(() => {
    if (!token || !categoryReady) {
      if (!token) {
        setProducts([]);
        setGroups([]);
        setNextOffset(0);
        setTotal(0);
      }
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [groupsRes, productsRes] = await Promise.all([
          fetchProductGroups(token),
          fetchCatalogProducts(token, {
            offset: 0,
            limit: PAGE_SIZE,
            search,
            groupId: isGlobalSearch ? null : selectedGroupId,
            featuredOnly: isGlobalSearch ? false : featuredOnly,
          }),
        ]);
        if (cancelled) return;
        lastRequestedOffsetRef.current = null;
        setGroups(groupsRes.groups);
        setProducts(productsRes.products);
        setNextOffset(productsRes.next_offset);
        setTotal(productsRes.total);
      } catch (err) {
        if (cancelled) return;
        lastRequestedOffsetRef.current = null;
        setProducts([]);
        setGroups([]);
        setNextOffset(0);
        setTotal(0);
        setError(formatAuthError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [categoryReady, featuredOnly, isGlobalSearch, refreshNonce, search, selectedGroupId, setProducts, token]);

  const canLoadMore = nextOffset > 0 && (total === 0 || products.length < total);

  const loadMore = async () => {
    if (!token || isLoadingMoreRef.current || !canLoadMore) return;

    const requestOffset = nextOffset > 0 ? nextOffset : products.length;
    if (lastRequestedOffsetRef.current === requestOffset) return;

    isLoadingMoreRef.current = true;
    lastRequestedOffsetRef.current = requestOffset;
    setLoadingMore(true);
    setError("");
    try {
      const res = await fetchCatalogProducts(token, {
        offset: requestOffset,
        limit: PAGE_SIZE,
        search,
        groupId: isGlobalSearch ? null : selectedGroupId,
        featuredOnly: isGlobalSearch ? false : featuredOnly,
      });
      if (res.products.length > 0) {
        appendProducts(res.products);
      }
      setNextOffset(res.next_offset > requestOffset ? res.next_offset : 0);
      setTotal(res.total);
    } catch (err) {
      lastRequestedOffsetRef.current = null;
      setError(formatAuthError(err));
    } finally {
      isLoadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const handleGridScroll = () => {
    const el = gridRef.current;
    if (!el || loading || isLoadingMoreRef.current || !canLoadMore) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < 240) {
      void loadMore();
    }
  };

  const retry = async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetchCatalogProducts(token, {
        offset: 0,
        limit: PAGE_SIZE,
        search,
        groupId: isGlobalSearch ? null : selectedGroupId,
        featuredOnly: isGlobalSearch ? false : featuredOnly,
      });
      lastRequestedOffsetRef.current = null;
      setProducts(res.products);
      setNextOffset(res.next_offset);
      setTotal(res.total);
    } catch (err) {
      lastRequestedOffsetRef.current = null;
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
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

  return (
    <div className={styles.catalog}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Sell</div>
          <div className={styles.subtitle}>
            {loading
              ? "Loading products..."
              : `${products.length} ${products.length === 1 ? "product" : "products"}`}
          </div>
        </div>
        {isMobile ? (
        <div className={styles.viewToggle} role="group" aria-label="View mode">
          <button
            type="button"
            className={clsx(styles.viewBtn, view === "single" && styles.viewBtnActive)}
            onClick={() => setView("single")}
            aria-label="One per row"
            aria-pressed={view === "single"}
          >
            <Square size={16} />
          </button>
          <button
            type="button"
            className={clsx(styles.viewBtn, view === "double" && styles.viewBtnActive)}
            onClick={() => setView("double")}
            aria-label="Two per row"
            aria-pressed={view === "double"}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            type="button"
            className={clsx(styles.viewBtn, view === "list" && styles.viewBtnActive)}
            onClick={() => setView("list")}
            aria-label="Compact list"
            aria-pressed={view === "list"}
          >
            <List size={16} />
          </button>
        </div>
        ) : null}
      </div>

      <form
        className={styles.searchRow}
        onSubmit={(event) => {
          event.preventDefault();
          void submitSearchAddFirst(q.trim());
        }}
      >
        <div className={styles.search}>
          <Search size={16} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Search by name or SKU..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
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

      {error ? (
        <div className={styles.statusBox}>
          <div>{error}</div>
          <button type="button" className={styles.retryBtn} onClick={() => void retry()}>
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className={styles.empty}>Loading products from Regos...</div>
      ) : products.length === 0 ? (
        <div className={styles.empty}>
          {featuredOnly ? "No featured products yet. Star items to add them here." : "No products match your search."}
        </div>
      ) : (
        <>
          <div
            ref={gridRef}
            onScroll={handleGridScroll}
            className={styles.gridScroll}
          >
            <div
              className={clsx(
                styles.grid,
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
                ? `${p.stock} left`
                : `${p.stock.toFixed(2).replace(/\.?0+$/, "")} left`;
              return (
                <div
                  key={p.id}
                  className={clsx(styles.card, cannotAdd && styles.cardDisabled)}
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
                      aria-label={isFeatured ? "Remove from featured" : "Add to featured"}
                      aria-pressed={isFeatured}
                      onClick={(event) => {
                        event.stopPropagation();
                        void toggleFeatured(p);
                      }}
                    >
                      <Star size={15} fill={isFeatured ? "currentColor" : "none"} />
                    </button>
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.cardName}>{p.name}</div>
                    <div className={styles.cardCategory}>
                      {selectedGroup?.name ?? p.category}
                    </div>
                    <div className={styles.cardSku}>{p.sku}</div>
                    <div className={styles.cardFoot}>
                      <div className={styles.cardPrice}>{formatCurrency(p.price)}</div>
                      <span
                        className={clsx(
                          styles.stockBadge,
                          out && styles.stockOut,
                          low && styles.stockLow,
                        )}
                      >
                        {out ? "Out" : stockText}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </div>

          {loadingMore ? <div className={styles.loadingMore}>Loading more products...</div> : null}
        </>
      )}
    </div>
  );
}
