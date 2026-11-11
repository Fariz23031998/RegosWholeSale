import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { Minus, Plus, ShoppingBag, X } from "lucide-react";
import { CartLineImage } from "@/components/Cart/CartLineImage";
import cartStyles from "@/components/Cart/Cart.module.css";
import { QtyKeypad } from "@/components/Cart/QtyKeypad";
import { CatalogViewToggle } from "@/components/POS/CatalogViewToggle";
import { CategoryBar } from "@/components/POS/CategoryBar";
import posStyles from "@/components/POS/POS.module.css";
import { Button } from "@/components/posui/Button";
import { PRODUCT_FALLBACK_IMAGE } from "@/lib/product-image";
import type { ProductGroup } from "@/types/catalog";
import { useLanguage } from "@/contexts/LanguageContext";
import { normalizeEnabledPages } from "@/lib/partner-portal-pages";
import {
  createPartnerOrder,
  fetchPartnerCatalogOptions,
  fetchPartnerProductGroups,
  fetchPartnerProducts,
  type PartnerCatalogProduct,
  type PartnerProductGroup,
  type PartnerWarehouseOption,
} from "@/lib/partner-telegram-api";
import { formatAuthError } from "@/store/auth";
import { useCatalog } from "@/store/catalog";
import { usePartnerNav } from "./PartnerShell";
import { usePartnerSession } from "./PartnerSession";
import { formatAmount, partnerCartKey, partnerWarehouseKey } from "./partner-format";
import styles from "./PartnerPortal.module.css";

type CartLine = {
  id: number;
  name: string;
  price: number;
  available: number;
  quantity: number;
  unitName: string;
  image?: string;
};

type Panel = "shop" | "checkout";

const CATALOG_PAGE_SIZE = 20;
const LOAD_MORE_THRESHOLD_PX = 240;

function productDisplayName(product: PartnerCatalogProduct): string {
  const unitName = product.unit_name.trim();
  if (!unitName) return product.name;
  return `${product.name} (${unitName})`;
}

function productCodeLine(product: PartnerCatalogProduct): string {
  const parts = [product.code, product.articul, product.barcode]
    .map((value) => (value != null ? String(value).trim() : ""))
    .filter(Boolean);
  if (parts.length > 0) return parts.join(" · ");
  return product.sku.trim();
}

function stockLabel(available: number): string {
  return formatAmount(available);
}

function toProductGroup(group: PartnerProductGroup): ProductGroup {
  return {
    id: group.id,
    parent_id: group.parent_id ?? null,
    name: group.name,
    path: group.path || group.name,
    child_count: group.child_count ?? 0,
  };
}

function readCart(publicKey: string): CartLine[] {
  try {
    const raw = sessionStorage.getItem(partnerCartKey(publicKey));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((line): line is CartLine => {
      if (!line || typeof line !== "object") return false;
      const row = line as CartLine;
      return typeof row.id === "number" && typeof row.quantity === "number";
    });
  } catch {
    return [];
  }
}

export function PartnerCatalog() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { token, publicKey, account } = usePartnerSession();
  const canCreateOrders = useMemo(
    () => normalizeEnabledPages(account.enabled_pages).create_orders,
    [account.enabled_pages],
  );
  const [panel, setPanel] = useState<Panel>("shop");
  const [cart, setCart] = useState<CartLine[]>(() => readCart(publicKey));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("in-stock");
  const filterDefaultsForKey = useRef<string | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [groups, setGroups] = useState<PartnerProductGroup[]>([]);
  const [products, setProducts] = useState<PartnerCatalogProduct[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [currency, setCurrency] = useState("");
  const [showQuantities, setShowQuantities] = useState(true);
  const [showZeroQuantity, setShowZeroQuantity] = useState(false);
  const [autoOpenQtyKeypad, setAutoOpenQtyKeypad] = useState(false);
  const [keypadFor, setKeypadFor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [optionsReady, setOptionsReady] = useState(false);
  const [allowWarehouse, setAllowWarehouse] = useState(false);
  const [warehouses, setWarehouses] = useState<PartnerWarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [takeaway, setTakeaway] = useState(true);
  const [address, setAddress] = useState("");
  const [orderPhone, setOrderPhone] = useState(account.phone ?? "");
  const [placing, setPlacing] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const productsRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const lastRequestedOffsetRef = useRef<number | null>(null);
  const { setMobileCartNav } = usePartnerNav();
  const view = useCatalog((s) => s.mobileViewMode);

  const catalogQuery = useMemo(
    () => ({
      search,
      filterType: filter,
      groupId,
      warehouseId: allowWarehouse ? warehouseId : null,
    }),
    [allowWarehouse, filter, groupId, search, warehouseId],
  );

  const applyPage = useCallback(
    (response: Awaited<ReturnType<typeof fetchPartnerProducts>>, mode: "replace" | "append") => {
      setCurrency(response.currency_code || response.currency_name);
      setNextOffset(response.next_offset);
      setCatalogTotal(response.total);
      let mergedLength = response.products.length;
      setProducts((current) => {
        if (mode === "replace") {
          mergedLength = response.products.length;
          return response.products;
        }
        const seen = new Set(current.map((item) => item.id));
        const added = response.products.filter((item) => !seen.has(item.id));
        const merged = [...current, ...added];
        mergedLength = merged.length;
        return merged;
      });
      const reachedTotal = response.total > 0 && mergedLength >= response.total;
      const shortPage = response.products.length < CATALOG_PAGE_SIZE;
      setHasMore(!reachedTotal && !shortPage && response.next_offset > 0);
    },
    [],
  );

  useEffect(() => {
    sessionStorage.setItem(partnerCartKey(publicKey), JSON.stringify(cart));
  }, [cart, publicKey]);

  useEffect(() => {
    if (!canCreateOrders) {
      setPanel("shop");
      setMobileCartOpen(false);
      setKeypadFor(null);
    }
  }, [canCreateOrders]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setIsMobile(mq.matches);
      if (!mq.matches) setMobileCartOpen(false);
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!mobileCartOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileCartOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileCartOpen]);

  useEffect(() => {
    void fetchPartnerProductGroups(token)
      .then((response) => setGroups(response.groups))
      .catch(() => setGroups([]));
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    void fetchPartnerCatalogOptions(token)
      .then((options) => {
        if (cancelled) return;
        setAllowWarehouse(options.allow_warehouse_selection);
        setWarehouses(options.warehouses);
        setCurrency(options.currency_code || options.currency_name);
        setShowQuantities(options.show_product_quantities);
        setShowZeroQuantity(Boolean(options.show_zero_quantity));
        setAutoOpenQtyKeypad(Boolean(options.auto_open_qty_keypad));
        if (filterDefaultsForKey.current !== publicKey) {
          filterDefaultsForKey.current = publicKey;
          setFilter(options.show_zero_quantity ? "all" : "in-stock");
        }
        const stored = Number(sessionStorage.getItem(partnerWarehouseKey(publicKey)) || "");
        const storedOk = options.warehouses.some((item) => item.id === stored);
        const next = options.allow_warehouse_selection && storedOk ? stored : options.warehouse_id;
        setWarehouseId(next);
        setOptionsReady(true);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(formatAuthError(loadError));
        setOptionsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey, token]);

  useEffect(() => {
    if (!optionsReady || panel !== "shop") return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      setHasMore(false);
      lastRequestedOffsetRef.current = 0;
      void fetchPartnerProducts(token, { ...catalogQuery, offset: 0 })
        .then((response) => applyPage(response, "replace"))
        .catch((loadError) => {
          setProducts([]);
          setNextOffset(0);
          setCatalogTotal(0);
          setHasMore(false);
          setError(formatAuthError(loadError));
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [applyPage, catalogQuery, optionsReady, panel, token]);

  const loadMore = useCallback(async () => {
    if (!optionsReady || panel !== "shop" || loading || loadingMoreRef.current || !hasMore) return;
    const requestOffset = nextOffset > 0 ? nextOffset : products.length;
    if (requestOffset <= 0) return;
    if (lastRequestedOffsetRef.current === requestOffset) return;

    loadingMoreRef.current = true;
    lastRequestedOffsetRef.current = requestOffset;
    setLoadingMore(true);
    try {
      const response = await fetchPartnerProducts(token, { ...catalogQuery, offset: requestOffset });
      applyPage(response, "append");
      if (response.products.length === 0) {
        setHasMore(false);
      }
    } catch (loadError) {
      lastRequestedOffsetRef.current = null;
      setError(formatAuthError(loadError));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [applyPage, catalogQuery, hasMore, loading, nextOffset, optionsReady, panel, products.length, token]);

  const fillViewportIfNeeded = useCallback(() => {
    if (loading || loadingMoreRef.current || !hasMore) return;
    const el = productsRef.current;
    if (!el || products.length === 0) return;
    const remaining = el.scrollHeight - el.clientHeight;
    if (remaining <= LOAD_MORE_THRESHOLD_PX) {
      void loadMore();
    }
  }, [hasMore, loadMore, loading, products.length]);

  useEffect(() => {
    fillViewportIfNeeded();
  }, [fillViewportIfNeeded, products.length, nextOffset, loading, loadingMore, hasMore]);

  useEffect(() => {
    const el = productsRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => fillViewportIfNeeded());
    observer.observe(el);
    window.addEventListener("resize", fillViewportIfNeeded);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fillViewportIfNeeded);
    };
  }, [fillViewportIfNeeded]);

  const handleProductsScroll = () => {
    const el = productsRef.current;
    if (!el || loading || loadingMoreRef.current || !hasMore) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < LOAD_MORE_THRESHOLD_PX) {
      void loadMore();
    }
  };

  const add = (product: PartnerCatalogProduct) => {
    if (!canCreateOrders || product.available <= 0) return;
    setCart((current) =>
      current.some((line) => line.id === product.id)
        ? current.map((line) =>
            line.id === product.id ? { ...line, quantity: Math.min(line.available, line.quantity + 1) } : line,
          )
        : [
            ...current,
            {
              id: product.id,
              name: product.name,
              price: product.price,
              available: product.available,
              quantity: 1,
              unitName: product.unit_name,
              image: product.image,
            },
          ],
    );
    if (autoOpenQtyKeypad) {
      setKeypadFor(product.id);
    }
  };

  const total = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const keypadLine = cart.find((line) => line.id === keypadFor) ?? null;

  const openMobileCart = useCallback(() => setMobileCartOpen(true), []);

  useEffect(() => {
    if (!canCreateOrders) {
      setMobileCartNav(null);
      return;
    }
    setMobileCartNav({ itemCount, open: openMobileCart });
  }, [canCreateOrders, itemCount, openMobileCart, setMobileCartNav]);

  useEffect(() => () => setMobileCartNav(null), [setMobileCartNav]);

  const setLineQty = (id: number, next: number) => {
    setCart((current) =>
      current.flatMap((line) => {
        if (line.id !== id) return [line];
        if (next <= 0) return [];
        return [{ ...line, quantity: Math.min(line.available, next) }];
      }),
    );
  };

  const changeWarehouse = (next: number) => {
    setWarehouseId(next);
    sessionStorage.setItem(partnerWarehouseKey(publicKey), String(next));
    setCart([]);
  };

  const place = async () => {
    setPlacing(true);
    setError("");
    try {
      const result = await createPartnerOrder(token, {
        is_takeaway: takeaway,
        address,
        phone: orderPhone,
        warehouse_id: allowWarehouse ? warehouseId : null,
        items: cart.map((line) => ({ product_id: line.id, quantity: line.quantity })),
      });
      setCart([]);
      const placed = result.code || String(result.order_id);
      void navigate({
        to: "/partner/$publicKey/orders",
        params: { publicKey },
        search: { placed },
      });
    } catch (placeError) {
      setError(formatAuthError(placeError));
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className={styles.catalogLayout}>
      <section className={styles.catalog}>
        {canCreateOrders && panel === "checkout" ? (
          <div className={`${styles.panel} ${styles.checkoutPanel}`}>
            <div className={styles.checkoutHeader}>
              <button type="button" className={styles.textButton} onClick={() => setPanel("shop")}>
                {t("partnerApp.back", "Back")}
              </button>
              <h2 className={styles.checkoutTitle}>{t("partnerApp.checkout", "Checkout")}</h2>
            </div>

            <div className={styles.checkoutBody}>
              <div className={styles.checkoutSection}>
                <div className={styles.checkoutSectionLabel}>
                  {t("partnerApp.fulfillment", "Fulfillment")}
                </div>
                <div className={styles.checkoutSegment} role="group" aria-label={t("partnerApp.fulfillment", "Fulfillment")}>
                  <button
                    type="button"
                    className={clsx(styles.checkoutSegmentBtn, takeaway && styles.checkoutSegmentActive)}
                    aria-pressed={takeaway}
                    onClick={() => setTakeaway(true)}
                  >
                    {t("partnerApp.pickup", "Pickup")}
                  </button>
                  <button
                    type="button"
                    className={clsx(styles.checkoutSegmentBtn, !takeaway && styles.checkoutSegmentActive)}
                    aria-pressed={!takeaway}
                    onClick={() => setTakeaway(false)}
                  >
                    {t("partnerApp.delivery", "Delivery")}
                  </button>
                </div>
              </div>

              <div className={styles.checkoutSection}>
                {!takeaway ? (
                  <label className={styles.field}>
                    {t("partnerApp.address", "Address")}
                    <input
                      className={styles.input}
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      placeholder={t("partnerApp.addressPlaceholder", "Delivery address")}
                    />
                  </label>
                ) : null}
                <label className={styles.field}>
                  {t("partnerApp.phone", "Phone")}
                  <input
                    className={styles.input}
                    value={orderPhone}
                    onChange={(event) => setOrderPhone(event.target.value)}
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </label>
              </div>

              {error ? <p className={styles.error}>{error}</p> : null}
            </div>

            <div className={styles.checkoutFooter}>
              <div className={styles.checkoutTotalRow}>
                <span>{t("partnerApp.total", "Total")}</span>
                <strong>
                  {formatAmount(total)} {currency}
                </strong>
              </div>
              <Button type="button" full size="lg" disabled={placing || cart.length === 0} onClick={() => void place()}>
                {t("partnerApp.placeOrder", "Place order")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.catalogControls}>
              <div className={styles.catalogToolbarRow}>
                <div className={styles.toolbar}>
                  <div className={styles.searchWithViewToggle}>
                    <input
                      className={`${styles.input} ${styles.searchInput}`}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t("partnerApp.search", "Search products")}
                    />
                    <CatalogViewToggle className={styles.catalogViewToggle} />
                  </div>
                  {allowWarehouse ? (
                    <label className={styles.field}>
                      {t("partnerApp.warehouse", "Warehouse")}
                      <select
                        className={styles.input}
                        value={warehouseId ?? ""}
                        onChange={(event) => changeWarehouse(Number(event.target.value))}
                      >
                        {warehouses.map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                <div className={styles.filters}>
                  {(
                    (showZeroQuantity
                      ? (["all", "in-stock", "low-stock", "cheap", "expensive"] as const)
                      : (["in-stock", "low-stock", "cheap", "expensive"] as const)
                    )
                  ).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={filter === item ? styles.chipOn : styles.chip}
                      onClick={() => setFilter(item)}
                    >
                      {t(
                        `partnerApp.${
                          item === "all"
                            ? "allProducts"
                            : item === "in-stock"
                              ? "inStock"
                              : item === "low-stock"
                                ? "lowStock"
                                : item
                        }`,
                        item === "all" ? "All" : item,
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <CategoryBar
                className={styles.catalogCategories}
                groups={groups.map(toProductGroup)}
                featuredOnly={false}
                showFeatured={false}
                selectedGroupId={groupId}
                onSelectAll={() => setGroupId(null)}
                onSelectGroup={setGroupId}
              />
            </div>
            <div
              ref={productsRef}
              className={styles.catalogProducts}
              onScroll={handleProductsScroll}
            >
            {loading ? <p>{t("common.loading", "Loading...")}</p> : null}
            {error ? <p className={styles.error}>{error}</p> : null}
            {!loading && products.length === 0 ? <p>{t("partnerApp.emptyCatalog", "No products match this filter.")}</p> : null}
            <div
              className={clsx(
                posStyles.grid,
                view === "single" && posStyles.gridSingle,
                view === "double" && posStyles.gridDouble,
                view === "list" && posStyles.gridList,
              )}
            >
              {products.map((product) => {
                const out = product.available <= 0;
                const low = product.available > 0 && product.available < 10;
                const codeLine = productCodeLine(product);
                return (
                  <div
                    key={product.id}
                    className={clsx(
                      posStyles.card,
                      (out || !canCreateOrders) && posStyles.cardDisabled,
                    )}
                    role={canCreateOrders ? "button" : undefined}
                    tabIndex={canCreateOrders && !out ? 0 : -1}
                    aria-disabled={out || !canCreateOrders}
                    onClick={() => {
                      if (canCreateOrders && !out) add(product);
                    }}
                    onKeyDown={(event) => {
                      if (!canCreateOrders || out) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        add(product);
                      }
                    }}
                  >
                    <div className={posStyles.cardMedia}>
                      <img
                        src={product.image || PRODUCT_FALLBACK_IMAGE}
                        alt={product.name}
                        className={posStyles.cardImg}
                        loading="lazy"
                      />
                    </div>
                    <div className={posStyles.cardBody}>
                      <div className={posStyles.cardName}>{productDisplayName(product)}</div>
                      {product.category ? <div className={posStyles.cardCategory}>{product.category}</div> : null}
                      {codeLine ? <div className={posStyles.cardSku}>{codeLine}</div> : null}
                      <div className={posStyles.cardFoot}>
                        <div className={posStyles.cardPrice}>
                          {formatAmount(product.price)} {currency}
                        </div>
                        {showQuantities || out ? (
                          <span className={clsx(posStyles.stockBadge, out && posStyles.stockOut, showQuantities && low && posStyles.stockLow)}>
                            {out
                              ? t("pos.outOfStock", "Out")
                              : t("pos.stockLeft", "{{n}} left", { n: stockLabel(product.available) })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {loadingMore ? (
              <div className={posStyles.loadMoreWrap}>
                <p className={posStyles.loadMoreHint}>{t("common.loading", "Loading...")}</p>
              </div>
            ) : null}
            {!loading && !loadingMore && hasMore && catalogTotal > products.length ? (
              <div className={posStyles.loadMoreWrap}>
                <p className={posStyles.loadMoreHint}>
                  {t("partnerApp.scrollForMore", "Scroll for more products")}
                </p>
              </div>
            ) : null}
            </div>
          </>
        )}
      </section>
      {canCreateOrders && mobileCartOpen ? (
        <div className={cartStyles.backdrop} onClick={() => setMobileCartOpen(false)} aria-hidden />
      ) : null}

      {canCreateOrders ? (
      <aside
        className={clsx(styles.cart, mobileCartOpen && styles.cartOpen)}
        id="cart"
        aria-hidden={isMobile && !mobileCartOpen}
      >
        <div className={cartStyles.header}>
          <div className={cartStyles.title}>
            {t("partnerApp.cart", "Cart")} <span className={cartStyles.count}>{cart.length}</span>
          </div>
          <div className={cartStyles.headerActions}>
            {cart.length > 0 ? (
              <button type="button" className={cartStyles.clear} onClick={() => setCart([])}>
                {t("cart.clear", "Clear")}
              </button>
            ) : null}
            <button
              type="button"
              className={cartStyles.closeBtn}
              onClick={() => setMobileCartOpen(false)}
              aria-label={t("common.close", "Close")}
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className={cartStyles.items}>
          {cart.length === 0 ? (
            <div className={cartStyles.empty}>
              <div className={cartStyles.emptyIcon}>
                <ShoppingBag size={22} />
              </div>
              <div style={{ fontWeight: 500, color: "var(--color-text-muted)" }}>
                {t("partnerApp.emptyCart", "Your cart is empty.")}
              </div>
              <div>{t("cart.emptyHint", "Tap a product to add it to the sale.")}</div>
            </div>
          ) : (
            cart.map((line) => {
              const unit = line.unitName.trim();
              const unitPrice = formatAmount(line.price);
              return (
                <div key={line.id} className={cartStyles.line}>
                  <CartLineImage image={line.image ?? ""} name={line.name} />
                  <div>
                    <div className={cartStyles.lineName}>{line.name}</div>
                    <div className={cartStyles.linePrice}>
                      {unit
                        ? `${unitPrice} ${unit}`
                        : t("cart.priceEa", "{{price}} ea", { price: unitPrice })}
                    </div>
                    <div className={cartStyles.qty} style={{ marginTop: 6, width: "fit-content" }}>
                      <button
                        type="button"
                        className={cartStyles.qtyBtn}
                        onClick={() => setLineQty(line.id, line.quantity - 1)}
                        aria-label={t("cart.qty.decrease", "Decrease")}
                      >
                        <Minus size={13} />
                      </button>
                      <button
                        type="button"
                        className={cartStyles.qtyVal}
                        onClick={() => setKeypadFor(line.id)}
                        aria-label={t("cart.qty.tapToEnter", "Tap to enter quantity")}
                        title={t("cart.qty.tapToEnter", "Tap to enter quantity")}
                      >
                        {line.quantity}
                      </button>
                      <button
                        type="button"
                        className={cartStyles.qtyBtn}
                        disabled={line.quantity >= line.available}
                        onClick={() => setLineQty(line.id, line.quantity + 1)}
                        aria-label={t("cart.qty.increase", "Increase")}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                  <div className={cartStyles.lineRight}>
                    <button
                      type="button"
                      className={cartStyles.qtyBtn}
                      onClick={() => setLineQty(line.id, 0)}
                      aria-label={t("cart.qty.remove", "Remove")}
                      title={t("cart.qty.remove", "Remove")}
                    >
                      <X size={14} />
                    </button>
                    <div className={cartStyles.lineTotal}>{formatAmount(line.price * line.quantity)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className={cartStyles.summary}>
          <div className={cartStyles.row}>
            <span>{t("cart.subtotal", "Subtotal")}</span>
            <span>{formatAmount(total)}</span>
          </div>
          <div className={`${cartStyles.row} ${cartStyles.totalRow}`}>
            <span>{t("cart.total", "Total")}</span>
            <span>{formatAmount(total)}</span>
          </div>
          {panel === "shop" ? (
            <Button
              type="button"
              full
              size="lg"
              className={cartStyles.charge}
              disabled={cart.length === 0}
              onClick={() => {
                setMobileCartOpen(false);
                setPanel("checkout");
              }}
            >
              {t("partnerApp.checkout", "Checkout")} {formatAmount(total)}
            </Button>
          ) : null}
        </div>
      </aside>
      ) : null}

      {canCreateOrders ? (
      <QtyKeypad
        open={keypadLine !== null}
        initial={keypadLine?.quantity ?? 0}
        productName={keypadLine?.name}
        maxQty={keypadLine?.available ?? null}
        allowDecimals
        onClose={() => setKeypadFor(null)}
        onConfirm={(qty) => {
          if (keypadLine) setLineQty(keypadLine.id, qty);
          setKeypadFor(null);
        }}
      />
      ) : null}
    </div>
  );
}
