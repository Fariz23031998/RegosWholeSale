import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Barcode, Camera, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { ProductGroupPicker } from "@/components/StockDocs/ProductGroupPicker";
import stockStyles from "@/components/StockDocs/StockDocs.module.css";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  createProductGroup,
  fetchProductGroups,
  updateProductGroup,
} from "@/lib/catalog-api";
import { filterProductGroups } from "@/lib/category-scope";
import {
  fetchItem,
  fetchTaxVats,
  fetchUnits,
  generateEan13,
  updateItem,
} from "@/lib/items-api";
import {
  ITEM_NAME_MAX_LENGTH,
  listPackagesByIcps,
  lookupByBarcode,
  type MxikPackageOption,
} from "@/lib/mxik";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePermissions } from "@/hooks/use-permissions";
import { formatAuthError, useAuth } from "@/store/auth";
import { usePosConfig } from "@/store/pos-config";
import type { Product, ProductGroup } from "@/types/catalog";
import {
  EMPTY_ITEM_FORM,
  type ItemFormValues,
  type RegosTaxVat,
  type RegosUnit,
} from "@/types/items";

const BarcodeScannerModal = lazy(() =>
  import("@/components/POS/BarcodeScannerModal").then((mod) => ({
    default: mod.BarcodeScannerModal,
  })),
);

type Props = {
  open: boolean;
  product: Product | null;
  onClose: () => void;
  onSaved: (update: {
    id: string;
    name: string;
    articul?: string;
    barcode?: string;
    barcode_list?: string;
    code?: string;
  }) => void;
};

type View = "form" | "groupForm";

function resolveItemId(product: Product | null): number {
  if (!product) return 0;
  const raw = product.regos_item_id ?? Number(product.id);
  return Number.isInteger(raw) && raw > 0 ? raw : 0;
}

export function ProductEditDialog({ open, product, onClose, onSaved }: Props) {
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const token = useAuth((s) => s.accessToken);
  const { can } = usePermissions();
  const canCreateItem = can("stock.item_create") || can("settings.manage");
  const canEditItem = can("stock.item_edit") || can("settings.manage");
  const allowedProductGroupIds = usePosConfig((s) => s.allowedProductGroupIds);

  const itemId = resolveItemId(product);
  const [view, setView] = useState<View>("form");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<ItemFormValues>(EMPTY_ITEM_FORM);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [units, setUnits] = useState<RegosUnit[]>([]);
  const [taxVats, setTaxVats] = useState<RegosTaxVat[]>([]);
  const [originalBarcodes, setOriginalBarcodes] = useState<string[]>([]);
  const [barcodeDraft, setBarcodeDraft] = useState("");
  const [generatingBarcode, setGeneratingBarcode] = useState(false);
  const [icpsLookupBusy, setIcpsLookupBusy] = useState(false);
  const [packageOptions, setPackageOptions] = useState<MxikPackageOption[]>([]);
  const [packageOptionsBusy, setPackageOptionsBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupParentId, setGroupParentId] = useState(0);
  const [loadedItemId, setLoadedItemId] = useState<number | null>(null);

  const scopedGroups = useMemo(
    () => filterProductGroups(groups, allowedProductGroupIds),
    [allowedProductGroupIds, groups],
  );

  const resetFormState = () => {
    setView("form");
    setBusy(false);
    setLoading(false);
    setError("");
    setForm(EMPTY_ITEM_FORM);
    setOriginalBarcodes([]);
    setBarcodeDraft("");
    setGeneratingBarcode(false);
    setIcpsLookupBusy(false);
    setPackageOptions([]);
    setPackageOptionsBusy(false);
    setScannerOpen(false);
    setEditingGroupId(null);
    setGroupName("");
    setGroupParentId(0);
    setLoadedItemId(null);
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

  useEffect(() => {
    if (!open) {
      resetFormState();
      return;
    }
    if (!token || !canEditItem || itemId <= 0) return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      setView("form");
      try {
        const [g, u, v, item] = await Promise.all([
          fetchProductGroups(token),
          fetchUnits(token),
          fetchTaxVats(token),
          fetchItem(token, itemId),
        ]);
        if (cancelled) return;
        setGroups(g.groups);
        setUnits(u);
        setTaxVats(v);
        const barcodes =
          item.barcodes?.length > 0
            ? item.barcodes
            : item.barcode
              ? [item.barcode]
              : [];
        setOriginalBarcodes(barcodes);
        setBarcodeDraft("");
        setForm({
          name: item.name,
          group_id: item.group_id || filterProductGroups(g.groups, allowedProductGroupIds)[0]?.id || 0,
          unit_id: item.unit_id || u[0]?.id || 0,
          vat_id: item.vat_id || v[0]?.id || 0,
          articul: item.articul ?? "",
          barcodes,
          icps: item.icps ?? "",
          package_code: item.package_code ?? "",
          is_labeled: Boolean(item.is_labeled),
          description: item.description ?? "",
        });
        setLoadedItemId(itemId);
        if (item.icps) {
          void loadPackageOptions(item.icps, item.package_code);
        } else {
          setPackageOptions([]);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(formatAuthError(err, t("stock.item.errors.loadItem", "Failed to load product")));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, itemId, token, canEditItem, allowedProductGroupIds, t]);

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
          package_code: prev.package_code.trim() ? prev.package_code : (hit.package_code ?? ""),
          is_labeled: prev.is_labeled || hit.is_labeled,
        };
      });
      if (applied) {
        void loadPackageOptions(hit.icps, hit.package_code);
      }
    } catch {
      // best-effort
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

  const removeBarcode = (value: string) => {
    setForm((prev) => ({
      ...prev,
      barcodes: prev.barcodes.filter((b) => b !== value),
    }));
  };

  const handleGenerateBarcode = async () => {
    if (!token || generatingBarcode || busy) return;
    setGeneratingBarcode(true);
    try {
      const { value } = await generateEan13(token);
      commitBarcode(value, { lookupTasnif: false });
    } catch (err: unknown) {
      toast.error(
        formatAuthError(err, t("stock.item.errors.generateBarcode", "Failed to generate barcode")),
      );
    } finally {
      setGeneratingBarcode(false);
    }
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
    if (!token || busy || !product || loadedItemId == null) return;
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
      await updateItem(token, loadedItemId, body);
      toast.success(t("stock.item.updated", "Product updated"));
      onSaved({
        id: product.id,
        name,
        articul: articul ?? undefined,
        barcode: barcodes[0],
        barcode_list: barcodes.join(", "),
        code: product.code,
      });
      onClose();
    } catch (err: unknown) {
      setError(formatAuthError(err, t("stock.item.errors.update", "Failed to update product")));
    } finally {
      setBusy(false);
    }
  };

  const title =
    view === "groupForm"
      ? editingGroupId
        ? t("stock.item.group.edit", "Edit group")
        : t("stock.item.group.create", "Create group")
      : t("stock.item.edit", "Edit product");

  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          if (view === "groupForm") {
            backToProductForm();
            return;
          }
          onClose();
        }}
        title={title}
        size="lg"
        fullscreen={isMobile}
        elevated
        modalClassName={stockStyles.addLineModal}
        bodyClassName={stockStyles.addLineModalBody}
      >
        {loading ? (
          <div className={stockStyles.errorInline}>{t("common.loading", "Loading…")}</div>
        ) : view === "groupForm" ? (
          <div className={stockStyles.addLineForm}>
            <div className={stockStyles.formField}>
              <label>{t("stock.item.group.fields.name", "Name")}</label>
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                autoFocus
              />
            </div>
            <div className={stockStyles.formField}>
              <label>{t("stock.item.group.fields.parent", "Parent group")}</label>
              <select
                value={groupParentId}
                onChange={(e) => setGroupParentId(Number(e.target.value))}
              >
                <option value={0}>{t("stock.item.group.root", "Root (no parent)")}</option>
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
            {error ? <div className={stockStyles.errorInline}>{error}</div> : null}
            <div className={stockStyles.formActions}>
              <Button type="button" variant="ghost" disabled={busy} onClick={backToProductForm}>
                {t("common.back", "Back")}
              </Button>
              <Button type="button" disabled={busy} onClick={() => void submitGroupForm()}>
                {editingGroupId ? t("common.save", "Save") : t("common.create", "Create")}
              </Button>
            </div>
          </div>
        ) : (
          <div className={stockStyles.addLineForm}>
            <div className={stockStyles.formField}>
              <label>{t("stock.item.fields.name", "Name")}</label>
              <input
                value={form.name}
                maxLength={ITEM_NAME_MAX_LENGTH}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                autoFocus
                disabled={busy || loadedItemId == null}
              />
            </div>
            <div className={stockStyles.formField}>
              <label>{t("stock.item.fields.group", "Group")}</label>
              <ProductGroupPicker
                groups={scopedGroups}
                value={form.group_id}
                disabled={busy || loadedItemId == null}
                onChange={(groupId) => setForm((prev) => ({ ...prev, group_id: groupId }))}
                onCreate={canCreateItem ? openCreateGroup : undefined}
                onEdit={canEditItem ? openEditGroup : undefined}
              />
            </div>
            <div className={stockStyles.formRow}>
              <div className={stockStyles.formField}>
                <label>{t("stock.item.fields.unit", "Unit")}</label>
                <select
                  value={form.unit_id}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, unit_id: Number(e.target.value) }))
                  }
                  disabled={busy || loadedItemId == null}
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={stockStyles.formField}>
                <label>{t("stock.item.fields.vat", "VAT")}</label>
                <select
                  value={form.vat_id}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, vat_id: Number(e.target.value) }))
                  }
                  disabled={busy || loadedItemId == null}
                >
                  {taxVats.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={stockStyles.formField}>
              <label>{t("stock.item.fields.articul", "SKU")}</label>
              <input
                value={form.articul}
                onChange={(e) => setForm((prev) => ({ ...prev, articul: e.target.value }))}
                disabled={busy || loadedItemId == null}
              />
            </div>
            <div className={stockStyles.formField}>
              <label>{t("stock.item.fields.barcode", "Barcode")}</label>
              <div className={stockStyles.barcodeField}>
                {form.barcodes.length > 0 ? (
                  <div className={stockStyles.barcodeChips}>
                    {form.barcodes.map((code) => (
                      <span key={code} className={stockStyles.barcodeChip}>
                        <span className={stockStyles.barcodeChipValue}>{code}</span>
                        <button
                          type="button"
                          className={stockStyles.barcodeChipRemove}
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
                <div className={stockStyles.barcodeInputRow}>
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
                    disabled={busy || loadedItemId == null}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    disabled={busy || loadedItemId == null}
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
                    disabled={busy || loadedItemId == null}
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
                    disabled={busy || generatingBarcode || loadedItemId == null}
                    aria-label={t("stock.item.generateBarcodeAria", "Generate EAN-13 barcode")}
                    title={t("stock.item.generateBarcode", "Generate barcode")}
                    onClick={() => void handleGenerateBarcode()}
                  >
                    <Barcode size={18} />
                  </Button>
                </div>
              </div>
            </div>
            <div className={`${stockStyles.formRow} ${stockStyles.formRowStack}`}>
              <div className={stockStyles.formField}>
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
                  disabled={busy || loadedItemId == null}
                  placeholder={
                    icpsLookupBusy
                      ? t("stock.item.icpsLookingUp", "Looking up IKPU…")
                      : undefined
                  }
                />
                {icpsLookupBusy ? (
                  <div className={stockStyles.fieldHint}>
                    {t("stock.item.icpsLookingUp", "Looking up IKPU…")}
                  </div>
                ) : null}
              </div>
              <div className={stockStyles.formField}>
                <label>{t("stock.item.fields.packageCode", "Package code")}</label>
                {packageOptions.length > 0 ? (
                  <select
                    value={form.package_code}
                    disabled={busy || packageOptionsBusy || loadedItemId == null}
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
                    disabled={busy || packageOptionsBusy || loadedItemId == null}
                    placeholder={
                      packageOptionsBusy
                        ? t("stock.item.packageLookingUp", "Loading packages…")
                        : undefined
                    }
                  />
                )}
                {packageOptionsBusy ? (
                  <div className={stockStyles.fieldHint}>
                    {t("stock.item.packageLookingUp", "Loading packages…")}
                  </div>
                ) : null}
              </div>
            </div>
            <div className={stockStyles.formField}>
              <label className={stockStyles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.is_labeled}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, is_labeled: e.target.checked }))
                  }
                  disabled={busy || loadedItemId == null}
                />
                <span>{t("stock.item.fields.isLabeled", "Subject to labeling")}</span>
              </label>
            </div>
            <div className={stockStyles.formField}>
              <label>{t("common.description")}</label>
              <input
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, description: e.target.value }))
                }
                disabled={busy || loadedItemId == null}
              />
            </div>

            {error ? <div className={stockStyles.errorInline}>{error}</div> : null}

            <div className={stockStyles.formActions}>
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button
                type="button"
                disabled={busy || loadedItemId == null}
                onClick={() => void submitForm()}
              >
                {t("common.save", "Save")}
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
            onScan={(barcode) => {
              setScannerOpen(false);
              commitBarcode(barcode);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
