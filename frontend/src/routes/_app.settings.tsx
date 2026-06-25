import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  createDocPaymentSaleIdField,
  deleteRegosToken,
  fetchDocPaymentSaleIdField,
  fetchPaymentLinking,
  fetchPosSettings,
  fetchRegosDefaults,
  fetchRegosReferenceOptions,
  fetchRegosTokenConfig,
  patchPaymentLinking,
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
  CrossCurrencyPaymentMode,
  PaymentLinkingMode,
  RegosCustomField,
  RegosDefaultOption,
  RegosReferenceOptionsResponse,
  VatCalculationType,
} from "@/types/settings";
import { getVatCalculationTypeOptions } from "@/types/settings";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
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
  const { t } = useLanguage();
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
  const [crossCurrencyPaymentMode, setCrossCurrencyPaymentMode] =
    useState<CrossCurrencyPaymentMode>("payment_currency");
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
  const [paymentLinkingMode, setPaymentLinkingMode] =
    useState<PaymentLinkingMode>("document_description");
  const [savingPaymentLinking, setSavingPaymentLinking] = useState(false);
  const [paymentLinkingError, setPaymentLinkingError] = useState("");
  const [paymentLinkingInfo, setPaymentLinkingInfo] = useState("");
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
    setPaymentLinkingMode("document_description");
    setPaymentLinkingError("");
    setPaymentLinkingInfo("");
  };

  const loadRegosOptions = async (authToken: string) => {
    const [defaults, nextOptions, saleIdFieldStatus, paymentLinking] = await Promise.all([
      fetchRegosDefaults(authToken),
      fetchRegosReferenceOptions(authToken),
      fetchDocPaymentSaleIdField(authToken),
      fetchPaymentLinking(authToken),
    ]);
    applyDefaults(defaults.defaults);
    setOptions(nextOptions);
    setSaleIdFieldConfigured(saleIdFieldStatus.configured);
    setSaleIdField(saleIdFieldStatus.field);
    setPaymentLinkingMode(paymentLinking.mode);
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
        setCrossCurrencyPaymentMode(
          res.settings.cross_currency_payment_mode ?? "payment_currency",
        );
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
      setTelegramBotError(t("settings.telegram.tokenRequired", "Bot token is required."));
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
      setTelegramBotInfo(
        t("settings.telegram.saved", "Telegram bot saved and webhook registered."),
      );
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
      setTelegramBotInfo(t("settings.telegram.removed", "Telegram bot removed."));
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
        setTokenError(
          t("settings.regos.tokenLength", "Integration token must be exactly 32 characters."),
        );
        return;
      }

      await saveRegosToken(token, {
        token: nextToken,
        is_replicable: isReplicable,
      });
      setIntegrationToken(nextToken);
      setTokenConfigured(true);
      setTokenInfo(t("settings.regos.tokenSaved", "Regos integration token saved."));

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
      setTokenInfo(t("settings.regos.tokenRemoved", "Regos integration token removed."));
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
          ? t("settings.saleIdField.created", "Sale ID field created and linked to payments.")
          : t(
              "settings.saleIdField.alreadyConfigured",
              "Sale ID field is already configured.",
            ),
      );
    } catch (err) {
      setSaleIdFieldError(formatAuthError(err));
    } finally {
      setCreatingSaleIdField(false);
    }
  };

  const handlePaymentLinkingModeChange = async (nextMode: PaymentLinkingMode) => {
    if (!token || !tokenConfigured || nextMode === paymentLinkingMode) return;

    setSavingPaymentLinking(true);
    setPaymentLinkingError("");
    setPaymentLinkingInfo("");
    try {
      const res = await patchPaymentLinking(token, { mode: nextMode });
      setPaymentLinkingMode(res.mode);
      setSaleIdFieldConfigured(res.sale_id_field_configured);
      setSaleIdField(res.sale_id_field);
      setPaymentLinkingInfo(
        t("settings.paymentLinking.saved", "Payment linking mode saved."),
      );
    } catch (err) {
      setPaymentLinkingError(formatAuthError(err));
    } finally {
      setSavingPaymentLinking(false);
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
      setRegosInfo(t("settings.defaults.saved", "Regos defaults saved"));
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
      setPosSettingsError(
        t(
          "settings.pos.tenderedValidation",
          "Enter at least one positive amount (e.g. 20, 50, 100).",
        ),
      );
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

  const handleCrossCurrencyPaymentModeChange = async (mode: CrossCurrencyPaymentMode) => {
    if (!token || !canManageSettings) return;

    const previous = crossCurrencyPaymentMode;
    setCrossCurrencyPaymentMode(mode);
    setSavingPosSettings(true);
    setPosSettingsError("");
    try {
      const res = await patchPosSettings(token, { cross_currency_payment_mode: mode });
      setCrossCurrencyPaymentMode(res.settings.cross_currency_payment_mode);
    } catch (err) {
      setPosSettingsError(formatAuthError(err));
      setCrossCurrencyPaymentMode(previous);
    } finally {
      setSavingPosSettings(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("settings.title", "Settings")}</h1>
        <p className={styles.subtitle}>
          {t("settings.subtitle", "Configure company defaults and integrations.")}
        </p>
      </header>

      {canManageSettings ? (
        <>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              {t("settings.pos.title", "Company POS defaults")}
            </h2>
            <p className={styles.sectionDesc}>
              {t(
                "settings.pos.subtitle",
                "Default checkout behavior for users without personal overrides. Configure per-user settings from the Users menu.",
              )}
            </p>

            <label className={styles.row}>
              <div>
                <div className={styles.rowTitle}>
                  {t("settings.pos.allowOutOfStock", "Allow out-of-stock sales")}
                </div>
                <div className={styles.rowDesc}>
                  {t(
                    "settings.pos.allowOutOfStockDesc",
                    "Let cashiers sell products even when stock is zero.",
                  )}
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
                <div className={styles.rowTitle}>
                  {t("settings.pos.autoOpenQtyKeypad", "Auto-open quantity keypad")}
                </div>
                <div className={styles.rowDesc}>
                  {t(
                    "settings.pos.autoOpenQtyKeypadDesc",
                    "Show the quantity keypad when a product is added to the cart.",
                  )}
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
              <div className={styles.rowTitle}>
                {t("settings.pos.crossCurrencyPayment", "Cross-currency payments")}
              </div>
              <div className={styles.rowDesc}>
                {t(
                  "settings.pos.crossCurrencyPaymentDesc",
                  "When sale and payment currencies differ, choose how Regos records the payment.",
                )}
              </div>
              <select
                className={styles.select}
                value={crossCurrencyPaymentMode}
                disabled={loadingPosSettings || savingPosSettings}
                onChange={(e) =>
                  void handleCrossCurrencyPaymentModeChange(
                    e.target.value as CrossCurrencyPaymentMode,
                  )
                }
              >
                <option value="payment_currency">
                  {t(
                    "settings.pos.crossCurrencyPaymentCurrency",
                    "Record in payment type currency",
                  )}
                </option>
                <option value="sale_currency_transfer">
                  {t(
                    "settings.pos.crossCurrencySaleCurrencyTransfer",
                    "Record in sale currency and transfer to payment account",
                  )}
                </option>
              </select>
            </div>

            <div className={styles.fieldBlock}>
              <div className={styles.rowTitle}>
                {t("settings.pos.tenderedShortcuts", "Amount tendered shortcuts")}
              </div>
              <div className={styles.rowDesc}>
                {t(
                  "settings.pos.tenderedShortcutsDesc",
                  "Quick buttons for cash payments (comma-separated amounts).",
                )}
              </div>
              <input
                className={styles.input}
                type="text"
                inputMode="decimal"
                value={tenderedAmountsInput}
                disabled={loadingPosSettings || savingPosSettings}
                placeholder={t("settings.pos.tenderedPlaceholder", "20, 50, 100")}
                onChange={(e) => setTenderedAmountsInput(e.target.value)}
              />
              <button
                type="button"
                className={styles.saveBtn}
                disabled={loadingPosSettings || savingPosSettings}
                onClick={() => void handleSaveTenderedAmounts()}
              >
                {savingPosSettings
                  ? t("common.saving", "Saving…")
                  : t("settings.pos.saveAmounts", "Save amounts")}
              </button>
            </div>

            {posSettingsError ? <p className={styles.error}>{posSettingsError}</p> : null}
          </section>

          <section className={styles.section}>
            <Link to="/receipt-templates" className={styles.settingsNavLink}>
              <div>
                <div className={styles.rowTitle}>
                  {t("settings.receiptTemplates.title", "Receipt templates")}
                </div>
                <div className={styles.rowDesc}>
                  {t(
                    "settings.receiptTemplates.settingsLinkDesc",
                    "Manage 80mm receipts, A4 invoices, and custom HTML templates.",
                  )}
                </div>
              </div>
              <ChevronRight size={18} aria-hidden />
            </Link>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>
                  {t("settings.regos.title", "Regos integration")}
                </h2>
                <p className={styles.sectionDesc}>
                  {t(
                    "settings.regos.desc",
                    "Save the integration token from regos_tokens so the app can fetch warehouses, price types, partners, and other Regos data.",
                  )}
                </p>
              </div>
            </div>

            {tokenError && <p className={styles.error}>{tokenError}</p>}
            {tokenInfo && <p className={styles.success}>{tokenInfo}</p>}

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>
                  {t("settings.regos.integrationToken", "Integration token")}
                </span>
                <input
                  className={styles.input}
                  type="text"
                  value={integrationToken}
                  disabled={loadingToken || savingToken}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setIntegrationToken(e.target.value)}
                  placeholder={t(
                    "settings.regos.tokenPlaceholder",
                    "32-character Regos integration token",
                  )}
                />
              </label>

              <label className={styles.row}>
                <div>
                  <div className={styles.rowTitle}>
                    {t("settings.regos.replicable", "Replicable token")}
                  </div>
                  <div className={styles.rowDesc}>
                    {t(
                      "settings.regos.replicableOAuthDesc",
                      "Enable OAuth bearer-token usage for replicable Regos integrations.",
                    )}
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
                  {savingToken
                    ? t("common.saving", "Saving…")
                    : t("settings.regos.saveToken", "Save integration token")}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  disabled={loadingToken || savingToken || !tokenConfigured}
                  onClick={() => void handleDeleteSavedToken()}
                >
                  {t("settings.regos.removeToken", "Remove token")}
                </button>
              </div>
              <p className={styles.note}>
                {loadingToken
                  ? t("settings.regos.loadingToken", "Loading integration token…")
                  : tokenConfigured
                    ? regosWebhookUrl
                      ? t(
                          "settings.regos.tokenSavedWebhook",
                          "Token saved. REGOS HandleWebhook URL: {{url}}",
                          { url: regosWebhookUrl },
                        )
                      : t(
                          "settings.regos.tokenSavedNoWebhookUrl",
                          "Token saved. Set TELEGRAM_WEBHOOK_BASE_URL on the server to show the REGOS webhook URL.",
                        )
                    : t("settings.regos.noToken", "No integration token saved yet.")}
              </p>
            </div>

            <div className={styles.subsection}>
              <div className={styles.rowTitle}>
                {t("settings.paymentLinking.title", "Payment linking")}
              </div>
              <p className={styles.rowDesc}>
                {t(
                  "settings.paymentLinking.longDesc",
                  "Choose how checkout and return payments are linked to their wholesale or return documents when listing payments later.",
                )}
              </p>
              {paymentLinkingError ? <p className={styles.error}>{paymentLinkingError}</p> : null}
              {paymentLinkingInfo ? <p className={styles.success}>{paymentLinkingInfo}</p> : null}
              <label className={styles.field}>
                <span className={styles.label}>
                  {t("settings.paymentLinking.mode", "Linking mode")}
                </span>
                <select
                  className={styles.input}
                  value={paymentLinkingMode}
                  disabled={
                    !tokenConfigured ||
                    loadingToken ||
                    loadingRegos ||
                    savingPaymentLinking
                  }
                  onChange={(e) =>
                    void handlePaymentLinkingModeChange(e.target.value as PaymentLinkingMode)
                  }
                >
                  <option value="document_description">
                    {t(
                      "settings.paymentLinking.documentDescription",
                      "Document description (pulse:pay:)",
                    )}
                  </option>
                  <option value="sale_id_field" disabled={!saleIdFieldConfigured}>
                    {t("settings.paymentLinking.saleIdField", "Custom sale_id field")}
                  </option>
                </select>
              </label>
              <p className={styles.note}>
                {paymentLinkingMode === "document_description"
                  ? t(
                      "settings.paymentLinking.documentDescriptionHelp",
                      "Payment document ids are stored in the wholesale or return document description as pulse:pay:3001,3002. No custom Regos fields are required.",
                    )
                  : t(
                      "settings.paymentLinking.saleIdFieldHelp",
                      "Each payment stores the source document id in the custom sale_id field on DocPayment.",
                    )}
              </p>
              {paymentLinkingMode === "sale_id_field" && !saleIdFieldConfigured ? (
                <p className={styles.note}>
                  {t(
                    "settings.paymentLinking.saleIdFieldRequired",
                    "Create the sale_id field below before selecting this mode.",
                  )}
                </p>
              ) : null}
            </div>

            <div className={styles.subsection}>
              <div className={styles.rowTitle}>
                {t("settings.saleIdField.title", "Payment sale ID field")}
              </div>
              <p className={styles.rowDesc}>
                {t(
                  "settings.saleIdField.longDesc",
                  "Creates a custom Regos field on DocPayment documents (sale_id, stored as field_sale_id). Checkout and return payments store the wholesale or wholesale return document id in this field.",
                )}
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
                    ? t("settings.saleIdField.creating", "Creating…")
                    : saleIdFieldConfigured
                      ? t("settings.saleIdField.ready", "Sale ID field ready")
                      : t("settings.saleIdField.create", "Create sale_id field")}
                </button>
              </div>
              {saleIdField ? (
                <p className={styles.note}>
                  {t(
                    "settings.saleIdField.fieldDetail",
                    "Field {{key}} · {{name}} · {{entity}}",
                    {
                      key: saleIdField.key,
                      name: saleIdField.name,
                      entity: saleIdField.entity_type,
                    },
                  )}
                </p>
              ) : tokenConfigured ? (
                <p className={styles.note}>
                  {t(
                    "settings.saleIdField.notConfigured",
                    "Sale ID field is not configured yet.",
                  )}
                </p>
              ) : null}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>
                  {t("settings.telegram.title", "Telegram bot")}
                </h2>
                <p className={styles.sectionDesc}>
                  {t(
                    "settings.telegram.desc",
                    "Connect a BotFather token so customers can send /start and subscribe via webhook notifications.",
                  )}
                </p>
              </div>
            </div>

            {telegramBotError && <p className={styles.error}>{telegramBotError}</p>}
            {telegramBotInfo && <p className={styles.success}>{telegramBotInfo}</p>}

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>
                  {t("settings.telegram.botToken", "Bot token")}
                </span>
                <input
                  className={styles.input}
                  type="password"
                  value={telegramBotToken}
                  disabled={loadingTelegramBot || savingTelegramBot}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  placeholder={
                    telegramBotConfigured
                      ? t(
                          "settings.telegram.replaceTokenPlaceholder",
                          "Enter a new token to replace the saved bot",
                        )
                      : t("settings.telegram.botFatherPlaceholder", "BotFather token")
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
                  {savingTelegramBot
                    ? t("common.saving", "Saving…")
                    : t("settings.telegram.saveToken", "Save bot token")}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  disabled={loadingTelegramBot || savingTelegramBot || !telegramBotConfigured}
                  onClick={() => void handleDeleteTelegramBot()}
                >
                  {t("settings.telegram.removeBot", "Remove bot")}
                </button>
              </div>
              <p className={styles.note}>
                {loadingTelegramBot
                  ? t("settings.telegram.loading", "Loading Telegram bot...")
                  : telegramBotConfigured
                    ? telegramBotUsername
                      ? t(
                          "settings.telegram.connectedWebhook",
                          "Connected as @{{username}}. Webhook: {{webhook}}",
                          {
                            username: telegramBotUsername,
                            webhook: telegramWebhookUrl ?? "registered",
                          },
                        )
                      : t("settings.telegram.configured", "Telegram bot is configured.")
                    : t(
                        "settings.telegram.noWebhookBaseUrl",
                        "No Telegram bot saved yet. TELEGRAM_WEBHOOK_BASE_URL must be set on the server.",
                      )}
              </p>
              {telegramBotConfigured && telegramBotUsername ? (
                <p className={styles.note}>
                  {t("settings.telegram.botLink", "Bot link:")}{" "}
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
                <h2 className={styles.sectionTitle}>
                  {t("settings.defaults.title", "Regos defaults")}
                </h2>
                <p className={styles.sectionDesc}>
                  {t(
                    "settings.defaults.desc",
                    "Default warehouse, price type, and partner for new sales.",
                  )}
                </p>
              </div>
            </div>

            {regosError && <p className={styles.error}>{regosError}</p>}
            {regosInfo && <p className={styles.success}>{regosInfo}</p>}

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>
                  {t("settings.defaults.warehouse", "Default warehouse")}
                </span>
                <select
                  className={styles.select}
                  value={warehouseId}
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setWarehouseId(e.target.value)}
                >
                  <option value="">{t("common.notSelected", "Not selected")}</option>
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
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setPriceTypeId(e.target.value)}
                >
                  <option value="">{t("common.notSelected", "Not selected")}</option>
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
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setPartnerId(e.target.value)}
                >
                  <option value="">{t("common.notSelected", "Not selected")}</option>
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
                <div className={styles.note}>
                  {derivedCurrency
                    ? derivedCurrency.name
                    : t("settings.defaults.selectPriceType", "Select a price type")}
                </div>
              </div>

              <div className={styles.field}>
                <span className={styles.label}>
                  {t("settings.defaults.firm", "Firm (from warehouse)")}
                </span>
                <div className={styles.note}>
                  {derivedFirm
                    ? derivedFirm.name
                    : t("settings.defaults.selectWarehouse", "Select a warehouse")}
                </div>
              </div>

              <label className={styles.field}>
                <span className={styles.label}>
                  {t("settings.defaults.paymentCategoryIncome", "Default payment category (income)")}
                </span>
                <select
                  className={styles.select}
                  value={paymentCategoryId}
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setPaymentCategoryId(e.target.value)}
                >
                  <option value="">{t("common.notSelected", "Not selected")}</option>
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
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setRefundPaymentCategoryId(e.target.value)}
                >
                  <option value="">{t("common.notSelected", "Not selected")}</option>
                  {options.refund_payment_categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>
                  {t("settings.defaults.attachedUser", "Attached user (optional)")}
                </span>
                <select
                  className={styles.select}
                  value={attachedUserId}
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setAttachedUserId(e.target.value)}
                >
                  <option value="">{t("common.notSelected", "Not selected")}</option>
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
                  disabled={
                    !tokenConfigured || loadingRegos || loadingToken || savingRegosDefaults
                  }
                  onChange={(e) => setVatCalculationType(e.target.value as VatCalculationType)}
                >
                  {getVatCalculationTypeOptions(t).map((item) => (
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
                {savingRegosDefaults
                  ? t("common.saving", "Saving…")
                  : t("settings.defaults.save", "Save Regos defaults")}
              </button>
              <p className={styles.note}>
                {!tokenConfigured
                  ? t("settings.defaults.saveTokenFirst", "Save the integration token first.")
                  : loadingRegos
                    ? t("settings.defaults.loadingRefs", "Loading Regos references…")
                    : t(
                        "settings.defaults.sharedNote",
                        "These settings are shared across all POS terminals in your company.",
                      )}
              </p>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
