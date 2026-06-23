import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  createDocPaymentSaleIdField,
  deleteRegosToken,
  fetchDocPaymentSaleIdField,
  fetchPosSettings,
  fetchRegosDefaults,
  fetchRegosReferenceOptions,
  fetchRegosTokenConfig,
  patchPosSettings,
  patchRegosDefaults,
  saveRegosToken,
} from "@/lib/settings-api";
import {
  deleteTelegramBot,
  fetchTelegramBotConfig,
  saveTelegramBot,
} from "@/lib/telegram-api";
import { formatAuthError, useAuth } from "@/store/auth";
import {
  formatTenderedQuickAmounts,
  parseTenderedQuickAmounts,
} from "@/lib/tendered-amounts";
import type {
  RegosCustomField,
  RegosDefaultOption,
  RegosReferenceOptionsResponse,
  VatCalculationType,
} from "@/types/settings";
import { VAT_CALCULATION_TYPE_OPTIONS } from "@/types/settings";
import { ReceiptTemplatesSection } from "@/components/Settings/ReceiptTemplatesSection";
import styles from "./settings.module.css";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

const EMPTY_OPTIONS: RegosReferenceOptionsResponse = {
  warehouses: [],
  price_types: [],
  partners: [],
  payment_categories: [],
  refund_payment_categories: [],
  attached_users: [],
};

function SettingsPage() {
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);

  const canManageSettings = Boolean(user?.permissions.includes("settings.manage"));

  const [options, setOptions] = useState<RegosReferenceOptionsResponse>(EMPTY_OPTIONS);
  const [integrationToken, setIntegrationToken] = useState("");
  const [isReplicable, setIsReplicable] = useState(false);
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [regosWebhookUrl, setRegosWebhookUrl] = useState<string | null>(null);
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
  const [allowOutOfStock, setAllowOutOfStock] = useState(false);
  const [autoOpenQtyKeypad, setAutoOpenQtyKeypad] = useState(false);
  const [tenderedAmountsInput, setTenderedAmountsInput] = useState("20, 50, 100");
  const [loadingPosSettings, setLoadingPosSettings] = useState(false);
  const [savingPosSettings, setSavingPosSettings] = useState(false);
  const [posSettingsError, setPosSettingsError] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [loadingRegos, setLoadingRegos] = useState(false);
  const [savingRegosDefaults, setSavingRegosDefaults] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [tokenInfo, setTokenInfo] = useState("");
  const [regosError, setRegosError] = useState("");
  const [regosInfo, setRegosInfo] = useState("");
  const [saleIdFieldConfigured, setSaleIdFieldConfigured] = useState(false);
  const [saleIdField, setSaleIdField] = useState<RegosCustomField | null>(null);
  const [creatingSaleIdField, setCreatingSaleIdField] = useState(false);
  const [saleIdFieldError, setSaleIdFieldError] = useState("");
  const [saleIdFieldInfo, setSaleIdFieldInfo] = useState("");
  const [loadingToken, setLoadingToken] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramBotConfigured, setTelegramBotConfigured] = useState(false);
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const [telegramWebhookUrl, setTelegramWebhookUrl] = useState<string | null>(null);
  const [loadingTelegramBot, setLoadingTelegramBot] = useState(false);
  const [savingTelegramBot, setSavingTelegramBot] = useState(false);
  const [telegramBotError, setTelegramBotError] = useState("");
  const [telegramBotInfo, setTelegramBotInfo] = useState("");

  const applyDefaults = (defaults: {
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
  }) => {
    setWarehouseId(defaults.warehouse ? String(defaults.warehouse.id) : "");
    setPriceTypeId(defaults.price_type ? String(defaults.price_type.id) : "");
    setPartnerId(defaults.partner ? String(defaults.partner.id) : "");
    setDerivedCurrency(defaults.currency);
    setDerivedFirm(defaults.firm);
    setPaymentCategoryId(
      defaults.payment_category ? String(defaults.payment_category.id) : "",
    );
    setRefundPaymentCategoryId(
      defaults.refund_payment_category ? String(defaults.refund_payment_category.id) : "",
    );
    setAttachedUserId(defaults.attached_user ? String(defaults.attached_user.id) : "");
    setVatCalculationType(defaults.vat_calculation_type);
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
    setRefundPaymentCategoryId("");
    setAttachedUserId("");
    setVatCalculationType("Exclude");
    setZeroQuantity(false);
    setZeroPrice(false);
    setSaleIdFieldConfigured(false);
    setSaleIdField(null);
    setSaleIdFieldError("");
    setSaleIdFieldInfo("");
  };

  const loadRegosOptions = async (authToken: string) => {
    const [defaults, nextOptions, saleIdFieldStatus] = await Promise.all([
      fetchRegosDefaults(authToken),
      fetchRegosReferenceOptions(authToken),
      fetchDocPaymentSaleIdField(authToken),
    ]);
    applyDefaults(defaults.defaults);
    setOptions(nextOptions);
    setSaleIdFieldConfigured(saleIdFieldStatus.configured);
    setSaleIdField(saleIdFieldStatus.field);
  };

  useEffect(() => {
    if (!token || !canManageSettings) return;

    let cancelled = false;
    setLoadingPosSettings(true);
    setPosSettingsError("");

    void fetchPosSettings(token)
      .then((res) => {
        if (cancelled) return;
        setAllowOutOfStock(res.settings.allow_out_of_stock);
        setAutoOpenQtyKeypad(res.settings.auto_open_qty_keypad);
        setTenderedAmountsInput(
          formatTenderedQuickAmounts(res.settings.tendered_quick_amounts),
        );
      })
      .catch((err) => {
        if (!cancelled) setPosSettingsError(formatAuthError(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingPosSettings(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canManageSettings, token]);

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
        setRegosWebhookUrl(config.webhook_url);

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

  useEffect(() => {
    if (!token || !canManageSettings) return;

    let cancelled = false;

    const loadTelegramBot = async () => {
      setLoadingTelegramBot(true);
      setTelegramBotError("");
      try {
        const config = await fetchTelegramBotConfig(token);
        if (cancelled) return;
        setTelegramBotConfigured(config.configured);
        setTelegramBotUsername(config.bot_username);
        setTelegramWebhookUrl(config.webhook_url);
        if (!config.configured) {
          setTelegramBotToken("");
        }
      } catch (err) {
        if (!cancelled) {
          setTelegramBotError(formatAuthError(err));
          setTelegramBotConfigured(false);
        }
      } finally {
        if (!cancelled) setLoadingTelegramBot(false);
      }
    };

    void loadTelegramBot();

    return () => {
      cancelled = true;
    };
  }, [canManageSettings, token]);

  const handleSaveTelegramBot = async () => {
    if (!token) return;

    const nextToken = telegramBotToken.trim();
    if (!nextToken) {
      setTelegramBotError("Bot token is required.");
      return;
    }

    setSavingTelegramBot(true);
    setTelegramBotError("");
    setTelegramBotInfo("");
    try {
      const res = await saveTelegramBot(token, { bot_token: nextToken });
      const bot = res.bot;
      setTelegramBotConfigured(Boolean(bot?.configured));
      setTelegramBotUsername(bot?.bot_username ?? null);
      setTelegramWebhookUrl(bot?.webhook_url ?? null);
      setTelegramBotToken("");
      setTelegramBotInfo("Telegram bot saved and webhook registered");
    } catch (err) {
      setTelegramBotError(formatAuthError(err));
    } finally {
      setSavingTelegramBot(false);
    }
  };

  const handleDeleteTelegramBot = async () => {
    if (!token) return;

    setSavingTelegramBot(true);
    setTelegramBotError("");
    setTelegramBotInfo("");
    try {
      await deleteTelegramBot(token);
      setTelegramBotConfigured(false);
      setTelegramBotUsername(null);
      setTelegramWebhookUrl(null);
      setTelegramBotToken("");
      setTelegramBotInfo("Telegram bot removed");
    } catch (err) {
      setTelegramBotError(formatAuthError(err));
    } finally {
      setSavingTelegramBot(false);
    }
  };

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

  const handleCreateSaleIdField = async () => {
    if (!token || !tokenConfigured) return;

    setCreatingSaleIdField(true);
    setSaleIdFieldError("");
    setSaleIdFieldInfo("");
    try {
      const res = await createDocPaymentSaleIdField(token);
      setSaleIdFieldConfigured(res.configured);
      setSaleIdField(res.field);
      setSaleIdFieldInfo(
        res.created
          ? "Sale ID field created in Regos."
          : "Sale ID field is already configured.",
      );
    } catch (err) {
      setSaleIdFieldError(formatAuthError(err));
    } finally {
      setCreatingSaleIdField(false);
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
        refund_payment_category_id: refundPaymentCategoryId
          ? Number(refundPaymentCategoryId)
          : null,
        attached_user_id: attachedUserId ? Number(attachedUserId) : null,
        vat_calculation_type: vatCalculationType,
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
    } catch (err) {
      setPosSettingsError(formatAuthError(err));
      setAllowOutOfStock((prev) => !checked);
    } finally {
      setSavingPosSettings(false);
    }
  };

  const handleAutoOpenQtyKeypadChange = async (checked: boolean) => {
    if (!token || !canManageSettings) return;

    setAutoOpenQtyKeypad(checked);
    setSavingPosSettings(true);
    setPosSettingsError("");
    try {
      const res = await patchPosSettings(token, { auto_open_qty_keypad: checked });
      setAutoOpenQtyKeypad(res.settings.auto_open_qty_keypad);
    } catch (err) {
      setPosSettingsError(formatAuthError(err));
      setAutoOpenQtyKeypad((prev) => !checked);
    } finally {
      setSavingPosSettings(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>Configure company defaults and integrations.</p>
      </header>

      {canManageSettings ? (
        <>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Company POS defaults</h2>
            <p className={styles.sectionDesc}>
              Default checkout behavior for users without personal overrides. Configure
              per-user settings from the Users menu.
            </p>

            <label className={styles.row}>
              <div>
                <div className={styles.rowTitle}>Allow out-of-stock sales</div>
                <div className={styles.rowDesc}>
                  When enabled, cashiers can add products with zero or negative stock to the cart.
                </div>
              </div>
              <span className={styles.switch}>
                <input
                  type="checkbox"
                  checked={allowOutOfStock}
                  disabled={loadingPosSettings || savingPosSettings}
                  onChange={(e) => void handleAllowOutOfStockChange(e.target.checked)}
                />
                <span className={styles.slider} />
              </span>
            </label>

            <label className={styles.row}>
              <div>
                <div className={styles.rowTitle}>Auto-open quantity keypad</div>
                <div className={styles.rowDesc}>
                  When enabled, adding a product to the cart opens the numeric keypad
                  automatically. Users without a personal override use this default.
                </div>
              </div>
              <span className={styles.switch}>
                <input
                  type="checkbox"
                  checked={autoOpenQtyKeypad}
                  disabled={loadingPosSettings || savingPosSettings}
                  onChange={(e) => void handleAutoOpenQtyKeypadChange(e.target.checked)}
                />
                <span className={styles.slider} />
              </span>
            </label>

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
                disabled={loadingPosSettings || savingPosSettings}
                placeholder="20, 50, 100"
                onChange={(e) => setTenderedAmountsInput(e.target.value)}
              />
              <button
                type="button"
                className={styles.saveBtn}
                disabled={loadingPosSettings || savingPosSettings}
                onClick={() => void handleSaveTenderedAmounts()}
              >
                {savingPosSettings ? "Saving…" : "Save amounts"}
              </button>
            </div>

            {posSettingsError ? <p className={styles.error}>{posSettingsError}</p> : null}
          </section>

          {token ? (
            <ReceiptTemplatesSection
              token={token}
              companyName={user?.company?.name ?? "Company"}
            />
          ) : null}

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
                    ? regosWebhookUrl
                      ? `Token saved. REGOS HandleWebhook URL: ${regosWebhookUrl}`
                      : "Token saved. Set TELEGRAM_WEBHOOK_BASE_URL on the server to show the REGOS webhook URL."
                    : "No integration token saved yet."}
              </p>
            </div>

            <div className={styles.subsection}>
              <div className={styles.rowTitle}>Payment sale ID field</div>
              <p className={styles.rowDesc}>
                Creates a custom Regos field on DocPayment documents (`sale_id`, stored as
                `field_sale_id`). Checkout and return payments store the wholesale or wholesale
                return document id in this field.
              </p>
              {saleIdFieldError ? <p className={styles.error}>{saleIdFieldError}</p> : null}
              {saleIdFieldInfo ? <p className={styles.success}>{saleIdFieldInfo}</p> : null}
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  disabled={
                    !tokenConfigured ||
                    loadingToken ||
                    loadingRegos ||
                    creatingSaleIdField ||
                    saleIdFieldConfigured
                  }
                  onClick={() => void handleCreateSaleIdField()}
                >
                  {creatingSaleIdField
                    ? "Creating..."
                    : saleIdFieldConfigured
                      ? "Sale ID field ready"
                      : "Create sale_id field"}
                </button>
              </div>
              {saleIdField ? (
                <p className={styles.note}>
                  Field `{saleIdField.key}` · {saleIdField.name} · {saleIdField.entity_type}
                </p>
              ) : tokenConfigured ? (
                <p className={styles.note}>Sale ID field is not configured yet.</p>
              ) : null}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>Telegram bot</h2>
                <p className={styles.sectionDesc}>
                  Connect a BotFather token so customers can send /start and subscribe via
                  webhook notifications.
                </p>
              </div>
            </div>

            {telegramBotError && <p className={styles.error}>{telegramBotError}</p>}
            {telegramBotInfo && <p className={styles.success}>{telegramBotInfo}</p>}

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Bot token</span>
                <input
                  className={styles.input}
                  type="password"
                  value={telegramBotToken}
                  disabled={loadingTelegramBot || savingTelegramBot}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  placeholder={
                    telegramBotConfigured ? "Enter a new token to replace the saved bot" : "BotFather token"
                  }
                />
              </label>
            </div>

            <div className={styles.actions}>
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={loadingTelegramBot || savingTelegramBot}
                  onClick={() => void handleSaveTelegramBot()}
                >
                  {savingTelegramBot ? "Saving..." : "Save bot token"}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  disabled={loadingTelegramBot || savingTelegramBot || !telegramBotConfigured}
                  onClick={() => void handleDeleteTelegramBot()}
                >
                  Remove bot
                </button>
              </div>
              <p className={styles.note}>
                {loadingTelegramBot
                  ? "Loading Telegram bot..."
                  : telegramBotConfigured
                    ? telegramBotUsername
                      ? `Connected as @${telegramBotUsername}. Webhook: ${telegramWebhookUrl ?? "registered"}`
                      : "Telegram bot is configured."
                    : "No Telegram bot saved yet. TELEGRAM_WEBHOOK_BASE_URL must be set on the server."}
              </p>
              {telegramBotConfigured && telegramBotUsername ? (
                <p className={styles.note}>
                  Bot link:{" "}
                  <a href={`https://t.me/${telegramBotUsername}`} target="_blank" rel="noreferrer">
                    t.me/{telegramBotUsername}
                  </a>
                </p>
              ) : null}
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
                <span className={styles.label}>Default payment category (income)</span>
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
                <span className={styles.label}>Default payment category (refund)</span>
                <select
                  className={styles.select}
                  value={refundPaymentCategoryId}
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setRefundPaymentCategoryId(e.target.value)}
                >
                  <option value="">Not selected</option>
                  {options.refund_payment_categories.map((item) => (
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

              <label className={styles.field}>
                <span className={styles.label}>VAT calculation type</span>
                <select
                  className={styles.select}
                  value={vatCalculationType}
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setVatCalculationType(e.target.value as VatCalculationType)}
                >
                  {VAT_CALCULATION_TYPE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
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
