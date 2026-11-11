import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Column, ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/posui/Button";
import { columnHeaderLabel, DataTable } from "@/components/DataTable/DataTable";
import { CategoryAllowlistField } from "@/components/Users/CategoryAllowlistField";
import { useLanguage } from "@/contexts/LanguageContext";
import { fetchProductGroups } from "@/lib/catalog-api";
import {
  defaultEnabledPages,
  normalizeEnabledPages,
  normalizePageOverrides,
  PARTNER_PORTAL_PAGE_KEYS,
  PARTNER_PORTAL_PAGE_META,
  type PartnerEnabledPages,
  type PartnerPortalPageKey,
} from "@/lib/partner-portal-pages";
import {
  assignPartnerTelegramAccount,
  deletePartnerTelegramBot,
  fetchPartnerTelegramAccounts,
  fetchPartnerTelegramBot,
  fetchPartnerTelegramImportFields,
  importPartnerTelegramAccountsFromField,
  savePartnerTelegramBot,
  savePartnerTelegramBotSettings,
  updatePartnerTelegramAccount,
  type PartnerOrderDocumentType,
  type PartnerTelegramAccount,
  type PartnerTelegramImportFromFieldResponse,
} from "@/lib/partner-telegram-api";
import { fetchPartnerGroups, fetchPartners } from "@/lib/partners-api";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import { formatAuthError, useAuth } from "@/store/auth";
import type { Partner } from "@/types/partners";
import styles from "./PartnerTelegram.module.css";

type PageOverrideChoice = "default" | "on" | "off";
type PartnerTelegramTab = "bot" | "accounts";

const WEEKDAYS = [
  ["monday", 0, "Monday"],
  ["tuesday", 1, "Tuesday"],
  ["wednesday", 2, "Wednesday"],
  ["thursday", 3, "Thursday"],
  ["friday", 4, "Friday"],
  ["saturday", 5, "Saturday"],
  ["sunday", 6, "Sunday"],
] as const;

function toggleDay(current: number[], day: number): number[] {
  const next = current.includes(day) ? current.filter((item) => item !== day) : [...current, day];
  return next.sort((left, right) => left - right);
}

function balanceDaysToSave(
  option: "daily" | "weekdays" | "monthly",
  weekdays: number[],
  monthDays: string,
): number[] {
  if (option === "weekdays") return weekdays;
  if (option !== "monthly") return [];
  const days = monthDays
    .split(/[^0-9]+/)
    .map((item) => Number(item))
    .filter((item) => item >= 1 && item <= 31);
  return [...new Set(days)].sort((left, right) => left - right);
}

function accountName(account: PartnerTelegramAccount): string {
  const parts = [account.first_name, account.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (account.username) return `@${account.username}`;
  return `#${account.telegram_user_id}`;
}

export function PartnerTelegramPage() {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [botToken, setBotToken] = useState("");
  const [savingBot, setSavingBot] = useState(false);
  const [botError, setBotError] = useState("");
  const [botInfo, setBotInfo] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [priceTypeId, setPriceTypeId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [allowWarehouse, setAllowWarehouse] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [showQuantities, setShowQuantities] = useState(true);
  const [showZeroQuantity, setShowZeroQuantity] = useState(false);
  const [showZeroPrice, setShowZeroPrice] = useState(false);
  const [autoOpenQtyKeypad, setAutoOpenQtyKeypad] = useState(false);
  const [enabledPages, setEnabledPages] = useState<PartnerEnabledPages>(defaultEnabledPages);
  const [catalogGroupIds, setCatalogGroupIds] = useState<number[]>([]);
  const [balanceEnabled, setBalanceEnabled] = useState(false);
  const [balanceTime, setBalanceTime] = useState("09:00");
  const [balanceOption, setBalanceOption] = useState<"daily" | "weekdays" | "monthly">("daily");
  const [balanceDays, setBalanceDays] = useState<number[]>([]);
  const [monthDays, setMonthDays] = useState("");
  const [balanceTemplates, setBalanceTemplates] = useState({ uz: "", ru: "", en: "" });
  const [orderDocumentType, setOrderDocumentType] =
    useState<PartnerOrderDocumentType>("doc_order_from_partner");
  const [orderBooked, setOrderBooked] = useState(true);
  const [activeTab, setActiveTab] = useState<PartnerTelegramTab>("bot");
  const [importFieldId, setImportFieldId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSummary, setImportSummary] = useState<PartnerTelegramImportFromFieldResponse | null>(
    null,
  );

  const botQuery = useQuery({
    queryKey: ["partner-telegram", "bot", token],
    queryFn: () => fetchPartnerTelegramBot(token ?? ""),
    enabled: Boolean(token),
  });
  const accountsQuery = useQuery({
    queryKey: ["partner-telegram", "accounts", token],
    queryFn: () => fetchPartnerTelegramAccounts(token ?? ""),
    enabled: Boolean(token),
  });
  const importFieldsQuery = useQuery({
    queryKey: ["partner-telegram", "import-fields", token],
    queryFn: () => fetchPartnerTelegramImportFields(token ?? ""),
    enabled: Boolean(token && botQuery.data?.configured && activeTab === "accounts"),
  });
  const referencesQuery = useQuery({
    queryKey: ["partner-telegram", "references", token],
    queryFn: () => fetchRegosReferenceOptions(token ?? ""),
    enabled: Boolean(token && botQuery.data?.configured),
  });
  const groupsQuery = useQuery({
    queryKey: ["partner-telegram", "groups", token],
    queryFn: () => fetchPartnerGroups(token ?? ""),
    enabled: Boolean(token && botQuery.data?.configured),
  });
  const productGroupsQuery = useQuery({
    queryKey: ["partner-telegram", "product-groups", token],
    queryFn: () => fetchProductGroups(token ?? ""),
    enabled: Boolean(token && botQuery.data?.configured),
  });

  useEffect(() => {
    const bot = botQuery.data;
    if (!bot?.configured) return;
    setWarehouseId(bot.default_warehouse_id ? String(bot.default_warehouse_id) : "");
    setPriceTypeId(bot.default_price_type_id ? String(bot.default_price_type_id) : "");
    setGroupId(bot.default_partner_group_id ? String(bot.default_partner_group_id) : "");
    setAllowWarehouse(bot.allow_catalog_warehouse_selection);
    setAllowRegistration(bot.allow_self_registration);
    setShowQuantities(bot.show_product_quantities);
    setShowZeroQuantity(Boolean(bot.show_zero_quantity));
    setShowZeroPrice(Boolean(bot.show_zero_price));
    setAutoOpenQtyKeypad(Boolean(bot.auto_open_qty_keypad));
    setEnabledPages(normalizeEnabledPages(bot.enabled_pages));
    setCatalogGroupIds(bot.catalog_product_group_ids ?? []);
    setBalanceEnabled(Boolean(bot.balance_notify_enabled));
    setBalanceTime(bot.balance_notify_time || "09:00");
    const option = bot.balance_notify_option === "weekdays" || bot.balance_notify_option === "monthly"
      ? bot.balance_notify_option
      : "daily";
    setBalanceOption(option);
    const days = bot.balance_notify_days ?? [];
    if (option === "monthly") {
      setMonthDays(days.join(", "));
      setBalanceDays([]);
    } else {
      setBalanceDays(days);
      setMonthDays("");
    }
    const templates = bot.balance_notify_templates;
    setBalanceTemplates({
      uz: templates?.uz ?? "",
      ru: templates?.ru ?? "",
      en: templates?.en ?? "",
    });
    setOrderDocumentType(
      bot.order_document_type === "doc_wholesale" ? "doc_wholesale" : "doc_order_from_partner",
    );
    setOrderBooked(bot.order_booked !== false);
  }, [botQuery.data]);

  const saveBot = async () => {
    if (!token || !botToken.trim()) return;
    setSavingBot(true);
    setBotError("");
    setBotInfo("");
    try {
      const result = await savePartnerTelegramBot(token, botToken.trim());
      setBotToken("");
      setBotInfo(result.message);
      await queryClient.invalidateQueries({ queryKey: ["partner-telegram", "bot", token] });
    } catch (error) {
      setBotError(formatAuthError(error));
    } finally {
      setSavingBot(false);
    }
  };

  const saveSettings = async () => {
    if (!token) return;
    setSavingBot(true);
    setBotError("");
    setBotInfo("");
    try {
      await savePartnerTelegramBotSettings(token, {
        default_warehouse_id: warehouseId ? Number(warehouseId) : null,
        default_price_type_id: priceTypeId ? Number(priceTypeId) : null,
        allow_catalog_warehouse_selection: allowWarehouse,
        allow_self_registration: allowRegistration,
        show_product_quantities: showQuantities,
        show_zero_quantity: showZeroQuantity,
        show_zero_price: showZeroPrice,
        auto_open_qty_keypad: autoOpenQtyKeypad,
        default_partner_group_id: groupId ? Number(groupId) : null,
        catalog_product_group_ids: catalogGroupIds,
        enabled_pages: enabledPages,
        balance_notify_enabled: balanceEnabled,
        balance_notify_time: balanceTime || "09:00",
        balance_notify_option: balanceOption,
        balance_notify_days: balanceDaysToSave(balanceOption, balanceDays, monthDays),
        balance_notify_templates: balanceTemplates,
        order_document_type: orderDocumentType,
        order_booked: orderBooked,
      });
      setBotInfo(t("partnerTelegram.settingsSaved", "Partner bot defaults saved"));
      await queryClient.invalidateQueries({ queryKey: ["partner-telegram", "bot", token] });
    } catch (error) {
      setBotError(formatAuthError(error));
    } finally {
      setSavingBot(false);
    }
  };

  const removeBot = async () => {
    if (!token) return;
    setSavingBot(true);
    setBotError("");
    setBotInfo("");
    try {
      const result = await deletePartnerTelegramBot(token);
      setBotInfo(result.message);
      await queryClient.invalidateQueries({ queryKey: ["partner-telegram"] });
    } catch (error) {
      setBotError(formatAuthError(error));
    } finally {
      setSavingBot(false);
    }
  };

  const bot = botQuery.data;
  const accounts = accountsQuery.data ?? [];
  const accountColumns = useMemo<ColumnDef<PartnerTelegramAccount, any>[]>(
    () => [
      {
        id: "name",
        accessorFn: (account) => accountName(account),
        header: t("common.name", "Name"),
        size: 200,
      },
      {
        id: "phone",
        accessorFn: (account) => account.phone ?? "",
        header: t("partnerTelegram.phone", "Phone"),
        cell: ({ getValue }) => getValue<string>() || "—",
      },
      {
        id: "language",
        accessorFn: (account) => account.language_code ?? "",
        header: t("partnerTelegram.language", "Language"),
        cell: ({ getValue }) => getValue<string>() || "—",
      },
      {
        id: "partner",
        accessorFn: (account) => account.partner_name ?? "",
        header: t("partnerTelegram.partner", "Partner"),
      },
      {
        id: "warehouse",
        accessorFn: (account) => account.warehouse_id ?? 0,
        header: t("partnerTelegram.accountWarehouse", "Warehouse"),
        size: 180,
      },
      {
        id: "priceType",
        accessorFn: (account) => account.price_type_id ?? 0,
        header: t("partnerTelegram.accountPriceType", "Price type"),
        size: 180,
      },
      {
        id: "actions",
        header: t("common.actions", "Actions"),
        enableSorting: false,
        enableHiding: false,
        size: 240,
      },
    ],
    [t],
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t("partnerTelegram.pageTitle", "Partner Telegram")}</h1>
        <p className={styles.subtitle}>
          {t(
            "partnerTelegram.pageDescription",
            "Partners use a separate bot to get stock notifications, place orders, and view history.",
          )}
        </p>
      </div>

      <div className={styles.tabs} role="tablist" aria-label={t("partnerTelegram.tabsLabel", "Partner Telegram sections")}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "bot"}
          className={`${styles.tab} ${activeTab === "bot" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("bot")}
        >
          {t("partnerTelegram.botTitle", "Partner bot")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "accounts"}
          className={`${styles.tab} ${activeTab === "accounts" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("accounts")}
        >
          {t("partnerTelegram.accountsTitle", "Telegram accounts")}
        </button>
      </div>

      {botError ? <p className={styles.error}>{botError}</p> : null}
      {botInfo ? <p className={styles.meta}>{botInfo}</p> : null}

      {activeTab === "bot" ? (
        <div className={styles.tabPanel} role="tabpanel">
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>{t("partnerTelegram.botTitle", "Partner bot")}</h2>
            <p className={styles.hint}>
              {t(
                "partnerTelegram.botHint",
                "This bot is only for partners. Staff alerts stay on the other bot.",
              )}
            </p>
            <div className={styles.formRow}>
              <label className={styles.label}>
                {t("partnerTelegram.tokenLabel", "Bot token")}
                <input
                  className={styles.input}
                  value={botToken}
                  onChange={(event) => setBotToken(event.target.value)}
                  placeholder={bot?.configured ? bot.token_masked : ""}
                  autoComplete="off"
                />
              </label>
              <Button type="button" onClick={() => void saveBot()} disabled={savingBot || !botToken.trim()}>
                {t("partnerTelegram.save", "Save bot")}
              </Button>
              {bot?.configured ? (
                <Button type="button" variant="danger" onClick={() => void removeBot()} disabled={savingBot}>
                  {t("partnerTelegram.remove", "Remove bot")}
                </Button>
              ) : null}
            </div>
            {botQuery.isPending ? <p className={styles.hint}>{t("common.loading", "Loading...")}</p> : null}
            {bot && !bot.configured ? (
              <p className={styles.meta}>{t("partnerTelegram.notConfigured", "No partner bot configured.")}</p>
            ) : null}
            {bot?.configured ? (
              <div className={styles.meta}>
                <div>@{bot.bot_username}</div>
                <div>
                  {t("partnerTelegram.miniAppUrl", "Mini App URL")}: {bot.mini_app_url}
                </div>
                <div className={styles.settings}>
                  <label className={styles.label}>
                    {t("partnerTelegram.defaultWarehouse", "Default warehouse")}
                    <select className={styles.input} value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
                      <option value="">{t("partnerTelegram.useCompanyDefault", "Company default")}</option>
                      {(referencesQuery.data?.warehouses ?? []).map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.label}>
                    {t("partnerTelegram.defaultPriceType", "Default price type")}
                    <select className={styles.input} value={priceTypeId} onChange={(event) => setPriceTypeId(event.target.value)}>
                      <option value="">{t("partnerTelegram.useCompanyDefault", "Company default")}</option>
                      {(referencesQuery.data?.price_types ?? []).map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.label}>
                    {t("partnerTelegram.defaultGroup", "Group for new partners")}
                    <select className={styles.input} value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                      <option value="">{t("partnerTelegram.firstGroup", "First group")}</option>
                      {(groupsQuery.data?.groups ?? []).map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className={styles.fieldBlock}>
                    <div className={styles.fieldTitle}>
                      {t("partnerTelegram.orderDocumentType", "Portal order document")}
                    </div>
                    <div className={styles.fieldDesc}>
                      {t(
                        "partnerTelegram.orderDocumentTypeDesc",
                        "Choose which Regos document type is created when a partner places an order.",
                      )}
                    </div>
                    <select
                      className={styles.input}
                      value={orderDocumentType}
                      disabled={savingBot}
                      onChange={(event) =>
                        setOrderDocumentType(event.target.value as PartnerOrderDocumentType)
                      }
                    >
                      <option value="doc_wholesale">
                        {t("partnerTelegram.orderDocWholesale", "Wholesale sale (DocWholeSale)")}
                      </option>
                      <option value="doc_order_from_partner">
                        {t(
                          "partnerTelegram.orderDocOrderFromPartner",
                          "Partner order (DocOrderFromPartner)",
                        )}
                      </option>
                    </select>
                  </div>
                  {orderDocumentType === "doc_order_from_partner" ? (
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={orderBooked}
                        disabled={savingBot}
                        onChange={(event) => setOrderBooked(event.target.checked)}
                      />
                      <span>
                        <span className={styles.fieldTitle}>
                          {t("partnerTelegram.orderBooked", "Booked")}
                        </span>
                        <span className={styles.fieldDesc} style={{ display: "block" }}>
                          {t(
                            "partnerTelegram.orderBookedDesc",
                            "Mark partner portal orders as booked in Regos.",
                          )}
                        </span>
                      </span>
                    </label>
                  ) : null}
                  <label className={styles.check}>
                    <input type="checkbox" checked={allowWarehouse} onChange={(event) => setAllowWarehouse(event.target.checked)} />
                    {t("partnerTelegram.allowWarehouse", "Let partners choose a warehouse in the catalog")}
                  </label>
                  <label className={styles.check}>
                    <input type="checkbox" checked={allowRegistration} onChange={(event) => setAllowRegistration(event.target.checked)} />
                    {t("partnerTelegram.allowSelfRegistration", "Create a partner card when the phone number is new")}
                  </label>
                  <label className={styles.check}>
                    <input type="checkbox" checked={showQuantities} onChange={(event) => setShowQuantities(event.target.checked)} />
                    {t("partnerTelegram.showProductQuantities", "Show product quantities in the catalog")}
                  </label>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={showZeroQuantity}
                      onChange={(event) => setShowZeroQuantity(event.target.checked)}
                    />
                    <span>
                      <span className={styles.fieldTitle}>
                        {t("partnerTelegram.showZeroQuantity", "Show products with zero quantity")}
                      </span>
                      <span className={styles.fieldDesc} style={{ display: "block" }}>
                        {t(
                          "partnerTelegram.showZeroQuantityDesc",
                          "Include out-of-stock products in the partner catalog (except when the partner selects In stock or Low stock).",
                        )}
                      </span>
                    </span>
                  </label>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={showZeroPrice}
                      onChange={(event) => setShowZeroPrice(event.target.checked)}
                    />
                    <span>
                      <span className={styles.fieldTitle}>
                        {t("partnerTelegram.showZeroPrice", "Show products with zero price")}
                      </span>
                      <span className={styles.fieldDesc} style={{ display: "block" }}>
                        {t(
                          "partnerTelegram.showZeroPriceDesc",
                          "Include products with a zero price in the partner catalog.",
                        )}
                      </span>
                    </span>
                  </label>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={autoOpenQtyKeypad}
                      onChange={(event) => setAutoOpenQtyKeypad(event.target.checked)}
                    />
                    <span>
                      <span className={styles.fieldTitle}>
                        {t("partnerTelegram.autoOpenQtyKeypad", "Auto-open quantity keypad")}
                      </span>
                      <span className={styles.fieldDesc} style={{ display: "block" }}>
                        {t(
                          "partnerTelegram.autoOpenQtyKeypadDesc",
                          "Open the quantity keypad (without price) when a partner taps a product.",
                        )}
                      </span>
                    </span>
                  </label>
                  <div>
                    <div className={styles.label}>{t("partnerTelegram.portalPages", "Portal pages")}</div>
                    <p className={styles.hint}>
                      {t(
                        "partnerTelegram.portalPagesHint",
                        "These defaults apply to every partner. Individual accounts can override them.",
                      )}
                    </p>
                    <div className={styles.pageList}>
                      {PARTNER_PORTAL_PAGE_KEYS.map((key) => (
                        <label key={key} className={styles.check}>
                          <input
                            type="checkbox"
                            checked={enabledPages[key]}
                            onChange={(event) =>
                              setEnabledPages((current) => ({ ...current, [key]: event.target.checked }))
                            }
                          />
                          {t(PARTNER_PORTAL_PAGE_META[key].labelKey, PARTNER_PORTAL_PAGE_META[key].fallback)}
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={balanceEnabled}
                      onChange={(event) => setBalanceEnabled(event.target.checked)}
                    />
                    {t("partnerTelegram.balanceSchedule", "Send balance notifications")}
                  </label>
                  <p className={styles.hint}>
                    {t(
                      "partnerTelegram.balanceScheduleHint",
                      "At the chosen time, linked partners who owe the company receive a balance message and an Excel file.",
                    )}
                  </p>
                  <label className={styles.label}>
                    {t("partnerTelegram.balanceTime", "Time")}
                    <input
                      className={styles.input}
                      type="time"
                      value={balanceTime}
                      onChange={(event) => setBalanceTime(event.target.value)}
                    />
                  </label>
                  <label className={styles.label}>
                    {t("partnerTelegram.balanceOption", "Schedule")}
                    <select
                      className={styles.input}
                      value={balanceOption}
                      onChange={(event) => {
                        const next = event.target.value as "daily" | "weekdays" | "monthly";
                        setBalanceOption(next);
                        if (next === "weekdays" && balanceDays.length === 0) setBalanceDays([0]);
                        if (next === "monthly" && !monthDays.trim()) setMonthDays("1");
                      }}
                    >
                      <option value="daily">{t("partnerTelegram.balanceOption.daily", "Every day")}</option>
                      <option value="weekdays">{t("partnerTelegram.balanceOption.weekdays", "Selected weekdays")}</option>
                      <option value="monthly">{t("partnerTelegram.balanceOption.monthly", "Selected days of the month")}</option>
                    </select>
                  </label>
                  {balanceOption === "weekdays" ? (
                    <div>
                      <div className={styles.label}>{t("partnerTelegram.balanceWeekdays", "Weekdays")}</div>
                      <div className={styles.dayList}>
                        {WEEKDAYS.map(([key, day, label]) => (
                          <label key={key}>
                            <input
                              type="checkbox"
                              checked={balanceDays.includes(day)}
                              onChange={() => setBalanceDays((current) => toggleDay(current, day))}
                            />
                            {t(`partnerTelegram.weekday.${key}`, label)}
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {balanceOption === "monthly" ? (
                    <label className={styles.label}>
                      {t("partnerTelegram.balanceMonthDays", "Days of the month")}
                      <input
                        className={styles.input}
                        value={monthDays}
                        onChange={(event) => setMonthDays(event.target.value)}
                        placeholder="1, 15"
                      />
                      <span className={styles.hint}>
                        {t("partnerTelegram.balanceMonthDaysHint", "Comma-separated days from 1 to 31.")}
                      </span>
                    </label>
                  ) : null}
                  <div>
                    <div className={styles.label}>{t("partnerTelegram.balanceTemplates", "Message templates")}</div>
                    <p className={styles.hint}>
                      {t(
                        "partnerTelegram.balanceTemplatesHint",
                        "Leave a language blank to use the built-in message. Placeholders: {{partner_id}}, {{partner_name}}, {{balances}}, and {{balances_positive}}.",
                      )}
                    </p>
                    {(["uz", "ru", "en"] as const).map((lang) => (
                      <label key={lang} className={styles.label}>
                        {t(`partnerTelegram.balanceTemplate.${lang}`, lang === "uz" ? "Uzbek" : lang === "ru" ? "Russian" : "English")}
                        <textarea
                          className={styles.textarea}
                          value={balanceTemplates[lang]}
                          onChange={(event) =>
                            setBalanceTemplates((current) => ({ ...current, [lang]: event.target.value }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <CategoryAllowlistField
                    label={t("partnerTelegram.catalogCategories", "Product categories")}
                    hint={t(
                      "partnerTelegram.catalogCategoriesHint",
                      "Leave All checked to show every category. Selecting a parent includes its subcategories.",
                    )}
                    allLabel={t("partnerTelegram.catalogCategoriesAll", "All")}
                    items={productGroupsQuery.data?.groups ?? []}
                    selectedIds={catalogGroupIds}
                    disabled={savingBot}
                    indentByPath
                    onChange={setCatalogGroupIds}
                  />
                  <Button type="button" onClick={() => void saveSettings()} disabled={savingBot}>
                    {t("partnerTelegram.saveSettings", "Save defaults")}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : (
        <div className={styles.tabPanel} role="tabpanel">
          <section className={`${styles.card} ${styles.importCard}`}>
            <h2 className={styles.cardTitle}>
              {t("partnerTelegram.importTitle", "Import from Regos")}
            </h2>
            <p className={styles.hint}>
              {t(
                "partnerTelegram.importHint",
                "Select the partner field that stores Telegram user IDs, then import linked accounts for partners already registered in the old system.",
              )}
            </p>
            <div className={styles.formRow}>
              <label className={styles.label}>
                {t("partnerTelegram.importField", "Partner field")}
                <select
                  className={styles.input}
                  value={importFieldId}
                  disabled={importFieldsQuery.isPending || importing || !bot?.configured}
                  onChange={(event) => {
                    setImportFieldId(event.target.value);
                    setImportError("");
                    setImportSummary(null);
                  }}
                >
                  <option value="">
                    {t("partnerTelegram.importFieldPlaceholder", "Select a field")}
                  </option>
                  {(importFieldsQuery.data?.fields ?? []).map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.label}
                      {field.kind === "custom"
                        ? ` (${t("partnerTelegram.importFieldCustom", "custom")})`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                disabled={!importFieldId || importing || !bot?.configured}
                onClick={() => {
                  if (!token || !importFieldId) return;
                  setImporting(true);
                  setImportError("");
                  setImportSummary(null);
                  void importPartnerTelegramAccountsFromField(token, importFieldId)
                    .then(async (summary) => {
                      setImportSummary(summary);
                      await queryClient.invalidateQueries({
                        queryKey: ["partner-telegram", "accounts", token],
                      });
                    })
                    .catch((error) => setImportError(formatAuthError(error)))
                    .finally(() => setImporting(false));
                }}
              >
                {importing
                  ? t("partnerTelegram.importing", "Importing…")
                  : t("partnerTelegram.importAction", "Import")}
              </Button>
            </div>
            {importFieldsQuery.error ? (
              <p className={styles.error}>{formatAuthError(importFieldsQuery.error)}</p>
            ) : null}
            {importError ? <p className={styles.error}>{importError}</p> : null}
            {importSummary ? (
              <p className={styles.meta}>
                {t(
                  "partnerTelegram.importSummary",
                  "Created {{created}}, already imported {{already}}, empty {{empty}}, invalid {{invalid}}, duplicate Telegram ID {{duplicate}}, partner already linked {{linked}} (of {{total}} partners).",
                  {
                    created: importSummary.created,
                    already: importSummary.already_imported,
                    empty: importSummary.skipped_empty,
                    invalid: importSummary.skipped_invalid,
                    duplicate: importSummary.skipped_duplicate,
                    linked: importSummary.skipped_partner_linked,
                    total: importSummary.total_partners,
                  },
                )}
              </p>
            ) : null}
          </section>
          <section className={`${styles.card} ${styles.accountsCard}`}>
            <h2 className={styles.cardTitle}>{t("partnerTelegram.accountsTitle", "Telegram accounts")}</h2>
            {accountsQuery.isPending ? <p className={styles.hint}>{t("common.loading", "Loading...")}</p> : null}
            {accountsQuery.error ? <p className={styles.error}>{formatAuthError(accountsQuery.error)}</p> : null}
            {!accountsQuery.isPending && accounts.length === 0 ? (
              <p className={styles.hint}>{t("partnerTelegram.empty", "No partner has opened the bot yet.")}</p>
            ) : null}
            {accounts.length > 0 ? (
              <div className={styles.tableWrap}>
                <DataTable
                  tableKey="partnerTelegram.list"
                  data={accounts}
                  columns={accountColumns}
                  className={styles.table}
                  getRowId={(account) => String(account.id)}
                  renderBody={(table) =>
                    table.getRowModel().rows.map((row) => (
                      <AccountRow
                        key={row.id}
                        account={row.original}
                        columns={table.getVisibleLeafColumns()}
                        token={token ?? ""}
                        warehouses={referencesQuery.data?.warehouses ?? []}
                        priceTypes={referencesQuery.data?.price_types ?? []}
                        botEnabledPages={normalizeEnabledPages(bot?.enabled_pages)}
                      />
                    ))
                  }
                />
              </div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}

function AccountRow({
  account,
  columns,
  token,
  warehouses,
  priceTypes,
  botEnabledPages,
}: {
  account: PartnerTelegramAccount;
  columns: Column<PartnerTelegramAccount, unknown>[];
  token: string;
  warehouses: { id: number; name: string }[];
  priceTypes: { id: number; name: string }[];
  botEnabledPages: PartnerEnabledPages;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Partner[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pagesOpen, setPagesOpen] = useState(false);
  const [draftOverrides, setDraftOverrides] = useState<Partial<Record<PartnerPortalPageKey, boolean>>>(
    () => normalizePageOverrides(account.page_overrides),
  );

  useEffect(() => {
    setDraftOverrides(normalizePageOverrides(account.page_overrides));
  }, [account.page_overrides]);

  useEffect(() => {
    const query = search.trim();
    if (query.length < 2 || !token) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void fetchPartners(token, { search: query, limit: 8 })
        .then((response) => setResults(response.partners))
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, token]);

  const saveOption = async (field: "warehouse_id" | "price_type_id", value: number | null) => {
    setBusy(true);
    setError("");
    try {
      await updatePartnerTelegramAccount(token, account.id, { [field]: value });
      await queryClient.invalidateQueries({ queryKey: ["partner-telegram", "accounts", token] });
    } catch (saveError) {
      setError(formatAuthError(saveError));
    } finally {
      setBusy(false);
    }
  };

  const assign = async (partnerId: number | null) => {
    setBusy(true);
    setError("");
    try {
      await assignPartnerTelegramAccount(token, account.id, partnerId);
      setSearch("");
      setResults([]);
      await queryClient.invalidateQueries({ queryKey: ["partner-telegram", "accounts", token] });
    } catch (assignError) {
      setError(formatAuthError(assignError));
    } finally {
      setBusy(false);
    }
  };

  const overrideChoice = (key: PartnerPortalPageKey): PageOverrideChoice => {
    if (!(key in draftOverrides)) return "default";
    return draftOverrides[key] ? "on" : "off";
  };

  const setOverrideChoice = (key: PartnerPortalPageKey, choice: PageOverrideChoice) => {
    setDraftOverrides((current) => {
      const next = { ...current };
      if (choice === "default") {
        delete next[key];
      } else {
        next[key] = choice === "on";
      }
      return next;
    });
  };

  const savePages = async () => {
    setBusy(true);
    setError("");
    try {
      await updatePartnerTelegramAccount(token, account.id, { page_overrides: draftOverrides });
      setPagesOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["partner-telegram", "accounts", token] });
    } catch (saveError) {
      setError(formatAuthError(saveError));
    } finally {
      setBusy(false);
    }
  };

  const stateKey = `partnerTelegram.state.${account.link_state}`;
  const stateLabel = t(stateKey, account.link_state);

  return (
    <tr>
      {columns.map((column) => (
        <td key={column.id} data-label={columnHeaderLabel(column)} style={{ width: column.getSize() }}>
          {column.id === "name" ? (
            <>
              <div>{accountName(account)}</div>
              {account.username ? <div className={styles.hint}>@{account.username}</div> : null}
              <div className={styles.hint}>{stateLabel}</div>
            </>
          ) : null}
          {column.id === "phone" ? account.phone || "—" : null}
          {column.id === "language" ? account.language_code || "—" : null}
          {column.id === "partner"
            ? account.partner_name || (account.regos_partner_id ? `#${account.regos_partner_id}` : "—")
            : null}
          {column.id === "warehouse" ? (
            <select
              className={styles.input}
              value={account.warehouse_id ?? ""}
              disabled={busy}
              onChange={(event) =>
                void saveOption("warehouse_id", event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">{t("partnerTelegram.useBotDefault", "Bot default")}</option>
              {warehouses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          ) : null}
          {column.id === "priceType" ? (
            <select
              className={styles.input}
              value={account.price_type_id ?? ""}
              disabled={busy}
              onChange={(event) =>
                void saveOption("price_type_id", event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">{t("partnerTelegram.useBotDefault", "Bot default")}</option>
              {priceTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          ) : null}
          {column.id === "actions" ? (
            <div className={styles.actions}>
              <input
                className={styles.input}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("partnerTelegram.searchPartner", "Search partners")}
              />
              {results.length > 0 ? (
                <div className={styles.results}>
                  {results.map((partner) => (
                    <button
                      key={partner.id}
                      type="button"
                      className={styles.result}
                      disabled={busy}
                      onClick={() => void assign(partner.id)}
                    >
                      {partner.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setDraftOverrides(normalizePageOverrides(account.page_overrides));
                  setPagesOpen((open) => !open);
                }}
              >
                {t("partnerTelegram.editPages", "Pages")}
              </Button>
              {pagesOpen ? (
                <div className={styles.pageEditor}>
                  {PARTNER_PORTAL_PAGE_KEYS.map((key) => (
                    <label key={key} className={styles.label}>
                      {t(PARTNER_PORTAL_PAGE_META[key].labelKey, PARTNER_PORTAL_PAGE_META[key].fallback)}
                      <select
                        className={styles.input}
                        value={overrideChoice(key)}
                        disabled={busy}
                        onChange={(event) =>
                          setOverrideChoice(key, event.target.value as PageOverrideChoice)
                        }
                      >
                        <option value="default">
                          {t("partnerTelegram.useBotDefault", "Bot default")} (
                          {botEnabledPages[key]
                            ? t("partnerTelegram.pageOn", "On")
                            : t("partnerTelegram.pageOff", "Off")}
                          )
                        </option>
                        <option value="on">{t("partnerTelegram.pageOn", "On")}</option>
                        <option value="off">{t("partnerTelegram.pageOff", "Off")}</option>
                      </select>
                    </label>
                  ))}
                  <div className={styles.pageEditorActions}>
                    <Button type="button" size="sm" disabled={busy} onClick={() => void savePages()}>
                      {t("common.save", "Save")}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setDraftOverrides(normalizePageOverrides(account.page_overrides));
                        setPagesOpen(false);
                      }}
                    >
                      {t("common.cancel", "Cancel")}
                    </Button>
                  </div>
                </div>
              ) : null}
              {account.link_state === "linked" ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void assign(null)}
                >
                  {t("partnerTelegram.clear", "Clear link")}
                </Button>
              ) : null}
              {error ? <div className={styles.error}>{error}</div> : null}
            </div>
          ) : null}
        </td>
      ))}
    </tr>
  );
}
