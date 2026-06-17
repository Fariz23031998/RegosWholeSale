import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  deleteRegosToken,
  fetchPosSettings,
  fetchRegosDefaults,
  fetchRegosReferenceOptions,
  fetchRegosTokenConfig,
  fetchUserPosSettings,
  patchPosSettings,
  patchRegosDefaults,
  patchUserPosSettings,
  saveRegosToken,
} from "@/lib/settings-api";
import { fetchProductGroups } from "@/lib/catalog-api";
import {
  defaultCategoryToSelectValue,
  selectValueToDefaultCategory,
} from "@/lib/default-category";
import {
  formatTenderedQuickAmounts,
  parseTenderedQuickAmounts,
} from "@/lib/tendered-amounts";
import { formatAuthError, useAuth } from "@/store/auth";
import { useSettings } from "@/store/settings";
import { usePosConfig } from "@/store/pos-config";
import type {
  RegosDefaultOption,
  RegosReferenceOptionsResponse,
} from "@/types/settings";
import type { ProductGroup } from "@/types/catalog";
import styles from "./settings.module.css";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

const EMPTY_OPTIONS: RegosReferenceOptionsResponse = {
  warehouses: [],
  price_types: [],
  partners: [],
  payment_categories: [],
  attached_users: [],
};

function SettingsPage() {
  const autoOpen = useSettings((s) => s.autoOpenQtyKeypad);
  const setAutoOpen = useSettings((s) => s.setAutoOpenQtyKeypad);
  const hydratePosConfig = usePosConfig((s) => s.hydrate);
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);

  const canManageSettings = Boolean(user?.permissions.includes("settings.manage"));

  const [options, setOptions] = useState<RegosReferenceOptionsResponse>(EMPTY_OPTIONS);
  const [integrationToken, setIntegrationToken] = useState("");
  const [isReplicable, setIsReplicable] = useState(false);
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [priceTypeId, setPriceTypeId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [paymentCategoryId, setPaymentCategoryId] = useState("");
  const [attachedUserId, setAttachedUserId] = useState("");
  const [derivedCurrency, setDerivedCurrency] = useState<RegosDefaultOption | null>(null);
  const [derivedFirm, setDerivedFirm] = useState<RegosDefaultOption | null>(null);
  const [zeroQuantity, setZeroQuantity] = useState(false);
  const [zeroPrice, setZeroPrice] = useState(false);
  const [allowOutOfStock, setAllowOutOfStock] = useState(false);
  const [tenderedAmountsInput, setTenderedAmountsInput] = useState("20, 50, 100");
  const [savingPosSettings, setSavingPosSettings] = useState(false);
  const [posSettingsError, setPosSettingsError] = useState("");
  const [loadingToken, setLoadingToken] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [loadingRegos, setLoadingRegos] = useState(false);
  const [savingRegosDefaults, setSavingRegosDefaults] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [tokenInfo, setTokenInfo] = useState("");
  const [regosError, setRegosError] = useState("");
  const [regosInfo, setRegosInfo] = useState("");
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([]);
  const [defaultCategoryValue, setDefaultCategoryValue] = useState("all");
  const [loadingUserPosSettings, setLoadingUserPosSettings] = useState(false);
  const [savingUserPosSettings, setSavingUserPosSettings] = useState(false);
  const [userPosSettingsError, setUserPosSettingsError] = useState("");

  const applyDefaults = (defaults: {
    warehouse: RegosDefaultOption | null;
    price_type: RegosDefaultOption | null;
    partner: RegosDefaultOption | null;
    currency: RegosDefaultOption | null;
    firm: RegosDefaultOption | null;
    payment_category: RegosDefaultOption | null;
    attached_user: RegosDefaultOption | null;
    zero_quantity: boolean;
    zero_price: boolean;
  }) => {
    setWarehouseId(defaults.warehouse ? String(defaults.warehouse.id) : "");
    setPriceTypeId(defaults.price_type ? String(defaults.price_type.id) : "");
    setPartnerId(defaults.partner ? String(defaults.partner.id) : "");
    setDerivedCurrency(defaults.currency);
    setDerivedFirm(defaults.firm);
    setPaymentCategoryId(
      defaults.payment_category ? String(defaults.payment_category.id) : "",
    );
    setAttachedUserId(defaults.attached_user ? String(defaults.attached_user.id) : "");
    setZeroQuantity(defaults.zero_quantity);
    setZeroPrice(defaults.zero_price);
  };

  const clearRegosOptions = () => {
    setOptions(EMPTY_OPTIONS);
    setWarehouseId("");
    setPriceTypeId("");
    setPartnerId("");
    setDerivedCurrency(null);
    setDerivedFirm(null);
    setPaymentCategoryId("");
    setAttachedUserId("");
    setZeroQuantity(false);
    setZeroPrice(false);
  };

  const loadRegosOptions = async (authToken: string) => {
    const [defaults, nextOptions] = await Promise.all([
      fetchRegosDefaults(authToken),
      fetchRegosReferenceOptions(authToken),
    ]);
    applyDefaults(defaults.defaults);
    setOptions(nextOptions);
  };

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    void fetchPosSettings(token)
      .then((res) => {
        if (cancelled) return;
        setAllowOutOfStock(res.settings.allow_out_of_stock);
        setTenderedAmountsInput(
          formatTenderedQuickAmounts(res.settings.tendered_quick_amounts),
        );
      })
      .catch((err) => {
        if (!cancelled) setPosSettingsError(formatAuthError(err));
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    setLoadingUserPosSettings(true);
    setUserPosSettingsError("");

    void Promise.all([fetchUserPosSettings(token), fetchProductGroups(token)])
      .then(([settingsRes, groupsRes]) => {
        if (cancelled) return;
        setDefaultCategoryValue(
          defaultCategoryToSelectValue(settingsRes.settings.default_category),
        );
        setProductGroups(groupsRes.groups);
      })
      .catch((err) => {
        if (!cancelled) setUserPosSettingsError(formatAuthError(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingUserPosSettings(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleDefaultCategoryChange = async (value: string) => {
    if (!token) return;

    const previous = defaultCategoryValue;
    setDefaultCategoryValue(value);
    setSavingUserPosSettings(true);
    setUserPosSettingsError("");

    try {
      const res = await patchUserPosSettings(token, {
        default_category: selectValueToDefaultCategory(value),
      });
      setDefaultCategoryValue(
        defaultCategoryToSelectValue(res.settings.default_category),
      );
    } catch (err) {
      setDefaultCategoryValue(previous);
      setUserPosSettingsError(formatAuthError(err));
    } finally {
      setSavingUserPosSettings(false);
    }
  };

  useEffect(() => {
    if (!token || !canManageSettings) return;

    let cancelled = false;

    const load = async () => {
      setLoadingToken(true);
      setTokenError("");
      setTokenInfo("");
      try {
        const config = await fetchRegosTokenConfig(token);
        if (cancelled) return;
        setIntegrationToken(config.token);
        setIsReplicable(config.is_replicable);
        setTokenConfigured(config.configured);

        if (!config.configured) {
          clearRegosOptions();
          return;
        }

        setLoadingRegos(true);
        setRegosError("");
        try {
          await loadRegosOptions(token);
        } catch (err) {
          if (!cancelled) {
            setRegosError(formatAuthError(err));
            clearRegosOptions();
          }
        } finally {
          if (!cancelled) setLoadingRegos(false);
        }
      } catch (err) {
        if (!cancelled) {
          setTokenError(formatAuthError(err));
          setTokenConfigured(false);
          clearRegosOptions();
        }
      } finally {
        if (!cancelled) setLoadingToken(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [canManageSettings, token]);

  const handleSaveRegosToken = async () => {
    if (!token) return;

    const nextToken = integrationToken.trim();
    setSavingToken(true);
    setTokenError("");
    setTokenInfo("");

    try {
      if (nextToken.length !== 32) {
        setTokenError("Integration token must be exactly 32 characters.");
        return;
      }

      await saveRegosToken(token, {
        token: nextToken,
        is_replicable: isReplicable,
      });
      setIntegrationToken(nextToken);
      setTokenConfigured(true);
      setTokenInfo("Regos integration token saved");

      setLoadingRegos(true);
      setRegosError("");
      try {
        await loadRegosOptions(token);
      } catch (err) {
        setRegosError(formatAuthError(err));
      } finally {
        setLoadingRegos(false);
      }
    } catch (err) {
      setTokenError(formatAuthError(err));
    } finally {
      setSavingToken(false);
    }
  };

  const handleDeleteSavedToken = async () => {
    if (!token) return;

    setSavingToken(true);
    setTokenError("");
    setTokenInfo("");
    try {
      await deleteRegosToken(token);
      setIntegrationToken("");
      setIsReplicable(false);
      setTokenConfigured(false);
      clearRegosOptions();
      setTokenInfo("Regos integration token removed");
      setRegosError("");
      setRegosInfo("");
    } catch (err) {
      setTokenError(formatAuthError(err));
    } finally {
      setSavingToken(false);
    }
  };

  const handleSaveRegosDefaults = async () => {
    if (!token || !tokenConfigured) return;

    setSavingRegosDefaults(true);
    setRegosError("");
    setRegosInfo("");

    try {
      const res = await patchRegosDefaults(token, {
        warehouse_id: warehouseId ? Number(warehouseId) : null,
        price_type_id: priceTypeId ? Number(priceTypeId) : null,
        partner_id: partnerId ? Number(partnerId) : null,
        payment_category_id: paymentCategoryId ? Number(paymentCategoryId) : null,
        attached_user_id: attachedUserId ? Number(attachedUserId) : null,
        zero_quantity: zeroQuantity,
        zero_price: zeroPrice,
      });
      applyDefaults(res.defaults);
      setRegosInfo("Regos defaults saved");
    } catch (err) {
      setRegosError(formatAuthError(err));
    } finally {
      setSavingRegosDefaults(false);
    }
  };

  const handleSaveTenderedAmounts = async () => {
    if (!token || !canManageSettings) return;

    const amounts = parseTenderedQuickAmounts(tenderedAmountsInput);
    if (amounts.length === 0) {
      setPosSettingsError("Enter at least one positive amount (e.g. 20, 50, 100).");
      return;
    }

    setSavingPosSettings(true);
    setPosSettingsError("");
    try {
      const res = await patchPosSettings(token, { tendered_quick_amounts: amounts });
      setTenderedAmountsInput(
        formatTenderedQuickAmounts(res.settings.tendered_quick_amounts),
      );
      await hydratePosConfig(token);
    } catch (err) {
      setPosSettingsError(formatAuthError(err));
    } finally {
      setSavingPosSettings(false);
    }
  };

  const handleAllowOutOfStockChange = async (checked: boolean) => {
    if (!token || !canManageSettings) return;

    setAllowOutOfStock(checked);
    setSavingPosSettings(true);
    setPosSettingsError("");
    try {
      const res = await patchPosSettings(token, { allow_out_of_stock: checked });
      setAllowOutOfStock(res.settings.allow_out_of_stock);
      await hydratePosConfig(token);
    } catch (err) {
      setPosSettingsError(formatAuthError(err));
      setAllowOutOfStock((prev) => !checked);
    } finally {
      setSavingPosSettings(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>Configure your point of sale experience.</p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Sell</h2>

        <div className={styles.fieldBlock}>
          <div className={styles.rowTitle}>Default category</div>
          <div className={styles.rowDesc}>
            Category selected automatically when you open the Sell screen.
          </div>
          <select
            className={styles.select}
            value={defaultCategoryValue}
            disabled={loadingUserPosSettings || savingUserPosSettings}
            onChange={(e) => void handleDefaultCategoryChange(e.target.value)}
          >
            <option value="all">All</option>
            <option value="featured">Featured</option>
            {productGroups.map((group) => (
              <option key={group.id} value={`group:${group.id}`}>
                {group.path || group.name}
              </option>
            ))}
          </select>
        </div>

        {userPosSettingsError ? <p className={styles.error}>{userPosSettingsError}</p> : null}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Cart</h2>

        <label className={styles.row}>
          <div>
            <div className={styles.rowTitle}>Auto-open quantity keypad</div>
            <div className={styles.rowDesc}>
              When you add a product to the cart, automatically open the numeric
              keypad so you can type the exact quantity.
            </div>
          </div>
          <span className={styles.switch}>
            <input
              type="checkbox"
              checked={autoOpen}
              onChange={(e) => setAutoOpen(e.target.checked)}
            />
            <span className={styles.slider} />
          </span>
        </label>

        {canManageSettings ? (
          <label className={styles.row}>
            <div>
              <div className={styles.rowTitle}>Allow out-of-stock sales</div>
              <div className={styles.rowDesc}>
                When enabled, cashiers can add products with zero or negative stock to the cart.
                Default is off.
              </div>
            </div>
            <span className={styles.switch}>
              <input
                type="checkbox"
                checked={allowOutOfStock}
                disabled={savingPosSettings}
                onChange={(e) => void handleAllowOutOfStockChange(e.target.checked)}
              />
              <span className={styles.slider} />
            </span>
          </label>
        ) : null}

        <div className={styles.fieldBlock}>
          <div className={styles.rowTitle}>Amount tendered shortcuts</div>
          <div className={styles.rowDesc}>
            Quick amounts shown at cash checkout (after Exact). Separate values with commas.
            Up to 8 numbers.
          </div>
          <input
            className={styles.input}
            type="text"
            inputMode="decimal"
            value={tenderedAmountsInput}
            disabled={!canManageSettings || savingPosSettings}
            placeholder="20, 50, 100"
            onChange={(e) => setTenderedAmountsInput(e.target.value)}
          />
          {canManageSettings ? (
            <button
              type="button"
              className={styles.saveBtn}
              disabled={savingPosSettings}
              onClick={() => void handleSaveTenderedAmounts()}
            >
              {savingPosSettings ? "Saving…" : "Save amounts"}
            </button>
          ) : (
            <p className={styles.hint}>Only managers can change company checkout settings.</p>
          )}
        </div>

        {posSettingsError ? <p className={styles.error}>{posSettingsError}</p> : null}
      </section>

      {canManageSettings ? (
        <>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>Regos integration</h2>
                <p className={styles.sectionDesc}>
                  Save the integration token from `regos_tokens` so the app can fetch
                  warehouses, price types, partners, and other Regos data.
                </p>
              </div>
            </div>

            {tokenError && <p className={styles.error}>{tokenError}</p>}
            {tokenInfo && <p className={styles.success}>{tokenInfo}</p>}

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Integration token</span>
                <input
                  className={styles.input}
                  type="text"
                  value={integrationToken}
                  disabled={loadingToken || savingToken}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setIntegrationToken(e.target.value)}
                  placeholder="32-character Regos integration token"
                />
              </label>

              <label className={styles.row}>
                <div>
                  <div className={styles.rowTitle}>Replicable token</div>
                  <div className={styles.rowDesc}>
                    Enable OAuth bearer-token usage for replicable Regos integrations.
                  </div>
                </div>
                <span className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={isReplicable}
                    disabled={loadingToken || savingToken}
                    onChange={(e) => setIsReplicable(e.target.checked)}
                  />
                  <span className={styles.slider} />
                </span>
              </label>
            </div>

            <div className={styles.actions}>
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={loadingToken || savingToken}
                  onClick={() => void handleSaveRegosToken()}
                >
                  {savingToken ? "Saving..." : "Save integration token"}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  disabled={loadingToken || savingToken || !tokenConfigured}
                  onClick={() => void handleDeleteSavedToken()}
                >
                  Remove token
                </button>
              </div>
              <p className={styles.note}>
                {loadingToken
                  ? "Loading integration token..."
                  : tokenConfigured
                    ? "Token is saved in the regos_tokens table and used for Regos API calls."
                    : "No integration token saved yet."}
              </p>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>Regos defaults</h2>
                <p className={styles.sectionDesc}>
                  Choose warehouse, price type, partner, and payment defaults used for
                  checkout. Currency and firm are resolved automatically from the price type
                  and warehouse.
                </p>
              </div>
            </div>

            {regosError && <p className={styles.error}>{regosError}</p>}
            {regosInfo && <p className={styles.success}>{regosInfo}</p>}

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Default warehouse</span>
                <select
                  className={styles.select}
                  value={warehouseId}
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setWarehouseId(e.target.value)}
                >
                  <option value="">Not selected</option>
                  {options.warehouses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Default price type</span>
                <select
                  className={styles.select}
                  value={priceTypeId}
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setPriceTypeId(e.target.value)}
                >
                  <option value="">Not selected</option>
                  {options.price_types.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Default partner</span>
                <select
                  className={styles.select}
                  value={partnerId}
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setPartnerId(e.target.value)}
                >
                  <option value="">Not selected</option>
                  {options.partners.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className={styles.field}>
                <span className={styles.label}>Currency (from price type)</span>
                <div className={styles.note}>
                  {derivedCurrency ? derivedCurrency.name : "Select a price type"}
                </div>
              </div>

              <div className={styles.field}>
                <span className={styles.label}>Firm (from warehouse)</span>
                <div className={styles.note}>
                  {derivedFirm ? derivedFirm.name : "Select a warehouse"}
                </div>
              </div>

              <label className={styles.field}>
                <span className={styles.label}>Payment category</span>
                <select
                  className={styles.select}
                  value={paymentCategoryId}
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setPaymentCategoryId(e.target.value)}
                >
                  <option value="">Not selected</option>
                  {options.payment_categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Attached user (optional)</span>
                <select
                  className={styles.select}
                  value={attachedUserId}
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setAttachedUserId(e.target.value)}
                >
                  <option value="">Not selected</option>
                  {options.attached_users.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.row}>
                <div>
                  <div className={styles.rowTitle}>Include zero quantity products</div>
                  <div className={styles.rowDesc}>
                    Show products even when allowed stock is 0. Default is off.
                  </div>
                </div>
                <span className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={zeroQuantity}
                    disabled={
                      !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                    }
                    onChange={(e) => setZeroQuantity(e.target.checked)}
                  />
                  <span className={styles.slider} />
                </span>
              </label>

              <label className={styles.row}>
                <div>
                  <div className={styles.rowTitle}>Include zero price products</div>
                  <div className={styles.rowDesc}>
                    Show products even when Regos returns price 0. Default is off.
                  </div>
                </div>
                <span className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={zeroPrice}
                    disabled={
                      !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                    }
                    onChange={(e) => setZeroPrice(e.target.checked)}
                  />
                  <span className={styles.slider} />
                </span>
              </label>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btn}
                disabled={!tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults}
                onClick={() => void handleSaveRegosDefaults()}
              >
                {savingRegosDefaults ? "Saving..." : "Save Regos defaults"}
              </button>
              <p className={styles.note}>
                {!tokenConfigured
                  ? "Save the integration token first."
                  : loadingRegos
                    ? "Loading Regos references..."
                    : "These settings are shared for the whole company."}
              </p>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
