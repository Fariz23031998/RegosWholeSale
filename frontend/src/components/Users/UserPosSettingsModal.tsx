import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePermissions } from "@/hooks/use-permissions";
import { fetchProductGroups } from "@/lib/catalog-api";
import { fetchPartnerGroups } from "@/lib/partners-api";
import { CategoryAllowlistField } from "./CategoryAllowlistField";
import { expandProductGroupIds, filterProductGroups } from "@/lib/category-scope";
import { subscribeReferenceOptionsEvents } from "@/lib/catalog-events";
import { fetchLabelStations, fetchLabelTemplates } from "@/lib/label-templates-api";
import { labelPrinterNames } from "@/lib/print-product-labels";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import {
  subscribeSettingsEvents,
  type SettingsEventMessage,
} from "@/lib/settings-events";
import {
  clearUserPosSettings,
  clearUserRegosDefaults,
  fetchCompanyPosSettings,
  fetchUserLabelPrintSettingsById,
  fetchUserPosSettingsById,
  fetchUserRegosDefaultsById,
  patchUserLabelPrintSettingsById,
  patchUserPosSettingsById,
  patchUserRegosDefaultsById,
} from "@/lib/users-api";
import {
  defaultCategoryToSelectValue,
  formatDefaultCategorySelectLabel,
  selectValueToDefaultCategory,
} from "@/lib/default-category";
import {
  formatTenderedQuickAmounts,
  parseTenderedQuickAmounts,
} from "@/lib/tendered-amounts";
import { formatAuthError } from "@/store/auth";
import type { ProductGroup } from "@/types/catalog";
import type { PartnerGroup } from "@/types/partners";
import type {
  RegosDefaultOption,
  RegosReferenceOptionsResponse,
  VatCalculationType,
} from "@/types/settings";
import { getVatCalculationTypeOptions } from "@/types/settings";
import type { LabelPrintService, LabelTemplate, UserLabelPrintMethod } from "@/types/label-templates";
import type { UserDetail } from "@/types/users";
import styles from "./Users.module.css";

type Props = {
  open: boolean;
  token: string;
  user: UserDetail | null;
  onClose: () => void;
};

const EMPTY_OPTIONS: RegosReferenceOptionsResponse = {
  warehouses: [],
  price_types: [],
  partners: [],
  payment_categories: [],
  refund_payment_categories: [],
  attached_users: [],
};

function applyRegosDefaults(defaults: {
  warehouse: RegosDefaultOption | null;
  price_type: RegosDefaultOption | null;
  partner: RegosDefaultOption | null;
  currency: RegosDefaultOption | null;
  firm: RegosDefaultOption | null;
  payment_category: RegosDefaultOption | null;
  refund_payment_category: RegosDefaultOption | null;
  attached_user: RegosDefaultOption | null;
  vat_calculation_type: VatCalculationType;
  zero_quantity: boolean;
  zero_price: boolean;
}) {
  return {
    warehouseId: defaults.warehouse ? String(defaults.warehouse.id) : "",
    priceTypeId: defaults.price_type ? String(defaults.price_type.id) : "",
    partnerId: defaults.partner ? String(defaults.partner.id) : "",
    paymentCategoryId: defaults.payment_category ? String(defaults.payment_category.id) : "",
    refundPaymentCategoryId: defaults.refund_payment_category
      ? String(defaults.refund_payment_category.id)
      : "",
    attachedUserId: defaults.attached_user ? String(defaults.attached_user.id) : "",
    vatCalculationType: defaults.vat_calculation_type,
    derivedCurrency: defaults.currency,
    derivedFirm: defaults.firm,
    zeroQuantity: defaults.zero_quantity,
    zeroPrice: defaults.zero_price,
  };
}

function isUserSettingsEventForUser(event: SettingsEventMessage, userId: number): boolean {
  if (
    event.namespace !== "pos" &&
    event.namespace !== "regos_defaults" &&
    event.namespace !== "label_print" &&
    event.namespace !== "label_templates"
  ) {
    return false;
  }
  if (event.scope === "company") return true;
  return event.user_id === userId;
}

function printServiceLabel(service: LabelPrintService): string {
  if (service.name.trim().toLowerCase() === service.printer_name.trim().toLowerCase()) {
    return service.name;
  }
  return `${service.name} (${service.printer_name})`;
}

export function UserPosSettingsModal({ open, token, user, onClose }: Props) {
  const { t } = useLanguage();
  const { canManagePrintSettings } = usePermissions();
  const canEditLabelPrint = canManagePrintSettings();
  const vatOptions = getVatCalculationTypeOptions(t);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resettingPos, setResettingPos] = useState(false);
  const [resettingRegos, setResettingRegos] = useState(false);
  const [error, setError] = useState("");
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([]);
  const [partnerGroups, setPartnerGroups] = useState<PartnerGroup[]>([]);
  const [allowedProductGroupIds, setAllowedProductGroupIds] = useState<number[]>([]);
  const [allowedPartnerGroupIds, setAllowedPartnerGroupIds] = useState<number[]>([]);
  const [companyAllowOutOfStock, setCompanyAllowOutOfStock] = useState(false);
  const [companyAutoOpenQtyKeypad, setCompanyAutoOpenQtyKeypad] = useState(false);
  const [companySearchTransliteration, setCompanySearchTransliteration] = useState(true);
  const [companySearchFuzzy, setCompanySearchFuzzy] = useState(true);
  const [companyTenderedAmounts, setCompanyTenderedAmounts] = useState("20, 50, 100");
  const [allowOutOfStock, setAllowOutOfStock] = useState(false);
  const [autoOpenQtyKeypad, setAutoOpenQtyKeypad] = useState(false);
  const [searchTransliteration, setSearchTransliteration] = useState(true);
  const [searchFuzzy, setSearchFuzzy] = useState(true);
  const [tenderedAmountsInput, setTenderedAmountsInput] = useState("20, 50, 100");
  const [defaultCategoryValue, setDefaultCategoryValue] = useState("all");
  const [companyDefaultCategoryValue, setCompanyDefaultCategoryValue] = useState("all");
  const [isMobile, setIsMobile] = useState(false);
  const [options, setOptions] = useState<RegosReferenceOptionsResponse>(EMPTY_OPTIONS);
  const [warehouseId, setWarehouseId] = useState("");
  const [priceTypeId, setPriceTypeId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [paymentCategoryId, setPaymentCategoryId] = useState("");
  const [refundPaymentCategoryId, setRefundPaymentCategoryId] = useState("");
  const [attachedUserId, setAttachedUserId] = useState("");
  const [vatCalculationType, setVatCalculationType] = useState<VatCalculationType>("Exclude");
  const [derivedCurrency, setDerivedCurrency] = useState<RegosDefaultOption | null>(null);
  const [derivedFirm, setDerivedFirm] = useState<RegosDefaultOption | null>(null);
  const [zeroQuantity, setZeroQuantity] = useState(false);
  const [zeroPrice, setZeroPrice] = useState(false);
  const [labelTemplates, setLabelTemplates] = useState<LabelTemplate[]>([]);
  const [labelServices, setLabelServices] = useState<LabelPrintService[]>([]);
  const [labelConnectedPrinters, setLabelConnectedPrinters] = useState<string[]>([]);
  const [labelTemplateId, setLabelTemplateId] = useState("");
  const [labelServiceId, setLabelServiceId] = useState("");
  const [labelPrinterName, setLabelPrinterName] = useState("");
  const [labelMethod, setLabelMethod] = useState<UserLabelPrintMethod>("service");
  const [labelPrompt, setLabelPrompt] = useState(true);
  const [labelUseWarehouseQuantity, setLabelUseWarehouseQuantity] = useState(false);
  const reloadSettingsRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open || !token || !user) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    const reload = () => {
      void Promise.all([
        fetchUserPosSettingsById(token, user.id),
        fetchCompanyPosSettings(token),
        fetchProductGroups(token),
        fetchPartnerGroups(token).catch(() => ({ groups: [] as PartnerGroup[] })),
        fetchUserRegosDefaultsById(token, user.id),
        fetchRegosReferenceOptions(token, {
          cacheScope: { companyId: user.company_id },
        }),
        canEditLabelPrint
          ? Promise.all([
              fetchUserLabelPrintSettingsById(token, user.id),
              fetchLabelTemplates(token),
              fetchLabelStations(token).catch(() => ({ stations: [] })),
            ])
          : Promise.resolve(null),
      ])
        .then(([userPosRes, companyPosRes, groupsRes, partnerGroupsRes, userRegosRes, refOptions, labelRes]) => {
          if (cancelled) return;
          setAllowOutOfStock(userPosRes.settings.allow_out_of_stock);
          setAutoOpenQtyKeypad(userPosRes.settings.auto_open_qty_keypad);
          setSearchTransliteration(userPosRes.settings.search_transliteration ?? true);
          setSearchFuzzy(userPosRes.settings.search_fuzzy ?? true);
          setTenderedAmountsInput(
            formatTenderedQuickAmounts(userPosRes.settings.tendered_quick_amounts),
          );
          setDefaultCategoryValue(
            defaultCategoryToSelectValue(userPosRes.settings.default_category),
          );
          setAllowedProductGroupIds(userPosRes.settings.allowed_product_group_ids ?? []);
          setAllowedPartnerGroupIds(userPosRes.settings.allowed_partner_group_ids ?? []);
          setCompanyAllowOutOfStock(companyPosRes.settings.allow_out_of_stock);
          setCompanyAutoOpenQtyKeypad(companyPosRes.settings.auto_open_qty_keypad);
          setCompanySearchTransliteration(
            companyPosRes.settings.search_transliteration ?? true,
          );
          setCompanySearchFuzzy(companyPosRes.settings.search_fuzzy ?? true);
          setCompanyTenderedAmounts(
            formatTenderedQuickAmounts(companyPosRes.settings.tendered_quick_amounts),
          );
          setCompanyDefaultCategoryValue(
            defaultCategoryToSelectValue(companyPosRes.settings.default_category),
          );
          setProductGroups(groupsRes.groups);
          setPartnerGroups(partnerGroupsRes.groups);

          const regos = applyRegosDefaults(userRegosRes.defaults);
          setWarehouseId(regos.warehouseId);
          setPriceTypeId(regos.priceTypeId);
          setPartnerId(regos.partnerId);
          setPaymentCategoryId(regos.paymentCategoryId);
          setRefundPaymentCategoryId(regos.refundPaymentCategoryId);
          setAttachedUserId(regos.attachedUserId);
          setVatCalculationType(regos.vatCalculationType);
          setDerivedCurrency(regos.derivedCurrency);
          setDerivedFirm(regos.derivedFirm);
          setZeroQuantity(regos.zeroQuantity);
          setZeroPrice(regos.zeroPrice);
          setOptions(refOptions);
          if (labelRes) {
            const [labelSettings, labelCompany, stationsResponse] = labelRes;
            const nextTemplates = labelCompany.settings.templates;
            const nextServices = labelCompany.settings.print.services ?? [];
            const savedPrinter = labelSettings.settings.printer_name?.trim() ?? "";
            setLabelTemplates(nextTemplates);
            setLabelServices(nextServices);
            setLabelConnectedPrinters(labelPrinterNames(stationsResponse.stations));
            setLabelTemplateId(labelSettings.settings.template_id ?? nextTemplates[0]?.id ?? "");
            setLabelServiceId(labelSettings.settings.service_id ?? nextServices[0]?.id ?? "");
            setLabelPrinterName(savedPrinter);
            setLabelMethod(labelSettings.settings.method);
            setLabelPrompt(labelSettings.settings.prompt_before_print);
            setLabelUseWarehouseQuantity(labelSettings.settings.use_warehouse_quantity);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(formatAuthError(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    reloadSettingsRef.current = reload;
    reload();

    return () => {
      cancelled = true;
    };
  }, [canEditLabelPrint, open, token, user]);

  useEffect(() => {
    if (!open || !user) return;

    return subscribeSettingsEvents((event) => {
      if (!isUserSettingsEventForUser(event, user.id)) return;
      reloadSettingsRef.current();
    });
  }, [open, user]);

  useEffect(() => {
    if (!open) return;

    return subscribeReferenceOptionsEvents(() => {
      reloadSettingsRef.current();
    });
  }, [open]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !user) return;

    const amounts = parseTenderedQuickAmounts(tenderedAmountsInput);
    if (amounts.length === 0) {
      setError(
        t(
          "users.settings.tenderedValidation",
          "Enter at least one positive tendered amount (e.g. 20, 50, 100).",
        ),
      );
      return;
    }

    setSaving(true);
    setError("");
    try {
      const defaultCategory = selectValueToDefaultCategory(defaultCategoryValue);
      const expandedProductIds = expandProductGroupIds(allowedProductGroupIds, productGroups);
      const scopedDefaultCategory =
        defaultCategory.mode === "group" &&
        defaultCategory.group_id != null &&
        expandedProductIds != null &&
        !expandedProductIds.has(defaultCategory.group_id)
          ? { mode: "all" as const, group_id: null }
          : defaultCategory;

      const [posRes, regosRes] = await Promise.all([
        patchUserPosSettingsById(token, user.id, {
          allow_out_of_stock: allowOutOfStock,
          auto_open_qty_keypad: autoOpenQtyKeypad,
          search_transliteration: searchTransliteration,
          search_fuzzy: searchFuzzy,
          tendered_quick_amounts: amounts,
          default_category: scopedDefaultCategory,
          allowed_product_group_ids: allowedProductGroupIds,
          allowed_partner_group_ids: allowedPartnerGroupIds,
        }),
        patchUserRegosDefaultsById(token, user.id, {
          warehouse_id: warehouseId ? Number(warehouseId) : null,
          price_type_id: priceTypeId ? Number(priceTypeId) : null,
          partner_id: partnerId ? Number(partnerId) : null,
          payment_category_id: paymentCategoryId ? Number(paymentCategoryId) : null,
          refund_payment_category_id: refundPaymentCategoryId
            ? Number(refundPaymentCategoryId)
            : null,
          attached_user_id: attachedUserId ? Number(attachedUserId) : null,
          vat_calculation_type: vatCalculationType,
          zero_quantity: zeroQuantity,
          zero_price: zeroPrice,
        }),
        canEditLabelPrint
          ? patchUserLabelPrintSettingsById(token, user.id, {
              template_id: labelTemplateId || null,
              service_id: labelServiceId || null,
              printer_name: labelPrinterName.trim() || null,
              method: labelMethod,
              prompt_before_print: labelPrompt,
              use_warehouse_quantity: labelUseWarehouseQuantity,
            })
          : Promise.resolve(null),
      ]);
      setAllowOutOfStock(posRes.settings.allow_out_of_stock);
      setAutoOpenQtyKeypad(posRes.settings.auto_open_qty_keypad);
      setSearchTransliteration(posRes.settings.search_transliteration ?? true);
      setSearchFuzzy(posRes.settings.search_fuzzy ?? true);
      setTenderedAmountsInput(
        formatTenderedQuickAmounts(posRes.settings.tendered_quick_amounts),
      );
      setDefaultCategoryValue(
        defaultCategoryToSelectValue(posRes.settings.default_category),
      );
      setAllowedProductGroupIds(posRes.settings.allowed_product_group_ids ?? []);
      setAllowedPartnerGroupIds(posRes.settings.allowed_partner_group_ids ?? []);
      const regos = applyRegosDefaults(regosRes.defaults);
      setWarehouseId(regos.warehouseId);
      setPriceTypeId(regos.priceTypeId);
      setPartnerId(regos.partnerId);
      setPaymentCategoryId(regos.paymentCategoryId);
      setRefundPaymentCategoryId(regos.refundPaymentCategoryId);
      setAttachedUserId(regos.attachedUserId);
      setVatCalculationType(regos.vatCalculationType);
      setDerivedCurrency(regos.derivedCurrency);
      setDerivedFirm(regos.derivedFirm);
      setZeroQuantity(regos.zeroQuantity);
      setZeroPrice(regos.zeroPrice);
      onClose();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleResetPos = async () => {
    if (!token || !user) return;

    setResettingPos(true);
    setError("");
    try {
      const res = await clearUserPosSettings(token, user.id);
      setAllowOutOfStock(res.settings.allow_out_of_stock);
      setAutoOpenQtyKeypad(res.settings.auto_open_qty_keypad);
      setSearchTransliteration(res.settings.search_transliteration ?? true);
      setSearchFuzzy(res.settings.search_fuzzy ?? true);
      setTenderedAmountsInput(
        formatTenderedQuickAmounts(res.settings.tendered_quick_amounts),
      );
      setDefaultCategoryValue(
        defaultCategoryToSelectValue(res.settings.default_category),
      );
      setAllowedProductGroupIds(res.settings.allowed_product_group_ids ?? []);
      setAllowedPartnerGroupIds(res.settings.allowed_partner_group_ids ?? []);
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setResettingPos(false);
    }
  };

  const handleResetRegos = async () => {
    if (!token || !user) return;

    setResettingRegos(true);
    setError("");
    try {
      const res = await clearUserRegosDefaults(token, user.id);
      const regos = applyRegosDefaults(res.defaults);
      setWarehouseId(regos.warehouseId);
      setPriceTypeId(regos.priceTypeId);
      setPartnerId(regos.partnerId);
      setPaymentCategoryId(regos.paymentCategoryId);
      setRefundPaymentCategoryId(regos.refundPaymentCategoryId);
      setAttachedUserId(regos.attachedUserId);
      setVatCalculationType(regos.vatCalculationType);
      setDerivedCurrency(regos.derivedCurrency);
      setDerivedFirm(regos.derivedFirm);
      setZeroQuantity(regos.zeroQuantity);
      setZeroPrice(regos.zeroPrice);
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setResettingRegos(false);
    }
  };

  const busy = loading || saving || resettingPos || resettingRegos;
  const labelPrinterOptions = useMemo(() => {
    const names = [...labelConnectedPrinters];
    const saved = labelPrinterName.trim();
    if (saved && !names.some((name) => name.toLowerCase() === saved.toLowerCase())) {
      names.unshift(saved);
    }
    return names;
  }, [labelConnectedPrinters, labelPrinterName]);

  const defaultCategoryGroups = useMemo(
    () => filterProductGroups(productGroups, allowedProductGroupIds),
    [allowedProductGroupIds, productGroups],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        user
          ? t("users.settings.titleWithName", "User settings — {{name}}", {
              name: user.display_name,
            })
          : t("users.settings.title", "User settings")
      }
      size="lg"
      fullscreen={isMobile}
    >
      <form onSubmit={handleSave} className={clsx(styles.formGrid, styles.settingsModalForm)}>
        {error && <div className={styles.formError}>{error}</div>}

        <p className={styles.hint}>
          {t(
            "users.settings.intro",
            "Personal overrides for this user. Leave blank to use company defaults.",
          )}
        </p>

        <div className={styles.sectionTitle}>{t("users.settings.pos", "POS")}</div>

        <div className={styles.field}>
          <div className={styles.label}>
            {t("users.settings.defaultCategory", "Default category")}
          </div>
          <p className={styles.hint}>
            {t(
              "users.settings.defaultCategoryHint",
              "Category selected automatically when this user opens the Sell screen.",
            )}{" "}
            {t("common.companyDefault", "Company default: {{value}}", {
              value: formatDefaultCategorySelectLabel(
                companyDefaultCategoryValue,
                productGroups,
                t,
              ),
            })}
          </p>
          <select
            className={styles.select}
            value={defaultCategoryValue}
            disabled={busy}
            onChange={(e) => setDefaultCategoryValue(e.target.value)}
          >
            <option value="all">{t("common.all", "All")}</option>
            <option value="featured">{t("users.settings.featured", "Featured")}</option>
            {defaultCategoryGroups.map((group) => (
              <option key={group.id} value={`group:${group.id}`}>
                {group.path || group.name}
              </option>
            ))}
          </select>
        </div>

        <CategoryAllowlistField
          label={t("users.settings.allowedProductCategories", "Product categories")}
          hint={t(
            "users.settings.allowedCategoriesHint",
            "Leave All checked to work with every category. Selecting a parent includes its subcategories.",
          )}
          allLabel={t("users.settings.allowedCategoriesAll", "All")}
          items={productGroups}
          selectedIds={allowedProductGroupIds}
          disabled={busy}
          indentByPath
          onChange={setAllowedProductGroupIds}
        />

        <CategoryAllowlistField
          label={t("users.settings.allowedPartnerCategories", "Partner categories")}
          hint={t(
            "users.settings.allowedCategoriesHint",
            "Leave All checked to work with every category. Selecting a parent includes its subcategories.",
          )}
          allLabel={t("users.settings.allowedCategoriesAll", "All")}
          items={partnerGroups}
          selectedIds={allowedPartnerGroupIds}
          disabled={busy}
          onChange={setAllowedPartnerGroupIds}
        />

        <div className={styles.field}>
          <div className={styles.switchRow}>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={autoOpenQtyKeypad}
                disabled={busy}
                onChange={(e) => setAutoOpenQtyKeypad(e.target.checked)}
              />
              <span className={styles.slider} />
            </label>
            <div>
              <div className={styles.label}>
                {t("users.settings.autoOpenQtyKeypad", "Auto-open quantity keypad")}
              </div>
              <p className={styles.hint}>
                {t(
                  "users.settings.autoOpenQtyKeypadDesc",
                  "Opens the quantity keypad when a product is added to the cart.",
                )}{" "}
                {t("common.companyDefault", "Company default: {{value}}", {
                  value: companyAutoOpenQtyKeypad
                    ? t("common.on", "on")
                    : t("common.off", "off"),
                })}
              </p>
            </div>
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.switchRow}>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={allowOutOfStock}
                disabled={busy}
                onChange={(e) => setAllowOutOfStock(e.target.checked)}
              />
              <span className={styles.slider} />
            </label>
            <div>
              <div className={styles.label}>
                {t("users.settings.allowOutOfStock", "Allow out-of-stock sales")}
              </div>
              <p className={styles.hint}>
                {t("common.companyDefault", "Company default: {{value}}", {
                  value: companyAllowOutOfStock
                    ? t("common.on", "on")
                    : t("common.off", "off"),
                })}
              </p>
            </div>
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.switchRow}>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={searchTransliteration}
                disabled={busy}
                onChange={(e) => setSearchTransliteration(e.target.checked)}
              />
              <span className={styles.slider} />
            </label>
            <div>
              <div className={styles.label}>
                {t("users.settings.searchTransliteration", "Search transliteration")}
              </div>
              <p className={styles.hint}>
                {t(
                  "users.settings.searchTransliterationDesc",
                  "Match Latin and Cyrillic spellings of the same product name (e.g. moloko ↔ молоко).",
                )}{" "}
                {t("common.companyDefault", "Company default: {{value}}", {
                  value: companySearchTransliteration
                    ? t("common.on", "on")
                    : t("common.off", "off"),
                })}
              </p>
            </div>
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.switchRow}>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={searchFuzzy}
                disabled={busy}
                onChange={(e) => setSearchFuzzy(e.target.checked)}
              />
              <span className={styles.slider} />
            </label>
            <div>
              <div className={styles.label}>
                {t("users.settings.searchFuzzy", "Fuzzy search")}
              </div>
              <p className={styles.hint}>
                {t(
                  "users.settings.searchFuzzyDesc",
                  "Allow small typos when searching the product catalog.",
                )}{" "}
                {t("common.companyDefault", "Company default: {{value}}", {
                  value: companySearchFuzzy
                    ? t("common.on", "on")
                    : t("common.off", "off"),
                })}
              </p>
            </div>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="user-tendered-amounts">
            {t("users.settings.tenderedShortcuts", "Amount tendered shortcuts")}
          </label>
          <p className={styles.hint}>
            {t("common.companyDefault", "Company default: {{value}}", {
              value: companyTenderedAmounts,
            })}
          </p>
          <input
            id="user-tendered-amounts"
            className={styles.input}
            type="text"
            inputMode="decimal"
            value={tenderedAmountsInput}
            disabled={busy}
            placeholder={t("settings.pos.tenderedPlaceholder", "20, 50, 100")}
            onChange={(e) => setTenderedAmountsInput(e.target.value)}
          />
        </div>

        <div className={styles.modalActions}>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void handleResetPos()}
          >
            {resettingPos
              ? t("common.resetting", "Resetting…")
              : t("users.settings.resetPos", "Reset POS to company")}
          </Button>
        </div>

        <div className={styles.sectionTitle}>
          {t("users.settings.regosDefaults", "Regos defaults")}
        </div>
        <p className={styles.hint}>
          {t(
            "users.settings.regosDesc",
            "Warehouse, price type, partner, and payment defaults for catalog and checkout. Currency and firm are resolved from price type and warehouse.",
          )}
        </p>

        <label className={styles.field}>
          <span className={styles.label}>
            {t("settings.defaults.warehouse", "Default warehouse")}
          </span>
          <select
            className={styles.select}
            value={warehouseId}
            disabled={busy}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">{t("common.useCompanyDefault", "Use company default")}</option>
            {options.warehouses.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            {t("settings.defaults.priceType", "Default price type")}
          </span>
          <select
            className={styles.select}
            value={priceTypeId}
            disabled={busy}
            onChange={(e) => setPriceTypeId(e.target.value)}
          >
            <option value="">{t("common.useCompanyDefault", "Use company default")}</option>
            {options.price_types.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            {t("settings.defaults.partner", "Default partner")}
          </span>
          <select
            className={styles.select}
            value={partnerId}
            disabled={busy}
            onChange={(e) => setPartnerId(e.target.value)}
          >
            <option value="">{t("common.useCompanyDefault", "Use company default")}</option>
            {options.partners.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.field}>
          <span className={styles.label}>
            {t("settings.defaults.currency", "Currency (from price type)")}
          </span>
          <p className={styles.hint}>
            {derivedCurrency
              ? derivedCurrency.name
              : t("settings.defaults.selectPriceType", "Select a price type")}
          </p>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>
            {t("settings.defaults.firm", "Firm (from warehouse)")}
          </span>
          <p className={styles.hint}>
            {derivedFirm
              ? derivedFirm.name
              : t("settings.defaults.selectWarehouse", "Select a warehouse")}
          </p>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>
            {t("settings.defaults.paymentCategoryIncome", "Default payment category (income)")}
          </span>
          <select
            className={styles.select}
            value={paymentCategoryId}
            disabled={busy}
            onChange={(e) => setPaymentCategoryId(e.target.value)}
          >
            <option value="">{t("common.useCompanyDefault", "Use company default")}</option>
            {options.payment_categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            {t("settings.defaults.paymentCategoryRefund", "Default payment category (refund)")}
          </span>
          <select
            className={styles.select}
            value={refundPaymentCategoryId}
            disabled={busy}
            onChange={(e) => setRefundPaymentCategoryId(e.target.value)}
          >
            <option value="">{t("common.useCompanyDefault", "Use company default")}</option>
            {options.refund_payment_categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            {t("users.settings.attachedUser", "Attached user")}
          </span>
          <select
            className={styles.select}
            value={attachedUserId}
            disabled={busy}
            onChange={(e) => setAttachedUserId(e.target.value)}
          >
            <option value="">{t("common.useCompanyDefault", "Use company default")}</option>
            {options.attached_users.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            {t("settings.defaults.vatType", "VAT calculation type")}
          </span>
          <select
            className={styles.select}
            value={vatCalculationType}
            disabled={busy}
            onChange={(e) => setVatCalculationType(e.target.value as VatCalculationType)}
          >
            {vatOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.row}>
          <div>
            <div className={styles.rowTitle}>
              {t("settings.defaults.zeroQuantity", "Include zero quantity products")}
            </div>
            <div className={styles.rowDesc}>
              {t(
                "settings.defaults.zeroQuantityDesc",
                "Show products with zero stock in the catalog.",
              )}
            </div>
          </div>
          <span className={styles.switch}>
            <input
              type="checkbox"
              checked={zeroQuantity}
              disabled={busy}
              onChange={(e) => setZeroQuantity(e.target.checked)}
            />
            <span className={styles.slider} />
          </span>
        </label>

        <label className={styles.row}>
          <div>
            <div className={styles.rowTitle}>
              {t("settings.defaults.zeroPrice", "Include zero price products")}
            </div>
            <div className={styles.rowDesc}>
              {t(
                "settings.defaults.zeroPriceDesc",
                "Show products with zero price in the catalog.",
              )}
            </div>
          </div>
          <span className={styles.switch}>
            <input
              type="checkbox"
              checked={zeroPrice}
              disabled={busy}
              onChange={(e) => setZeroPrice(e.target.checked)}
            />
            <span className={styles.slider} />
          </span>
        </label>

        {canEditLabelPrint ? (
          <>
            <div className={styles.sectionTitle}>
              {t("users.settings.labelPrint", "Label print")}
            </div>
            <p className={styles.hint}>
              {t(
                "users.settings.labelPrintDesc",
                "Default printer, template, and print method for this user.",
              )}
            </p>
            <label className={styles.field}>
              <span className={styles.label}>{t("products.defaultTemplate", "Default template")}</span>
              <select
                className={styles.select}
                value={labelTemplateId}
                disabled={busy || labelTemplates.length === 0}
                onChange={(event) => setLabelTemplateId(event.target.value)}
              >
                {labelTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            {labelTemplates.length === 0 ? (
              <p className={styles.hint}>{t("products.noTemplates", "No label template is configured.")}</p>
            ) : null}
            <label className={styles.field}>
              <span className={styles.label}>{t("products.service", "Print service")}</span>
              <select
                className={styles.select}
                value={labelServiceId}
                disabled={busy || labelServices.length === 0}
                onChange={(event) => setLabelServiceId(event.target.value)}
              >
                {labelServices.map((service) => (
                  <option key={service.id} value={service.id}>
                    {printServiceLabel(service)}
                  </option>
                ))}
              </select>
            </label>
            {labelServices.length === 0 ? (
              <p className={styles.hint}>{t("products.noServices", "No print service is configured.")}</p>
            ) : null}
            <label className={styles.field}>
              <span className={styles.label}>{t("products.defaultPrinter", "Default printer")}</span>
              <select
                className={styles.select}
                value={labelPrinterName}
                disabled={busy}
                onChange={(event) => setLabelPrinterName(event.target.value)}
              >
                <option value="">{t("products.noPrinterPreference", "No preference")}</option>
                {labelPrinterOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {labelPrinterOptions.length === 0 ? (
              <p className={styles.hint}>
                {t(
                  "products.noConnectedPrinters",
                  "No connected label printers. Connect Print Service to choose a default.",
                )}
              </p>
            ) : null}
            <label className={styles.field}>
              <span className={styles.label}>{t("products.printMethod", "Printing method")}</span>
              <select
                className={styles.select}
                value={labelMethod}
                disabled={busy}
                onChange={(event) => setLabelMethod(event.target.value as UserLabelPrintMethod)}
              >
                <option value="service">{t("products.printMethodService", "Print Service")}</option>
                <option value="browser">{t("products.printMethodBrowser", "Browser")}</option>
              </select>
            </label>
            <label className={styles.row}>
              <div>
                <div className={styles.rowTitle}>
                  {t("products.promptBeforePrint", "Open print settings before printing")}
                </div>
                <div className={styles.rowDesc}>
                  {t(
                    "products.promptBeforePrintDesc",
                    "Show the Print labels window before each print.",
                  )}
                </div>
              </div>
              <span className={styles.switch}>
                <input
                  type="checkbox"
                  checked={labelPrompt}
                  disabled={busy}
                  onChange={(event) => setLabelPrompt(event.target.checked)}
                />
                <span className={styles.slider} />
              </span>
            </label>
            <label className={styles.row}>
              <div>
                <div className={styles.rowTitle}>
                  {t("products.useWarehouseQuantity", "Print by warehouse quantity")}
                </div>
                <div className={styles.rowDesc}>
                  {t(
                    "products.useWarehouseQuantityDesc",
                    "Print one label per unit in stock for the selected warehouse.",
                  )}
                </div>
              </div>
              <span className={styles.switch}>
                <input
                  type="checkbox"
                  checked={labelUseWarehouseQuantity}
                  disabled={busy}
                  onChange={(event) => setLabelUseWarehouseQuantity(event.target.checked)}
                />
                <span className={styles.slider} />
              </span>
            </label>
          </>
        ) : null}

        <div className={styles.modalActions}>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void handleResetRegos()}
          >
            {resettingRegos
              ? t("common.resetting", "Resetting…")
              : t("users.settings.resetRegos", "Reset Regos to company")}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {saving
              ? t("common.saving", "Saving…")
              : t("users.settings.save", "Save settings")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
