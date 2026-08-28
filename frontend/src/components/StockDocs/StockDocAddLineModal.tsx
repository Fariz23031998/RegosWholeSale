import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Barcode, Camera, Pencil, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  createProductGroup,
  fetchProductGroups,
  updateProductGroup,
} from "@/lib/catalog-api";
import {
  createItem,
  fetchItem,
  fetchTaxVats,
  fetchUnits,
  generateEan13,
  updateItem,
} from "@/lib/items-api";
import { formatCurrency } from "@/lib/format";
import { lookupByBarcode, listPackagesByIcps, type MxikPackageOption, ITEM_NAME_MAX_LENGTH } from "@/lib/mxik";
import { fetchPosSettings } from "@/lib/settings-api";
import {
  fetchStockItemInfo,
  searchStockItems,
  type StockItemSearchHit,
} from "@/lib/stock-docs-api";
import { searchStockItemsFromCache } from "@/lib/stock-item-cache-search";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePermissions } from "@/hooks/use-permissions";
import { formatAuthError, useAuth } from "@/store/auth";
import { useSellContext } from "@/store/sell-context";
import { usePosConfig } from "@/store/pos-config";
import { filterProductGroups } from "@/lib/category-scope";
import type { ProductGroup } from "@/types/catalog";
import {
  EMPTY_ITEM_FORM,
  type ItemFormValues,
  type RegosTaxVat,
  type RegosUnit,
} from "@/types/items";
import { ProductGroupPicker } from "./ProductGroupPicker";
import styles from "./StockDocs.module.css";

const BarcodeScannerModal = lazy(() =>
  import("@/components/POS/BarcodeScannerModal").then((mod) => ({
    default: mod.BarcodeScannerModal,
  })),
);
type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (hit: StockItemSearchHit) => void;
  /** When false (e.g. Edit Line is stacked on top), skip focusing search. */
  searchFocus?: boolean;
};

type View = "search" | "form" | "groupForm";

function hasLetter(value: string): boolean {
  return /\p{L}/u.test(value);
}

function isLongDigitBarcode(value: string): boolean {
  return /^\d+$/.test(value) && value.length > 7;
}

export function StockDocAddLineModal({
  open,
  onClose,
  onPick,
  searchFocus = true,
}: Props) {
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const token = useAuth((s) => s.accessToken);
  const companyId = useAuth((s) => s.user?.company_id ?? null);
  const warehouseId = useSellContext((s) => s.warehouseId);
  const priceTypeId = useSellContext((s) => s.priceTypeId);
  const { can } = usePermissions();
  const canCreateItem = can("stock.item_create") || can("settings.manage");
  const canEditItem = can("stock.item_edit") || can("settings.manage");

  const [view, setView] = useState<View>("search");
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StockItemSearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [form, setForm] = useState<ItemFormValues>(EMPTY_ITEM_FORM);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const allowedProductGroupIds = usePosConfig((s) => s.allowedProductGroupIds);
  const scopedGroups = useMemo(
    () => filterProductGroups(groups, allowedProductGroupIds),
    [allowedProductGroupIds, groups],
  );
  const [units, setUnits] = useState<RegosUnit[]>([]);
  const [taxVats, setTaxVats] = useState<RegosTaxVat[]>([]);
  const [lookupsLoaded, setLookupsLoaded] = useState(false);
  const [originalBarcodes, setOriginalBarcodes] = useState<string[]>([]);
  const [barcodeDraft, setBarcodeDraft] = useState("");
  const [generatingBarcode, setGeneratingBarcode] = useState(false);
  const [icpsLookupBusy, setIcpsLookupBusy] = useState(false);
  const [packageOptions, setPackageOptions] = useState<MxikPackageOption[]>([]);
  const [packageOptionsBusy, setPackageOptionsBusy] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupParentId, setGroupParentId] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const clearDebounce = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  const resetSearch = () => {
    clearDebounce();
    setQuery("");
    setHits([]);
    setSearched(false);
    setBusy(false);
    setError("");
  };

  const resetAll = () => {
    resetSearch();
    setView("search");
    setEditingItemId(null);
    setForm(EMPTY_ITEM_FORM);
    setOriginalBarcodes([]);
    setBarcodeDraft("");
    setGeneratingBarcode(false);
    setIcpsLookupBusy(false);
    setPackageOptions([]);
    setPackageOptionsBusy(false);
    setEditingGroupId(null);
    setGroupName("");
    setGroupParentId(0);
  };

  const handleClose = () => {
    resetAll();
    setScannerOpen(false);
    onClose();
  };

  const search = async (raw?: string, opts?: { autoPickSingle?: boolean }) => {
    const term = (raw ?? queryRef.current).trim();
    const autoPickSingle = opts?.autoPickSingle ?? true;
    if (!token || !term) {
      setHits([]);
      setSearched(false);
      return;
    }
    setBusy(true);
    setError("");
    setSearched(false);
    try {
      const cached = await searchStockItemsFromCache({
        term,
        companyId,
        warehouseId,
        priceTypeId,
        limit: 20,
      });
      const items =
        cached ??
        (
          await searchStockItems(token, {
            search: term,
            stock_id: warehouseId ?? undefined,
            price_type_id: priceTypeId ?? undefined,
            limit: 20,
          })
        ).items;
      if (autoPickSingle && items.length === 1) {
        resetAll();
        onPick(items[0]);
        return;
      }
      setHits(items);
      setSearched(true);
      if (items.length === 0 && autoPickSingle && isLongDigitBarcode(term)) {
        try {
          await maybeOpenCreateFromBarcodeMiss(term);
        } catch (err: unknown) {
          setError(
            formatAuthError(err, t("stock.item.errors.loadLookups", "Failed to load form data")),
          );
        }
      }
    } catch (err: unknown) {
      setHits([]);
      setSearched(true);
      setError(formatAuthError(err, t("stock.errors.search", "Search failed")));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open || view !== "search") return;
    clearDebounce();
    const trimmed = query.trim();
    if (!trimmed || !hasLetter(trimmed)) {
      return;
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void search(trimmed);
    }, 250);
    return clearDebounce;
  }, [query, open, view]);

  useEffect(() => {
    if (!open) {
      clearDebounce();
      resetAll();
      setScannerOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || view !== "search" || !searchFocus) return;
    const id = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, view, searchFocus]);

  const ensureLookups = async () => {
    if (!token || lookupsLoaded) return { groups, units, taxVats };
    const [g, u, v] = await Promise.all([
      fetchProductGroups(token),
      fetchUnits(token),
      fetchTaxVats(token),
    ]);
    setGroups(g.groups);
    setUnits(u);
    setTaxVats(v);
    setLookupsLoaded(true);
    return { groups: g.groups, units: u, taxVats: v };
  };

  const defaultFormValues = (
    g: ProductGroup[],
    u: RegosUnit[],
    v: RegosTaxVat[],
    nameSeed = "",
    opts?: {
      groupId?: number | null;
      unitId?: number | null;
      vatId?: number | null;
    },
  ): ItemFormValues => {
    const available = filterProductGroups(g, allowedProductGroupIds);
    const preferredGroup =
      opts?.groupId != null
        ? available.find((group) => group.id === opts.groupId)
        : undefined;
    const preferredUnit =
      opts?.unitId != null ? u.find((unit) => unit.id === opts.unitId) : undefined;
    const preferredVat =
      opts?.vatId != null ? v.find((vat) => vat.id === opts.vatId) : undefined;
    const pcs = u.find((unit) => unit.type === "pcs");
    return {
      ...EMPTY_ITEM_FORM,
      name: nameSeed,
      group_id: preferredGroup?.id ?? available[0]?.id ?? 0,
      unit_id: preferredUnit?.id ?? pcs?.id ?? u[0]?.id ?? 0,
      vat_id: preferredVat?.id ?? v[0]?.id ?? 0,
    };
  };

  const loadPackageOptions = async (icps: string, preferredCode?: string | null) => {
    const code = icps.trim();
    if (!code) {
      setPackageOptions([]);
      return;
    }
    setPackageOptionsBusy(true);
    try {
      const options = await listPackagesByIcps(code);
      setPackageOptions(options);
      if (options.length === 0) return;
      setForm((prev) => {
        if (prev.icps.trim() !== code) return prev;
        const preferred =
          (preferredCode && options.find((item) => item.code === preferredCode)?.code) ||
          (prev.package_code.trim() &&
            options.find((item) => item.code === prev.package_code.trim())?.code) ||
          options[0]?.code ||
          "";
        if (!preferred || prev.package_code === preferred) return prev;
        return { ...prev, package_code: preferred };
      });
    } catch {
      setPackageOptions([]);
    } finally {
      setPackageOptionsBusy(false);
    }
  };

  const openCreate = async () => {
    if (!token || busy || !canCreateItem) return;
    setBusy(true);
    setError("");
    try {
      const lookup = await ensureLookups();
      const seed = query.trim();
      let defaults: {
        groupId?: number | null;
        unitId?: number | null;
        vatId?: number | null;
      } = {};
      try {
        const cacheScope = companyId != null ? { companyId } : undefined;
        const res = await fetchPosSettings(token, { cacheScope });
        defaults = {
          groupId: res.settings.tasnif_default_group_id ?? null,
          unitId: res.settings.tasnif_default_unit_id ?? null,
          vatId: res.settings.tasnif_default_vat_id ?? null,
        };
      } catch {
        // Defaults are optional; fall back to first lookup values.
      }
      setEditingItemId(null);
      setOriginalBarcodes([]);
      setBarcodeDraft("");
      setPackageOptions([]);
      setForm(
        defaultFormValues(lookup.groups, lookup.units, lookup.taxVats, seed, defaults),
      );
      setView("form");
    } catch (err: unknown) {
      setError(formatAuthError(err, t("stock.item.errors.loadLookups", "Failed to load form data")));
    } finally {
      setBusy(false);
    }
  };

  const openCreateFromBarcodeMiss = async (
    term: string,
    defaults?: {
      groupId?: number | null;
      unitId?: number | null;
      vatId?: number | null;
    },
  ) => {
    if (!token) return;
    toast.message(
      t(
        "stock.item.tasnifNotFoundToast",
        "Product not found. Opening create form with Tasnif data…",
      ),
    );
    setError("");
    const lookup = await ensureLookups();
    let tasnif: Awaited<ReturnType<typeof lookupByBarcode>> = null;
    try {
      tasnif = await lookupByBarcode(term);
    } catch {
      // Tasnif miss / network failure: still open create with barcode only.
    }
    setEditingItemId(null);
    setOriginalBarcodes([]);
    setBarcodeDraft("");
    setPackageOptions([]);
    setForm({
      ...defaultFormValues(
        lookup.groups,
        lookup.units,
        lookup.taxVats,
        (tasnif?.name ?? "").slice(0, ITEM_NAME_MAX_LENGTH),
        defaults,
      ),
      barcodes: [term],
      icps: tasnif?.icps ?? "",
      package_code: tasnif?.package_code ?? "",
      is_labeled: Boolean(tasnif?.is_labeled),
    });
    setView("form");
    if (tasnif?.icps) {
      void loadPackageOptions(tasnif.icps, tasnif.package_code);
    }
  };

  const maybeOpenCreateFromBarcodeMiss = async (term: string) => {
    if (!token || !canCreateItem || !isLongDigitBarcode(term)) return;
    let groupId: number | null = null;
    let unitId: number | null = null;
    let vatId: number | null = null;
    try {
      const cacheScope = companyId != null ? { companyId } : undefined;
      const res = await fetchPosSettings(token, { cacheScope });
      if (!res.settings.tasnif_create_on_barcode_miss) return;
      groupId = res.settings.tasnif_default_group_id ?? null;
      unitId = res.settings.tasnif_default_unit_id ?? null;
      vatId = res.settings.tasnif_default_vat_id ?? null;
    } catch {
      return;
    }
    await openCreateFromBarcodeMiss(term, { groupId, unitId, vatId });
  };

  const openEdit = async (itemId: number) => {
    if (!token || busy || !canEditItem) return;
    setBusy(true);
    setError("");
    try {
      const lookup = await ensureLookups();
      const item = await fetchItem(token, itemId);
      const barcodes =
        item.barcodes?.length > 0
          ? item.barcodes
          : item.barcode
            ? [item.barcode]
            : [];
      setEditingItemId(itemId);
      setOriginalBarcodes(barcodes);
      setBarcodeDraft("");
      setForm({
        name: item.name,
        group_id: item.group_id || lookup.groups[0]?.id || 0,
        unit_id: item.unit_id || lookup.units[0]?.id || 0,
        vat_id: item.vat_id || lookup.taxVats[0]?.id || 0,
        articul: item.articul ?? "",
        barcodes,
        icps: item.icps ?? "",
        package_code: item.package_code ?? "",
        is_labeled: Boolean(item.is_labeled),
        description: item.description ?? "",
      });
      setView("form");
      if (item.icps) {
        void loadPackageOptions(item.icps, item.package_code);
      } else {
        setPackageOptions([]);
      }
    } catch (err: unknown) {
      setError(formatAuthError(err, t("stock.item.errors.loadItem", "Failed to load product")));
    } finally {
      setBusy(false);
    }
  };

  const backToSearch = () => {
    setView("search");
    setEditingItemId(null);
    setForm(EMPTY_ITEM_FORM);
    setOriginalBarcodes([]);
    setBarcodeDraft("");
    setPackageOptions([]);
    setPackageOptionsBusy(false);
    setError("");
  };

  const applyTasnifLookup = async (barcode: string) => {
    setIcpsLookupBusy(true);
    try {
      const hit = await lookupByBarcode(barcode);
      if (!hit) return;
      let applied = false;
      setForm((prev) => {
        if (prev.icps.trim()) return prev;
        applied = true;
        return {
          ...prev,
          icps: hit.icps,
          package_code: prev.package_code.trim()
            ? prev.package_code
            : hit.package_code ?? "",
          is_labeled: prev.is_labeled || hit.is_labeled,
        };
      });
      if (applied) {
        void loadPackageOptions(hit.icps, hit.package_code);
      }
    } catch {
      // Tasnif lookup is best-effort; user can enter IKPU manually.
    } finally {
      setIcpsLookupBusy(false);
    }
  };

  const commitBarcode = (raw: string, opts?: { lookupTasnif?: boolean }) => {
    const value = raw.trim();
    if (!value) return;
    const lookupTasnif = opts?.lookupTasnif ?? true;
    const needsLookup = lookupTasnif && !form.icps.trim() && !form.barcodes.includes(value);
    setForm((prev) => {
      if (prev.barcodes.includes(value)) return prev;
      return { ...prev, barcodes: [...prev.barcodes, value] };
    });
    setBarcodeDraft("");
    if (needsLookup) {
      void applyTasnifLookup(value);
    }
  };

  const handleGenerateBarcode = async () => {
    if (!token || generatingBarcode || busy) return;
    setGeneratingBarcode(true);
    try {
      const { value } = await generateEan13(token);
      commitBarcode(value, { lookupTasnif: false });
    } catch (err: unknown) {
      toast.error(
        formatAuthError(
          err,
          t("stock.item.errors.generateBarcode", "Failed to generate barcode"),
        ),
      );
    } finally {
      setGeneratingBarcode(false);
    }
  };

  const removeBarcode = (value: string) => {
    setForm((prev) => ({
      ...prev,
      barcodes: prev.barcodes.filter((b) => b !== value),
    }));
  };

  const backToProductForm = () => {
    setView("form");
    setEditingGroupId(null);
    setGroupName("");
    setGroupParentId(0);
    setError("");
  };

  const openCreateGroup = () => {
    setEditingGroupId(null);
    setGroupName("");
    setGroupParentId(form.group_id || 0);
    setError("");
    setView("groupForm");
  };

  const openEditGroup = (group: ProductGroup) => {
    setEditingGroupId(group.id);
    setGroupName(group.name);
    setGroupParentId(group.parent_id ?? 0);
    setError("");
    setView("groupForm");
  };

  const refreshGroups = async () => {
    if (!token) return groups;
    const res = await fetchProductGroups(token);
    setGroups(res.groups);
    setLookupsLoaded(true);
    return res.groups;
  };

  const submitGroupForm = async () => {
    if (!token || busy) return;
    const name = groupName.trim();
    if (!name) {
      setError(t("stock.item.group.nameRequired", "Enter a group name"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (editingGroupId) {
        if (groupParentId === editingGroupId) {
          setError(t("stock.item.group.parentInvalid", "A group cannot be its own parent"));
          return;
        }
        await updateProductGroup(token, editingGroupId, {
          name,
          parent_id: groupParentId > 0 ? groupParentId : 0,
          move_parent: true,
        });
        const refreshed = await refreshGroups();
        const stillThere = refreshed.some((g) => g.id === editingGroupId);
        const fallback = filterProductGroups(refreshed, allowedProductGroupIds)[0];
        if (!stillThere && fallback) {
          setForm((prev) => ({ ...prev, group_id: fallback.id }));
        }
      } else {
        const created = await createProductGroup(token, {
          name,
          parent_id: groupParentId > 0 ? groupParentId : 0,
        });
        await refreshGroups();
        setForm((prev) => ({ ...prev, group_id: created.id }));
      }
      backToProductForm();
    } catch (err: unknown) {
      setError(
        formatAuthError(
          err,
          editingGroupId
            ? t("stock.item.group.errors.update", "Failed to update group")
            : t("stock.item.group.errors.create", "Failed to create group"),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const submitForm = async () => {
    if (!token || busy) return;
    const name = form.name.trim();
    if (!name) {
      setError(t("stock.item.errors.nameRequired", "Enter a product name"));
      return;
    }
    if (!form.group_id) {
      setError(t("stock.item.errors.groupRequired", "Select a product group"));
      return;
    }
    if (!form.unit_id) {
      setError(t("stock.item.errors.unitRequired", "Select a unit"));
      return;
    }
    if (!form.vat_id) {
      setError(t("stock.item.errors.vatRequired", "Select a VAT rate"));
      return;
    }

    setBusy(true);
    setError("");
    try {
      const barcodes = form.barcodes.map((b) => b.trim()).filter(Boolean);
      const articul = form.articul.trim() || null;
      const description = form.description.trim() || null;
      const icps = form.icps.trim() || null;
      const packageCode = form.package_code.trim() || null;

      if (editingItemId) {
        const body: Parameters<typeof updateItem>[2] = {
          name,
          group_id: form.group_id,
          unit_id: form.unit_id,
          vat_id: form.vat_id,
          articul,
          description,
          icps,
          package_code: packageCode,
          is_labeled: form.is_labeled,
        };
        const originalSet = new Set(originalBarcodes);
        const newBarcodes = barcodes.filter((b) => !originalSet.has(b));
        if (newBarcodes.length > 0) {
          body.barcodes = newBarcodes;
        }
        await updateItem(token, editingItemId, body);
        backToSearch();
        if (queryRef.current.trim()) {
          await search(queryRef.current.trim(), { autoPickSingle: false });
        }
      } else {
        const created = await createItem(token, {
          name,
          group_id: form.group_id,
          unit_id: form.unit_id,
          vat_id: form.vat_id,
          type: "Item",
          articul,
          description,
          barcodes: barcodes.length > 0 ? barcodes : null,
          icps,
          package_code: packageCode,
          is_labeled: form.is_labeled,
        });
        const info = await fetchStockItemInfo(token, created.id, {
          stock_id: warehouseId ?? undefined,
          price_type_id: priceTypeId ?? undefined,
          operation_limit: 1,
        });
        resetAll();
        onPick(info.item);
      }
    } catch (err: unknown) {
      setError(
        formatAuthError(
          err,
          editingItemId
            ? t("stock.item.errors.update", "Failed to update product")
            : t("stock.item.errors.create", "Failed to create product"),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const selectHit = (hit: StockItemSearchHit) => {
    resetAll();
    onPick(hit);
  };

  const runManualSearch = () => {
    clearDebounce();
    void search();
  };

  const handleCameraBarcodeScan = async (barcode: string) => {
    const term = barcode.trim();
    if (!term) return;
    setScannerOpen(false);
    if (view === "form") {
      commitBarcode(term);
      return;
    }
    setQuery(term);
    clearDebounce();
    await search(term);
  };

  const productModalTitle =
    view === "groupForm"
      ? editingGroupId
        ? t("stock.item.group.edit", "Edit group")
        : t("stock.item.group.create", "Create group")
      : editingItemId
        ? t("stock.item.edit", "Edit product")
        : t("stock.item.create", "Create product");

  const productModalOpen = open && (view === "form" || view === "groupForm");

  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          // Keep Add Line under Create/Edit product; Escape hits both listeners.
          if (view !== "search") return;
          handleClose();
        }}
        title={t("stock.actions.addLine", "Add line")}
        size="lg"
        fullscreen={isMobile}
        modalClassName={styles.addLineModal}
        bodyClassName={styles.addLineModalBody}
      >
        <div className={styles.addLineSearchView}>
          <div className={styles.addLineSearch}>
            <input
              ref={searchInputRef}
              className={styles.searchInput}
              style={{ paddingLeft: 12 }}
              value={query}
              onChange={(e) => {
                const next = e.target.value;
                setQuery(next);
                // Keep prior hits until the next search finishes so typing does not
                // flash an empty list (same feel as the POS catalog search bar).
                if (!next.trim()) {
                  setHits([]);
                  setSearched(false);
                }
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runManualSearch();
                }
              }}
              placeholder={t("stock.searchItemPlaceholder", "Scan or search…")}
              autoFocus
            />
            <Button
              type="button"
              size="icon"
              variant="secondary"
              disabled={busy}
              aria-label={t("common.search")}
              title={t("common.search")}
              onClick={runManualSearch}
            >
              <Search size={18} />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              disabled={busy}
              aria-label={t("pos.scanBarcodeAria", "Scan barcode with camera")}
              title={t("pos.scanBarcode", "Scan barcode")}
              onClick={() => setScannerOpen(true)}
            >
              <Camera size={18} />
            </Button>
            {canCreateItem ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                disabled={busy}
                aria-label={t("stock.item.create", "Create product")}
                title={t("stock.item.create", "Create product")}
                onClick={() => void openCreate()}
              >
                <Plus size={18} />
              </Button>
            ) : null}
          </div>

          {hits.length > 0 ? (
            <ul className={styles.addLineHits}>
              {hits.map((hit) => {
                const metaParts = [
                  `${t("stock.detail.table.cost", "Cost")}: ${
                    hit.last_purchase_cost != null
                      ? formatCurrency(hit.last_purchase_cost)
                      : "—"
                  }`,
                  `${t("stock.detail.table.price", "Price")}: ${
                    hit.price != null ? formatCurrency(hit.price) : "—"
                  }`,
                  `${t("stock.detail.table.qty", "Qty")}: ${
                    hit.quantity_common != null ? hit.quantity_common : "—"
                  }`,
                ];
                return (
                  <li key={hit.id} className={styles.addLineHitRow}>
                    <button
                      type="button"
                      className={styles.addLineHit}
                      onClick={() => selectHit(hit)}
                    >
                      <span className={styles.addLineHitMain}>
                        <span className={styles.addLineHitTitle}>
                          <span className={styles.id}>
                            {hit.code || hit.barcode || hit.id}
                          </span>
                          <span>{hit.name}</span>
                        </span>
                        <span className={styles.addLineHitMeta}>
                          {metaParts.join(" · ")}
                        </span>
                      </span>
                    </button>
                    {canEditItem ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className={styles.addLineHitEdit}
                        disabled={busy}
                        aria-label={t("common.edit", "Edit")}
                        title={t("common.edit", "Edit")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void openEdit(hit.id);
                        }}
                      >
                        <Pencil size={16} />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {searched && !busy && hits.length === 0 && !error ? (
            <div className={styles.addLineEmpty}>
              <p>{t("stock.search.noProducts", "No products found")}</p>
              {canCreateItem ? (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void openCreate()}
                >
                  <Plus size={16} />
                  {t("stock.item.create", "Create product")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {error && view === "search" ? (
            <div className={styles.errorInline}>{error}</div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={productModalOpen}
        onClose={() => {
          if (view === "groupForm") {
            backToProductForm();
            return;
          }
          backToSearch();
        }}
        title={productModalTitle}
        size="lg"
        fullscreen={isMobile}
        elevated
        modalClassName={styles.addLineModal}
        bodyClassName={styles.addLineModalBody}
      >
        {view === "groupForm" ? (
        <div className={styles.addLineForm}>
          <div className={styles.formField}>
            <label>{t("stock.item.group.fields.name", "Name")}</label>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              autoFocus
            />
          </div>
          <div className={styles.formField}>
            <label>{t("stock.item.group.fields.parent", "Parent group")}</label>
            <select
              value={groupParentId}
              onChange={(e) => setGroupParentId(Number(e.target.value))}
            >
              <option value={0}>
                {t("stock.item.group.root", "Root (no parent)")}
              </option>
              {scopedGroups
                .filter((g) => {
                  if (!editingGroupId) return true;
                  if (g.id === editingGroupId) return false;
                  const editing = groups.find((item) => item.id === editingGroupId);
                  if (!editing?.path) return true;
                  const prefix = `${editing.path}/`;
                  return g.path !== editing.path && !g.path.startsWith(prefix);
                })
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.path || g.name}
                  </option>
                ))}
            </select>
          </div>

          {error ? <div className={styles.errorInline}>{error}</div> : null}

          <div className={styles.formActions}>
            <Button type="button" variant="ghost" disabled={busy} onClick={backToProductForm}>
              {t("common.back", "Back")}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void submitGroupForm()}>
              {editingGroupId ? t("common.save", "Save") : t("common.create", "Create")}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.addLineForm}>
          <div className={styles.formField}>
            <label>{t("stock.item.fields.name", "Name")}</label>
            <input
              value={form.name}
              maxLength={ITEM_NAME_MAX_LENGTH}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              autoFocus
            />
          </div>
          <div className={styles.formField}>
            <label>{t("stock.item.fields.group", "Group")}</label>
            <ProductGroupPicker
              groups={scopedGroups}
              value={form.group_id}
              disabled={busy}
              onChange={(groupId) => setForm((prev) => ({ ...prev, group_id: groupId }))}
              onCreate={canCreateItem ? openCreateGroup : undefined}
              onEdit={canEditItem ? openEditGroup : undefined}
            />
          </div>
          <div className={styles.formRow}>
            <div className={styles.formField}>
              <label>{t("stock.item.fields.unit", "Unit")}</label>
              <select
                value={form.unit_id}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, unit_id: Number(e.target.value) }))
                }
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formField}>
              <label>{t("stock.item.fields.vat", "VAT")}</label>
              <select
                value={form.vat_id}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, vat_id: Number(e.target.value) }))
                }
              >
                {taxVats.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.formField}>
            <label>{t("stock.item.fields.articul", "SKU")}</label>
            <input
              value={form.articul}
              onChange={(e) => setForm((prev) => ({ ...prev, articul: e.target.value }))}
            />
          </div>
          <div className={styles.formField}>
            <label>{t("stock.item.fields.barcode", "Barcode")}</label>
            <div className={styles.barcodeField}>
              {form.barcodes.length > 0 ? (
                <div className={styles.barcodeChips}>
                  {form.barcodes.map((code) => (
                    <span key={code} className={styles.barcodeChip}>
                      <span className={styles.barcodeChipValue}>{code}</span>
                      <button
                        type="button"
                        className={styles.barcodeChipRemove}
                        disabled={busy}
                        aria-label={t("stock.item.removeBarcode", "Remove barcode")}
                        title={t("stock.item.removeBarcode", "Remove barcode")}
                        onClick={() => removeBarcode(code)}
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className={styles.barcodeInputRow}>
                <input
                  value={barcodeDraft}
                  onChange={(e) => setBarcodeDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitBarcode(barcodeDraft);
                    }
                  }}
                  placeholder={t("stock.item.fields.barcode", "Barcode")}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  disabled={busy}
                  aria-label={t("stock.item.addBarcode", "Add barcode")}
                  title={t("stock.item.addBarcode", "Add barcode")}
                  onClick={() => commitBarcode(barcodeDraft)}
                >
                  <Plus size={18} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  disabled={busy}
                  aria-label={t("pos.scanBarcodeAria", "Scan barcode with camera")}
                  title={t("pos.scanBarcode", "Scan barcode")}
                  onClick={() => setScannerOpen(true)}
                >
                  <Camera size={18} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  disabled={busy || generatingBarcode}
                  aria-label={t("stock.item.generateBarcodeAria", "Generate EAN-13 barcode")}
                  title={t("stock.item.generateBarcode", "Generate barcode")}
                  onClick={() => void handleGenerateBarcode()}
                >
                  <Barcode size={18} />
                </Button>
              </div>
            </div>
          </div>
          <div className={`${styles.formRow} ${styles.formRowStack}`}>
            <div className={styles.formField}>
              <label>{t("stock.item.fields.icps", "IKPU")}</label>
              <input
                value={form.icps}
                onChange={(e) => {
                  const next = e.target.value;
                  setForm((prev) => ({ ...prev, icps: next }));
                  setPackageOptions([]);
                }}
                onBlur={(e) => {
                  const code = e.target.value.trim();
                  if (code) void loadPackageOptions(code, form.package_code);
                }}
                disabled={busy}
                placeholder={
                  icpsLookupBusy
                    ? t("stock.item.icpsLookingUp", "Looking up IKPU…")
                    : undefined
                }
              />
              {icpsLookupBusy ? (
                <div className={styles.fieldHint}>
                  {t("stock.item.icpsLookingUp", "Looking up IKPU…")}
                </div>
              ) : null}
            </div>
            <div className={styles.formField}>
              <label>{t("stock.item.fields.packageCode", "Package code")}</label>
              {packageOptions.length > 0 ? (
                <select
                  value={form.package_code}
                  disabled={busy || packageOptionsBusy}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, package_code: e.target.value }))
                  }
                >
                  {!packageOptions.some((item) => item.code === form.package_code) ? (
                    <option value={form.package_code}>
                      {form.package_code ||
                        t("stock.item.packageSelect", "Select package")}
                    </option>
                  ) : null}
                  {packageOptions.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name !== item.code ? `${item.name} (${item.code})` : item.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.package_code}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, package_code: e.target.value }))
                  }
                  disabled={busy || packageOptionsBusy}
                  placeholder={
                    packageOptionsBusy
                      ? t("stock.item.packageLookingUp", "Loading packages…")
                      : undefined
                  }
                />
              )}
              {packageOptionsBusy ? (
                <div className={styles.fieldHint}>
                  {t("stock.item.packageLookingUp", "Loading packages…")}
                </div>
              ) : null}
            </div>
          </div>
          <div className={styles.formField}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={form.is_labeled}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, is_labeled: e.target.checked }))
                }
                disabled={busy}
              />
              <span>{t("stock.item.fields.isLabeled", "Subject to labeling")}</span>
            </label>
          </div>
          <div className={styles.formField}>
            <label>{t("common.description")}</label>
            <input
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
            />
          </div>

          {error ? <div className={styles.errorInline}>{error}</div> : null}

          <div className={styles.formActions}>
            <Button type="button" variant="ghost" disabled={busy} onClick={backToSearch}>
              {t("common.back", "Back")}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void submitForm()}>
              {editingItemId ? t("common.save", "Save") : t("common.create", "Create")}
            </Button>
          </div>
        </div>
      )}
      </Modal>

      {scannerOpen ? (
        <Suspense fallback={null}>
          <BarcodeScannerModal
            open={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onScan={handleCameraBarcodeScan}
          />
        </Suspense>
      ) : null}
    </>
  );
}
