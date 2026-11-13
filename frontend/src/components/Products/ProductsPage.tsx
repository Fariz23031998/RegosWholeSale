import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import {
  ArrowUpDown,
  BadgeDollarSign,
  Camera,
  CheckCheck,
  CircleDollarSign,
  Copy,
  ImageOff,
  ListChecks,
  PackageX,
  Printer,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { QtyKeypad } from "@/components/Cart/QtyKeypad";
import { CatalogSortMenu } from "@/components/POS/CatalogSortMenu";
import { useRegisterProductsSettings } from "@/components/Layout/products-top-bar";
import { CategoryBar } from "@/components/POS/CategoryBar";
import posStyles from "@/components/POS/POS.module.css";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { PrintAreaPortal } from "@/components/Receipt/PrintAreaPortal";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePermissions } from "@/hooks/use-permissions";
import { findProductByBarcode } from "@/lib/barcode";
import { isCacheEnabled } from "@/lib/cache-policy";
import { loadCatalogProducts, loadProductGroups } from "@/lib/catalog-service";
import { ensureCatalogReady } from "@/lib/ensure-catalog-ready";
import { truncateToastName } from "@/lib/format";
import {
  fetchLabelStations,
  fetchLabelTemplates,
  fetchMyLabelPrintSettings,
} from "@/lib/label-templates-api";
import {
  ChooseLabelPrinterError,
  NoLabelQuantityError,
  printLabelsWithService,
  RenderLabelError,
  renderLabelsInBrowser,
} from "@/lib/print-product-labels";
import {
  loadProductsPageState,
  saveProductsPageState,
} from "@/lib/products-page-db";
import { subscribeSettingsEvents } from "@/lib/settings-events";
import { fetchMyRegosDefaults, patchMyRegosDefaults } from "@/lib/settings-api";
import { formatAuthError, useAuth } from "@/store/auth";
import { useCatalog } from "@/store/catalog";
import { useSellContext } from "@/store/sell-context";
import type { Product, ProductGroup } from "@/types/catalog";
import type { UserLabelPrintSettings } from "@/types/label-templates";
import { ChangePricesDialog } from "./ChangePricesDialog";
import { LabelPrintDialog } from "./LabelPrintDialog";
import { LabelPrintSettingsDialog } from "./LabelPrintSettingsDialog";
import { LabelProductCard } from "./LabelProductCard";
import styles from "./Products.module.css";

const PAGE_SIZE = 60;

const BarcodeScannerModal = lazy(() =>
  import("@/components/POS/BarcodeScannerModal").then((mod) => ({
    default: mod.BarcodeScannerModal,
  })),
);

function clampCopies(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(99, Math.max(1, Math.round(value)));
}

function productMatchesSearch(product: Product, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const fields = [
    product.name,
    product.sku,
    product.code,
    product.articul,
    product.barcode,
    product.category,
  ];
  return fields.some((field) => String(field ?? "").toLowerCase().includes(q));
}

/** Digits-only queries longer than 6 chars search only on Enter, not while typing. */
function isDeferredDigitSearch(value: string): boolean {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) && trimmed.length > 6;
}

export function ProductsPage() {
  const { t } = useLanguage();
  const {
    canPrintLabels,
    canChangeWarehouse,
    canChangePriceType,
    canManageOwnPrintSettings,
    canManagePrintSettings,
    can,
  } = usePermissions();
  const canChangeWarehousePerm = canChangeWarehouse();
  const canChangePriceTypePerm = canChangePriceType();
  const canEditPrintSettings = canManageOwnPrintSettings() || canManagePrintSettings();
  const canEditPrices = can("prices.write");
  const canAccessUserSettings = can("users.manage");
  const token = useAuth((state) => state.accessToken);
  const user = useAuth((state) => state.user);
  const hydrated = useSellContext((state) => state.hydrated);
  const hydrateSellContext = useSellContext((state) => state.hydrate);
  const warehouseId = useSellContext((state) => state.warehouseId);
  const priceTypeId = useSellContext((state) => state.priceTypeId);
  const view = useCatalog((state) => state.mobileViewMode);
  const hideCardImages = useCatalog((state) => state.hideCardImages);
  const setHideCardImages = useCatalog((state) => state.setHideCardImages);
  const catalogSort = useCatalog((state) => state.catalogSort);
  const setCatalogSort = useCatalog((state) => state.setCatalogSort);

  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [printError, setPrintError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedById, setSelectedById] = useState<Map<string, Product>>(() => new Map());
  const [copiesById, setCopiesById] = useState<Map<string, number>>(() => new Map());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [printConfirmOpen, setPrintConfirmOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsIntent, setSettingsIntent] = useState<"edit" | "print">("edit");
  const [printing, setPrinting] = useState(false);
  const [printHtml, setPrintHtml] = useState("");
  const [printPrefs, setPrintPrefs] = useState<UserLabelPrintSettings | null>(null);
  const [includeZeroQuantity, setIncludeZeroQuantity] = useState(false);
  const [includeZeroPrice, setIncludeZeroPrice] = useState(false);
  const [catalogFiltersReady, setCatalogFiltersReady] = useState(false);
  const [catalogReady, setCatalogReady] = useState(() => !isCacheEnabled());
  const [savingCatalogFilter, setSavingCatalogFilter] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [keypadProductId, setKeypadProductId] = useState<string | null>(null);
  const sortButtonRef = useRef<HTMLButtonElement | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingSelectSingleRef = useRef(false);
  const selectProductRef = useRef<(product: Product) => void>(() => {});
  const startupSyncDoneForScope = useRef<string | null>(null);

  const canOverrideContext = canChangeWarehousePerm || canChangePriceTypePerm;
  const openPrintSettings = useCallback(() => {
    setSettingsIntent("edit");
    setSettingsOpen(true);
  }, []);
  useRegisterProductsSettings(canPrintLabels() && canEditPrintSettings ? openPrintSettings : null);
  const catalogOverrides = useMemo(() => {
    const overrides: { warehouseId?: number; priceTypeId?: number } = {};
    if (canChangeWarehousePerm && warehouseId) overrides.warehouseId = warehouseId;
    if (canChangePriceTypePerm && priceTypeId) overrides.priceTypeId = priceTypeId;
    return overrides;
  }, [canChangePriceTypePerm, canChangeWarehousePerm, priceTypeId, warehouseId]);

  const catalogScope = useMemo(
    () => ({
      companyId: user?.company_id,
      warehouseId: catalogOverrides.warehouseId,
      priceTypeId: catalogOverrides.priceTypeId,
    }),
    [catalogOverrides.priceTypeId, catalogOverrides.warehouseId, user?.company_id],
  );

  useEffect(() => {
    if (!token) return;
    void hydrateSellContext(token, canOverrideContext, {
      userId: user?.id,
      companyId: user?.company_id,
    });
  }, [canOverrideContext, hydrateSellContext, token, user?.company_id, user?.id]);

  useEffect(() => {
    if (!isCacheEnabled()) {
      setCatalogReady(true);
      return;
    }
    if (
      !token ||
      !user?.company_id ||
      !hydrated ||
      warehouseId === null ||
      priceTypeId === null
    ) {
      setCatalogReady(false);
      return;
    }

    let cancelled = false;
    setCatalogReady(false);

    void ensureCatalogReady(
      token,
      {
        companyId: user.company_id,
        warehouseId: catalogOverrides.warehouseId,
        priceTypeId: catalogOverrides.priceTypeId,
      },
      {
        skipIfDone: true,
        doneForScopeRef: startupSyncDoneForScope,
        isCancelled: () => cancelled,
        t,
      },
    ).finally(() => {
      if (!cancelled) setCatalogReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [
    catalogOverrides.priceTypeId,
    catalogOverrides.warehouseId,
    hydrated,
    priceTypeId,
    t,
    token,
    user?.company_id,
    warehouseId,
  ]);

  useEffect(() => {
    let cancelled = false;
    void loadProductsPageState()
      .then((state) => {
        if (cancelled) return;
        const nextIds = new Set<string>();
        const nextById = new Map<string, Product>();
        const nextCopies = new Map<string, number>();
        for (const item of state.selected) {
          nextIds.add(item.id);
          nextById.set(item.id, item.product);
          nextCopies.set(item.id, clampCopies(item.copies));
        }
        setSelectedIds(nextIds);
        setSelectedById(nextById);
        setCopiesById(nextCopies);
        setShowSelectedOnly(state.showSelectedOnly && nextIds.size > 0);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSelectionHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectionHydrated) return;
    const handle = window.setTimeout(() => {
      void saveProductsPageState({
        showSelectedOnly,
        selected: [...selectedIds].flatMap((id) => {
          const product = selectedById.get(id);
          if (!product) return [];
          return [
            {
              id,
              product,
              copies: clampCopies(copiesById.get(id) ?? 1),
            },
          ];
        }),
      }).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [copiesById, selectedById, selectedIds, selectionHydrated, showSelectedOnly]);

  useEffect(() => {
    if (isDeferredDigitSearch(searchInput)) return;
    const handle = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    if (!token) {
      setIncludeZeroQuantity(false);
      setIncludeZeroPrice(false);
      setCatalogFiltersReady(true);
      return;
    }

    let cancelled = false;
    setCatalogFiltersReady(false);
    const cacheScope =
      user?.company_id != null && user?.id != null
        ? { companyId: user.company_id, userId: user.id }
        : undefined;

    void fetchMyRegosDefaults(token, { cacheScope })
      .then((res) => {
        if (cancelled) return;
        setIncludeZeroQuantity(Boolean(res.defaults.zero_quantity));
        setIncludeZeroPrice(Boolean(res.defaults.zero_price));
      })
      .catch(() => {
        if (cancelled) return;
        setIncludeZeroQuantity(false);
        setIncludeZeroPrice(false);
      })
      .finally(() => {
        if (!cancelled) setCatalogFiltersReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [token, user?.company_id, user?.id]);

  useEffect(() => {
    if (!token || !catalogReady) return;
    let cancelled = false;
    void loadProductGroups(token, user?.company_id)
      .then((loaded) => {
        if (!cancelled) setGroups(loaded);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [catalogReady, token, user?.company_id]);

  useEffect(() => {
    if (!token || !canPrintLabels()) return;
    let cancelled = false;
    const load = () => {
      void fetchMyLabelPrintSettings(token)
        .then((response) => {
          if (!cancelled) setPrintPrefs(response.settings);
        })
        .catch(() => {
          if (!cancelled) setPrintPrefs(null);
        });
    };
    load();
    const unsubscribe = subscribeSettingsEvents((event) => {
      if (event.namespace !== "label_print" && event.namespace !== "label_templates") return;
      if (event.scope === "employee" && event.user_id !== user?.id) return;
      if (cancelled) return;
      load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [canPrintLabels, token, user?.id]);

  useEffect(() => {
    if (!printHtml) return;
    const timer = window.setTimeout(() => window.print(), 50);
    return () => window.clearTimeout(timer);
  }, [printHtml]);

  useEffect(() => {
    if (
      !token ||
      !hydrated ||
      !canPrintLabels() ||
      !catalogFiltersReady ||
      !catalogReady ||
      showSelectedOnly
    ) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void loadCatalogProducts(
      token,
      {
        offset: 0,
        limit: PAGE_SIZE,
        search,
        groupId: selectedGroupId,
        warehouseId: catalogOverrides.warehouseId,
        priceTypeId: catalogOverrides.priceTypeId,
        includeZeroQuantity,
        includeZeroPrice,
        sort: catalogSort,
      },
      catalogScope,
    )
      .then((response) => {
        if (cancelled) return;
        setProducts(response.products);
        setNextOffset(response.next_offset);
        setTotal(response.total);
        if (pendingSelectSingleRef.current) {
          if (response.products.length === 1) {
            selectProductRef.current(response.products[0]);
          }
          pendingSelectSingleRef.current = false;
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProducts([]);
        setError(formatAuthError(err, t("products.errors.load", "Failed to load products")));
        pendingSelectSingleRef.current = false;
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    canPrintLabels,
    catalogFiltersReady,
    catalogOverrides.priceTypeId,
    catalogOverrides.warehouseId,
    catalogReady,
    catalogScope,
    catalogSort,
    hydrated,
    includeZeroPrice,
    includeZeroQuantity,
    search,
    selectedGroupId,
    showSelectedOnly,
    t,
    token,
  ]);

  useEffect(() => {
    setSelectedById((current) => {
      if (current.size === 0) return current;
      let changed = false;
      const next = new Map(current);
      for (const product of products) {
        const existing = next.get(product.id);
        if (!existing) continue;
        if (
          existing.price !== product.price ||
          existing.name !== product.name ||
          existing.unit_name !== product.unit_name
        ) {
          next.set(product.id, product);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [products]);

  const displayedProducts = useMemo(() => {
    if (!showSelectedOnly) return products;
    let list = [...selectedById.values()];
    if (selectedGroupId != null) {
      list = list.filter((product) => product.group_id === selectedGroupId);
    }
    if (search.trim()) {
      list = list.filter((product) => productMatchesSearch(product, search));
    }
    const direction = catalogSort.direction === "desc" ? -1 : 1;
    const column = catalogSort.column;
    list.sort((a, b) => {
      const left = String(
        column === "articul" ? a.articul : column === "code" ? a.code : a.name,
      ).toLowerCase();
      const right = String(
        column === "articul" ? b.articul : column === "code" ? b.code : b.name,
      ).toLowerCase();
      if (left < right) return -1 * direction;
      if (left > right) return 1 * direction;
      return 0;
    });
    return list;
  }, [catalogSort, products, search, selectedById, selectedGroupId, showSelectedOnly]);

  const selectedProducts = useMemo(
    () => displayedProducts.filter((product) => selectedIds.has(product.id)),
    [displayedProducts, selectedIds],
  );
  const priceEditorProducts = useMemo(() => {
    const list: Product[] = [];
    for (const id of selectedIds) {
      const product = selectedById.get(id);
      if (product) list.push(product);
    }
    return list;
  }, [selectedById, selectedIds]);
  const allLoadedSelected =
    displayedProducts.length > 0 &&
    displayedProducts.every((product) => selectedIds.has(product.id));
  const productIds = [...selectedIds]
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);

  const copiesByProductId = useMemo(() => {
    if (!showSelectedOnly) return undefined;
    const map: Record<number, number> = {};
    for (const id of selectedIds) {
      const numericId = Number(id);
      if (!Number.isInteger(numericId) || numericId <= 0) continue;
      map[numericId] = clampCopies(copiesById.get(id) ?? 1);
    }
    return map;
  }, [copiesById, selectedIds, showSelectedOnly]);

  const selectProduct = useCallback((product: Product) => {
    setSelectedIds((current) => {
      if (current.has(product.id)) return current;
      const next = new Set(current);
      next.add(product.id);
      return next;
    });
    setSelectedById((current) => {
      if (current.has(product.id)) return current;
      const next = new Map(current);
      next.set(product.id, product);
      return next;
    });
    setCopiesById((current) => {
      if (current.has(product.id)) return current;
      const next = new Map(current);
      next.set(product.id, 1);
      return next;
    });
  }, []);
  selectProductRef.current = selectProduct;

  const submitSearch = useCallback(() => {
    const term = searchInput.trim();
    pendingSelectSingleRef.current = true;
    setSearch(term);

    if (showSelectedOnly) {
      let list = [...selectedById.values()];
      if (selectedGroupId != null) {
        list = list.filter((product) => product.group_id === selectedGroupId);
      }
      list = list.filter((product) => productMatchesSearch(product, term));
      if (list.length === 1) selectProduct(list[0]);
      pendingSelectSingleRef.current = false;
      return;
    }

    // Same query already loaded — effect will not re-run; select now if unique.
    if (search === term && !loading) {
      if (products.length === 1) selectProduct(products[0]);
      pendingSelectSingleRef.current = false;
    }
  }, [
    loading,
    products,
    search,
    searchInput,
    selectProduct,
    selectedById,
    selectedGroupId,
    showSelectedOnly,
  ]);

  const toggleProduct = (product: Product) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(product.id)) next.delete(product.id);
      else next.add(product.id);
      return next;
    });
    setSelectedById((current) => {
      const next = new Map(current);
      if (next.has(product.id)) next.delete(product.id);
      else next.set(product.id, product);
      return next;
    });
    setCopiesById((current) => {
      const next = new Map(current);
      if (next.has(product.id)) next.delete(product.id);
      else next.set(product.id, 1);
      return next;
    });
  };

  const toggleAllLoaded = () => {
    if (allLoadedSelected) {
      setShowSelectedOnly(false);
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allLoadedSelected) {
        for (const product of displayedProducts) next.delete(product.id);
      } else {
        for (const product of displayedProducts) next.add(product.id);
      }
      return next;
    });
    setSelectedById((current) => {
      const next = new Map(current);
      if (allLoadedSelected) {
        for (const product of displayedProducts) next.delete(product.id);
      } else {
        for (const product of displayedProducts) next.set(product.id, product);
      }
      return next;
    });
    setCopiesById((current) => {
      const next = new Map(current);
      if (allLoadedSelected) {
        for (const product of displayedProducts) next.delete(product.id);
      } else {
        for (const product of displayedProducts) {
          if (!next.has(product.id)) next.set(product.id, 1);
        }
      }
      return next;
    });
  };

  const setProductCopies = (product: Product, copies: number) => {
    setCopiesById((current) => {
      const next = new Map(current);
      next.set(product.id, clampCopies(copies));
      return next;
    });
  };

  const copyStockToPrintQty = () => {
    setCopiesById((current) => {
      const next = new Map(current);
      for (const product of selectedById.values()) {
        next.set(product.id, clampCopies(product.stock));
      }
      return next;
    });
  };

  const keypadProduct = keypadProductId ? selectedById.get(keypadProductId) ?? null : null;

  const handlePricesSaved = (updates: Array<{ id: string; price: number }>) => {
    const byId = new Map(updates.map((update) => [update.id, update.price]));
    setProducts((current) =>
      current.map((product) =>
        byId.has(product.id) ? { ...product, price: byId.get(product.id) ?? product.price } : product,
      ),
    );
    setSelectedById((current) => {
      const next = new Map(current);
      for (const [id, price] of byId) {
        const existing = next.get(id);
        if (existing) next.set(id, { ...existing, price });
      }
      return next;
    });
    setPricesOpen(false);
    setPrintConfirmOpen(true);
  };

  const toggleCatalogFilter = async (field: "zero_quantity" | "zero_price") => {
    if (!token || savingCatalogFilter) return;

    const nextZeroQuantity = field === "zero_quantity" ? !includeZeroQuantity : includeZeroQuantity;
    const nextZeroPrice = field === "zero_price" ? !includeZeroPrice : includeZeroPrice;
    const previousZeroQuantity = includeZeroQuantity;
    const previousZeroPrice = includeZeroPrice;

    setIncludeZeroQuantity(nextZeroQuantity);
    setIncludeZeroPrice(nextZeroPrice);
    setSavingCatalogFilter(true);

    const cacheScope =
      user?.company_id != null && user?.id != null
        ? { companyId: user.company_id, userId: user.id }
        : undefined;

    try {
      const res = await patchMyRegosDefaults(
        token,
        {
          zero_quantity: nextZeroQuantity,
          zero_price: nextZeroPrice,
        },
        cacheScope,
      );
      setIncludeZeroQuantity(Boolean(res.defaults.zero_quantity));
      setIncludeZeroPrice(Boolean(res.defaults.zero_price));
    } catch (err) {
      setIncludeZeroQuantity(previousZeroQuantity);
      setIncludeZeroPrice(previousZeroPrice);
      toast.error(
        formatAuthError(
          err,
          t("pos.catalogFilter.saveFailed", "Failed to update catalog filters."),
        ),
      );
    } finally {
      setSavingCatalogFilter(false);
    }
  };

  const loadMore = () => {
    if (
      showSelectedOnly ||
      !token ||
      !catalogFiltersReady ||
      !catalogReady ||
      loadingMore ||
      products.length >= total
    ) {
      return;
    }
    setLoadingMore(true);
    void loadCatalogProducts(
      token,
      {
        offset: nextOffset,
        limit: PAGE_SIZE,
        search,
        groupId: selectedGroupId,
        warehouseId: catalogOverrides.warehouseId,
        priceTypeId: catalogOverrides.priceTypeId,
        includeZeroQuantity,
        includeZeroPrice,
        sort: catalogSort,
      },
      catalogScope,
    )
      .then((response) => {
        setProducts((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...response.products.filter((item) => !seen.has(item.id))];
        });
        setNextOffset(response.next_offset);
        setTotal(response.total);
      })
      .catch((err: unknown) => {
        setError(formatAuthError(err, t("products.errors.load", "Failed to load products")));
      })
      .finally(() => setLoadingMore(false));
  };

  const handleCameraBarcodeScan = useCallback(
    async (barcode: string) => {
      const term = barcode.trim();
      if (!term || !token) return;
      setScannerOpen(false);
      setSearchInput(term);
      setSearch(term);
      try {
        const response = await loadCatalogProducts(
          token,
          {
            offset: 0,
            limit: PAGE_SIZE,
            search: term,
            groupId: null,
            warehouseId: catalogOverrides.warehouseId,
            priceTypeId: catalogOverrides.priceTypeId,
            includeZeroQuantity: true,
            includeZeroPrice: true,
            sort: catalogSort,
          },
          catalogScope,
        );
        const product =
          findProductByBarcode(response.products, term) ?? response.products[0] ?? null;
        if (!product) {
          toast.error(t("pos.barcode.productNotFound", "No product found for this barcode."));
          return;
        }
        selectProduct(product);
        toast.success(
          t("products.barcode.selected", "Selected {{name}}", {
            name: truncateToastName(product.name),
          }),
        );
      } catch (err) {
        toast.error(formatAuthError(err, t("products.errors.load", "Failed to load products")));
      }
    },
    [catalogOverrides.priceTypeId, catalogOverrides.warehouseId, catalogScope, catalogSort, selectProduct, t, token],
  );

  const printWithPrefs = useCallback(
    async (activePrefs: UserLabelPrintSettings) => {
      if (!token || productIds.length === 0 || printing) return;
      setPrintError("");
      setPrintHtml("");
      setPrinting(true);
      try {
        const templateId = activePrefs.template_id;
        if (!templateId || (activePrefs.method === "service" && !activePrefs.service_id)) {
          setPrintError(
            !templateId
              ? t("products.noTemplates", "No label template is configured.")
              : t("products.noServices", "No print service is configured."),
          );
          return;
        }

        const company = await fetchLabelTemplates(token);
        const templateOk = company.settings.templates.some((template) => template.id === templateId);
        const service = company.settings.print.services.find(
          (item) => item.id === activePrefs.service_id,
        );
        if (!templateOk || (activePrefs.method === "service" && !service)) {
          setPrintError(
            !templateOk
              ? t("products.noTemplates", "No label template is configured.")
              : t("products.noServices", "No print service is configured."),
          );
          return;
        }
        const usePerProductCopies =
          Boolean(copiesByProductId) && !activePrefs.use_warehouse_quantity;
        const target = {
          templateId,
          productIds,
          copies: 1,
          warehouseId: catalogOverrides.warehouseId,
          priceTypeId: catalogOverrides.priceTypeId,
          useWarehouseQuantity: activePrefs.use_warehouse_quantity,
          copiesByProductId: usePerProductCopies ? copiesByProductId : undefined,
        };
        if (activePrefs.method === "browser") {
          setPrintHtml(await renderLabelsInBrowser(token, target));
          return;
        }
        const stations = await fetchLabelStations(token);
        await printLabelsWithService(token, {
          ...target,
          printerName: service?.printer_name ?? "",
          stationId: "",
          printerOverride: activePrefs.printer_name?.trim() ?? "",
          stations: stations.stations,
        });
      } catch (err: unknown) {
        if (err instanceof ChooseLabelPrinterError) {
          setPrintError(t("products.choosePrinter", "Choose a connected label printer."));
          return;
        }
        if (err instanceof NoLabelQuantityError) {
          setPrintError(
            t(
              "products.errors.noQuantity",
              "No labels to print for the selected warehouse quantity.",
            ),
          );
          return;
        }
        setPrintError(
          err instanceof RenderLabelError
            ? t("products.errors.render", "Failed to prepare labels")
            : formatAuthError(err, t("products.errors.print", "Failed to print labels")),
        );
      } finally {
        setPrinting(false);
      }
    },
    [
      catalogOverrides.priceTypeId,
      catalogOverrides.warehouseId,
      copiesByProductId,
      printing,
      productIds,
      t,
      token,
    ],
  );

  const printSelected = async () => {
    if (!token || productIds.length === 0 || printing) return;
    setPrintError("");
    setPrintHtml("");

    try {
      let prefs = printPrefs;
      if (!prefs) {
        const response = await fetchMyLabelPrintSettings(token);
        prefs = response.settings;
        setPrintPrefs(prefs);
      }

      if (prefs.prompt_before_print) {
        setSettingsIntent("print");
        setSettingsOpen(true);
        return;
      }

      await printWithPrefs(prefs);
    } catch (err: unknown) {
      setPrintError(
        formatAuthError(err, t("products.errors.print", "Failed to print labels")),
      );
    }
  };

  const handlePrintSettingsSaved = useCallback(
    (settings: UserLabelPrintSettings) => {
      setPrintPrefs(settings);
      const shouldPrint = settingsIntent === "print";
      setSettingsIntent("edit");
      if (!shouldPrint) return;
      void printWithPrefs(settings);
    },
    [printWithPrefs, settingsIntent],
  );

  const handlePrintSettingsClose = useCallback(() => {
    setSettingsIntent("edit");
    setSettingsOpen(false);
  }, []);

  if (!canPrintLabels()) {
    return (
      <div className={posStyles.empty}>
        {t("products.forbidden", "You do not have permission to print product labels.")}
      </div>
    );
  }

  const showLoading = !showSelectedOnly && (loading || !catalogFiltersReady);

  return (
    <div className={clsx(posStyles.page, styles.page)}>
      <div className={posStyles.catalog}>
        <div className={posStyles.catalogToolbar}>
          <form
            className={posStyles.searchRow}
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <div className={clsx(posStyles.search, posStyles.searchWithScan)}>
              <Search className={posStyles.searchIcon} size={18} />
              <input
                className={posStyles.searchInput}
                value={searchInput}
                placeholder={t("products.searchPlaceholder", "Search products")}
                onChange={(event) => setSearchInput(event.target.value)}
              />
              <button
                type="button"
                className={posStyles.searchScanBtn}
                aria-label={t("pos.scanBarcodeAria", "Scan barcode with camera")}
                title={t("pos.scanBarcode", "Scan barcode")}
                onClick={() => setScannerOpen(true)}
              >
                <Camera size={24} />
              </button>
            </div>
            <div className={posStyles.catalogToolbarActions}>
              {canAccessUserSettings ? (
                <>
                  <button
                    type="button"
                    className={clsx(
                      posStyles.catalogFilterBtn,
                      includeZeroQuantity && posStyles.catalogFilterBtnActive,
                    )}
                    aria-label={t(
                      "settings.defaults.zeroQuantity",
                      "Include zero quantity products",
                    )}
                    aria-pressed={includeZeroQuantity}
                    title={t("settings.defaults.zeroQuantity", "Include zero quantity products")}
                    disabled={savingCatalogFilter}
                    onClick={() => void toggleCatalogFilter("zero_quantity")}
                  >
                    <PackageX size={16} />
                    <span className={posStyles.catalogFilterBtnLabel}>
                      {t("pos.includeZeroQuantityShort", "Zero qty")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={clsx(
                      posStyles.catalogFilterBtn,
                      includeZeroPrice && posStyles.catalogFilterBtnActive,
                    )}
                    aria-label={t("settings.defaults.zeroPrice", "Include zero price products")}
                    aria-pressed={includeZeroPrice}
                    title={t("settings.defaults.zeroPrice", "Include zero price products")}
                    disabled={savingCatalogFilter}
                    onClick={() => void toggleCatalogFilter("zero_price")}
                  >
                    <CircleDollarSign size={16} />
                    <span className={posStyles.catalogFilterBtnLabel}>
                      {t("pos.includeZeroPriceShort", "Zero price")}
                    </span>
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className={clsx(
                  posStyles.catalogFilterBtn,
                  styles.selectedFilterBtn,
                  showSelectedOnly && posStyles.catalogFilterBtnActive,
                )}
                aria-label={t("products.showSelectedOnly", "Show selected only")}
                aria-pressed={showSelectedOnly}
                title={t("products.showSelectedOnly", "Show selected only")}
                onClick={() => setShowSelectedOnly((current) => !current)}
              >
                <ListChecks size={16} />
                <span className={posStyles.catalogFilterBtnLabel}>
                  {t("products.showSelectedOnlyShort", "Selected")}
                </span>
                <span className={styles.selectedCount}>{selectedIds.size}</span>
              </button>
              <div className={posStyles.sortMenuWrap}>
                <button
                  ref={sortButtonRef}
                  type="button"
                  className={clsx(
                    posStyles.catalogFilterBtn,
                    (catalogSort.column !== "name" || catalogSort.direction !== "asc") &&
                      posStyles.catalogFilterBtnActive,
                  )}
                  aria-label={t("pos.sortAria", "Sort products")}
                  aria-haspopup="menu"
                  aria-expanded={sortOpen}
                  title={t("pos.sort", "Sort")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSortOpen((open) => !open);
                  }}
                >
                  <ArrowUpDown size={16} />
                  <span className={posStyles.catalogFilterBtnLabel}>{t("pos.sort", "Sort")}</span>
                </button>
                <CatalogSortMenu
                  open={sortOpen}
                  catalogSort={catalogSort}
                  anchorRef={sortButtonRef}
                  menuRef={sortMenuRef}
                  onClose={() => setSortOpen(false)}
                  onSelect={setCatalogSort}
                />
              </div>
              <button
                type="button"
                className={clsx(
                  posStyles.catalogFilterBtn,
                  hideCardImages && posStyles.catalogFilterBtnActive,
                )}
                aria-label={t("pos.hideImagesAria", "Hide product images")}
                aria-pressed={hideCardImages}
                title={t("pos.hideImages", "Hide images")}
                onClick={() => setHideCardImages(!hideCardImages)}
              >
                <ImageOff size={16} />
                <span className={posStyles.catalogFilterBtnLabel}>
                  {t("pos.hideImages", "Hide images")}
                </span>
              </button>
            </div>
          </form>
          <CategoryBar
            groups={groups}
            featuredOnly={false}
            showFeatured={false}
            selectedGroupId={selectedGroupId}
            onSelectAll={() => setSelectedGroupId(null)}
            onSelectGroup={setSelectedGroupId}
          />
        </div>
        <div
          className={clsx(posStyles.gridScroll, selectedIds.size > 0 && styles.gridWithActions)}
          onScroll={(event) => {
            if (showSelectedOnly) return;
            const node = event.currentTarget;
            if (node.scrollTop + node.clientHeight >= node.scrollHeight - 240) loadMore();
          }}
        >
          {error ? <div className={posStyles.statusBox}>{error}</div> : null}
          {showLoading ? (
            <div className={posStyles.empty}>{t("products.loading", "Loading products…")}</div>
          ) : displayedProducts.length === 0 ? (
            <div className={posStyles.empty}>
              {showSelectedOnly
                ? t("products.emptySelected", "No selected products")
                : t("products.empty", "No products found")}
            </div>
          ) : (
            <div
              className={clsx(
                posStyles.grid,
                hideCardImages && posStyles.gridNoImages,
                view === "single" && posStyles.gridSingle,
                view === "double" && posStyles.gridDouble,
                view === "list" && posStyles.gridList,
              )}
            >
              {displayedProducts.map((product) => (
                <LabelProductCard
                  key={product.id}
                  product={product}
                  selected={selectedIds.has(product.id)}
                  hideCardImages={hideCardImages}
                  onToggle={toggleProduct}
                  showCopies={showSelectedOnly}
                  copies={copiesById.get(product.id) ?? 1}
                  onCopiesChange={setProductCopies}
                  onCopiesKeypad={(item) => setKeypadProductId(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {printError ? <p className={styles.printError}>{printError}</p> : null}
      {selectedIds.size > 0 ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionBtn}
            aria-label={t("products.selectAll", "Select all")}
            title={t("products.selectAll", "Select all")}
            onClick={toggleAllLoaded}
          >
            <CheckCheck size={22} />
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            aria-label={t("products.print", "Print labels")}
            title={t("products.selected", "{{n}} selected", {
              n: selectedProducts.length || selectedIds.size,
            })}
            disabled={printing}
            onClick={() => void printSelected()}
          >
            <Printer size={22} />
          </button>
          {canEditPrices ? (
            <button
              type="button"
              className={styles.actionBtn}
              aria-label={t("products.changePrices", "Change prices")}
              title={
                priceTypeId
                  ? t("products.changePrices", "Change prices")
                  : t("products.priceTypeRequired", "Select a price type")
              }
              disabled={!priceTypeId}
              onClick={() => setPricesOpen(true)}
            >
              <BadgeDollarSign size={22} />
            </button>
          ) : null}
          {showSelectedOnly ? (
            <button
              type="button"
              className={styles.actionBtn}
              aria-label={t(
                "products.copyStockToPrintQty",
                "Copy quantity to print quantity",
              )}
              title={t(
                "products.copyStockToPrintQty",
                "Copy quantity to print quantity",
              )}
              onClick={copyStockToPrintQty}
            >
              <Copy size={22} />
            </button>
          ) : null}
        </div>
      ) : null}
      <ChangePricesDialog
        open={pricesOpen}
        products={priceEditorProducts}
        priceTypeId={priceTypeId}
        onClose={() => setPricesOpen(false)}
        onSaved={handlePricesSaved}
      />
      <Modal
        open={printConfirmOpen}
        onClose={() => setPrintConfirmOpen(false)}
        title={t("products.printUpdatedTitle", "Prices updated")}
        elevated
      >
        <p className={styles.hint}>
          {t("products.printUpdatedPrompt", "Print labels with the updated prices?")}
        </p>
        <div className={styles.dialogActions}>
          <Button type="button" variant="secondary" onClick={() => setPrintConfirmOpen(false)}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setPrintConfirmOpen(false);
              void printSelected();
            }}
          >
            {t("products.print", "Print labels")}
          </Button>
        </div>
      </Modal>
      <LabelPrintDialog
        open={printOpen}
        productIds={productIds}
        warehouseId={catalogOverrides.warehouseId}
        priceTypeId={catalogOverrides.priceTypeId}
        preferenceTemplateId={printPrefs?.template_id}
        preferenceServiceId={printPrefs?.service_id}
        preferencePrinterName={printPrefs?.printer_name}
        preferenceMethod={printPrefs?.method}
        preferenceUseWarehouseQuantity={printPrefs?.use_warehouse_quantity}
        copiesByProductId={copiesByProductId}
        onClose={() => {
          setPrintOpen(false);
        }}
      />
      <LabelPrintSettingsDialog
        open={settingsOpen}
        intent={settingsIntent}
        onClose={handlePrintSettingsClose}
        onSaved={handlePrintSettingsSaved}
      />
      {scannerOpen ? (
        <Suspense fallback={null}>
          <BarcodeScannerModal
            open={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onScan={handleCameraBarcodeScan}
          />
        </Suspense>
      ) : null}
      <QtyKeypad
        open={keypadProduct != null}
        initial={keypadProduct ? (copiesById.get(keypadProduct.id) ?? 1) : 1}
        productName={keypadProduct?.name}
        allowDecimals={false}
        onClose={() => setKeypadProductId(null)}
        onConfirm={(qty) => {
          if (keypadProduct) setProductCopies(keypadProduct, qty);
          setKeypadProductId(null);
        }}
      />
      <PrintAreaPortal active={Boolean(printHtml) && !printOpen}>
        <div dangerouslySetInnerHTML={{ __html: printHtml }} />
      </PrintAreaPortal>
    </div>
  );
}
