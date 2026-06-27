import { useEffect, useState } from "react";
import clsx from "clsx";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { fetchProductGroups } from "@/lib/catalog-api";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import {
  clearUserPosSettings,
  clearUserRegosDefaults,
  fetchCompanyPosSettings,
  fetchUserPosSettingsById,
  fetchUserRegosDefaultsById,
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
import type {
  RegosDefaultOption,
  RegosReferenceOptionsResponse,
  VatCalculationType,
} from "@/types/settings";
import { getVatCalculationTypeOptions } from "@/types/settings";
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

export function UserPosSettingsModal({ open, token, user, onClose }: Props) {
  const { t } = useLanguage();
  const vatOptions = getVatCalculationTypeOptions(t);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resettingPos, setResettingPos] = useState(false);
  const [resettingRegos, setResettingRegos] = useState(false);
  const [error, setError] = useState("");
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([]);
  const [companyAllowOutOfStock, setCompanyAllowOutOfStock] = useState(false);
  const [companyAutoOpenQtyKeypad, setCompanyAutoOpenQtyKeypad] = useState(false);
  const [companyTenderedAmounts, setCompanyTenderedAmounts] = useState("20, 50, 100");
  const [allowOutOfStock, setAllowOutOfStock] = useState(false);
  const [autoOpenQtyKeypad, setAutoOpenQtyKeypad] = useState(false);
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

    void Promise.all([
      fetchUserPosSettingsById(token, user.id),
      fetchCompanyPosSettings(token),
      fetchProductGroups(token),
      fetchUserRegosDefaultsById(token, user.id),
      fetchRegosReferenceOptions(token),
    ])
      .then(([userPosRes, companyPosRes, groupsRes, userRegosRes, refOptions]) => {
        if (cancelled) return;
        setAllowOutOfStock(userPosRes.settings.allow_out_of_stock);
        setAutoOpenQtyKeypad(userPosRes.settings.auto_open_qty_keypad);
        setTenderedAmountsInput(
          formatTenderedQuickAmounts(userPosRes.settings.tendered_quick_amounts),
        );
        setDefaultCategoryValue(
          defaultCategoryToSelectValue(userPosRes.settings.default_category),
        );
        setCompanyAllowOutOfStock(companyPosRes.settings.allow_out_of_stock);
        setCompanyAutoOpenQtyKeypad(companyPosRes.settings.auto_open_qty_keypad);
        setCompanyTenderedAmounts(
          formatTenderedQuickAmounts(companyPosRes.settings.tendered_quick_amounts),
        );
        setCompanyDefaultCategoryValue(
          defaultCategoryToSelectValue(companyPosRes.settings.default_category),
        );
        setProductGroups(groupsRes.groups);

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
      })
      .catch((err) => {
        if (!cancelled) setError(formatAuthError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, token, user]);

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
      const [posRes, regosRes] = await Promise.all([
        patchUserPosSettingsById(token, user.id, {
          allow_out_of_stock: allowOutOfStock,
          auto_open_qty_keypad: autoOpenQtyKeypad,
          tendered_quick_amounts: amounts,
          default_category: selectValueToDefaultCategory(defaultCategoryValue),
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
      ]);
      setAllowOutOfStock(posRes.settings.allow_out_of_stock);
      setAutoOpenQtyKeypad(posRes.settings.auto_open_qty_keypad);
      setTenderedAmountsInput(
        formatTenderedQuickAmounts(posRes.settings.tendered_quick_amounts),
      );
      setDefaultCategoryValue(
        defaultCategoryToSelectValue(posRes.settings.default_category),
      );
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
      setTenderedAmountsInput(
        formatTenderedQuickAmounts(res.settings.tendered_quick_amounts),
      );
      setDefaultCategoryValue(
        defaultCategoryToSelectValue(res.settings.default_category),
      );
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
            {productGroups.map((group) => (
              <option key={group.id} value={`group:${group.id}`}>
                {group.path || group.name}
              </option>
            ))}
          </select>
        </div>

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
