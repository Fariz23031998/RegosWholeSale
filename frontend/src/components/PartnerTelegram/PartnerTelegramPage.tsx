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
  deletePartnerTelegramAccount,
  deletePartnerTelegramBot,
  emptyPartnerBalanceNotifyAfterTypes,
  emptyPartnerNotificationTemplates,
  fetchPartnerTelegramAccounts,
  fetchPartnerTelegramBot,
  fetchPartnerTelegramImportFields,
  importPartnerTelegramAccountsFromField,
  normalizePartnerBalanceNotifyAfterTypes,
  normalizePartnerNotificationTemplates,
  PARTNER_NOTIFICATION_TEMPLATE_TYPES,
  savePartnerTelegramBot,
  savePartnerTelegramBotSettings,
  setPartnerTelegramAccountPartners,
  updatePartnerTelegramAccount,
  type PartnerBalanceNotifyAfterType,
  type PartnerBalanceNotifyAfterTypes,
  type PartnerBalanceNotifyFilter,
  type PartnerBalanceNotifySchedule,
  type PartnerNotificationTemplateType,
  type PartnerNotificationTemplates,
  type PartnerOrderDocumentType,
  type PartnerTelegramAccount,
  type PartnerTelegramImportFromFieldResponse,
} from "@/lib/partner-telegram-api";
import { fetchPartnerGroups, fetchPartners } from "@/lib/partners-api";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import { formatAuthError, useAuth } from "@/store/auth";
import type { Partner } from "@/types/partners";
import { PartnerNotificationTemplateVariablesModal } from "./PartnerNotificationTemplateVariablesModal";
import styles from "./PartnerTelegram.module.css";

type PageOverrideChoice = "default" | "on" | "off";
type PartnerTelegramTab = "bot" | "accounts";
type BalanceScheduleOption = "daily" | "weekdays" | "monthly";
type BotSettingsSection =
  | "connection"
  | "defaults"
  | "catalog"
  | "portalPages"
  | "balanceSchedule"
  | "notificationTemplates";

const BOT_SETTINGS_NAV: {
  id: BotSettingsSection;
  titleKey: string;
  titleFallback: string;
}[] = [
  { id: "connection", titleKey: "partnerTelegram.section.connection", titleFallback: "Connection" },
  { id: "defaults", titleKey: "partnerTelegram.section.defaults", titleFallback: "Defaults" },
  { id: "catalog", titleKey: "partnerTelegram.section.catalog", titleFallback: "Catalog" },
  {
    id: "portalPages",
    titleKey: "partnerTelegram.section.portalPages",
    titleFallback: "Portal pages",
  },
  {
    id: "balanceSchedule",
    titleKey: "partnerTelegram.section.balanceSchedule",
    titleFallback: "Balance schedule",
  },
  {
    id: "notificationTemplates",
    titleKey: "partnerTelegram.section.notificationTemplates",
    titleFallback: "Notification templates",
  },
];

const NOTIFICATION_TYPE_META: Record<
  PartnerNotificationTemplateType,
  { titleKey: string; titleFallback: string }
> = {
  purchase: {
    titleKey: "partnerTelegram.notifyType.purchase",
    titleFallback: "Purchase",
  },
  return_purchase: {
    titleKey: "partnerTelegram.notifyType.returnPurchase",
    titleFallback: "Purchase return",
  },
  wholesale: {
    titleKey: "partnerTelegram.notifyType.wholesale",
    titleFallback: "Shipment",
  },
  wholesale_return: {
    titleKey: "partnerTelegram.notifyType.wholesaleReturn",
    titleFallback: "Shipment return",
  },
  payment: {
    titleKey: "partnerTelegram.notifyType.payment",
    titleFallback: "Payment",
  },
  balance: {
    titleKey: "partnerTelegram.notifyType.balance",
    titleFallback: "Balance",
  },
};

type BalanceScheduleDraft = {
  key: string;
  id?: string;
  time: string;
  option: BalanceScheduleOption;
  weekdays: number[];
  monthDays: string;
};

const MAX_BALANCE_SCHEDULES = 10;

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

function newScheduleKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `schedule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createBalanceScheduleDraft(
  partial?: Partial<Omit<BalanceScheduleDraft, "key">> & { key?: string },
): BalanceScheduleDraft {
  return {
    key: partial?.key ?? newScheduleKey(),
    id: partial?.id,
    time: partial?.time ?? "09:00",
    option: partial?.option ?? "daily",
    weekdays: partial?.weekdays ?? [],
    monthDays: partial?.monthDays ?? "",
  };
}

function parseMonthDays(monthDays: string): number[] {
  const matches = monthDays.match(/-?\d+/g) ?? [];
  const days = matches
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item !== 0 && item >= -31 && item <= 31);
  return [...new Set(days)].sort((left, right) => left - right);
}

function balanceDaysToSave(schedule: BalanceScheduleDraft): number[] {
  if (schedule.option === "weekdays") return schedule.weekdays;
  if (schedule.option !== "monthly") return [];
  return parseMonthDays(schedule.monthDays);
}

function scheduleDraftFromApi(schedule: PartnerBalanceNotifySchedule): BalanceScheduleDraft {
  const option: BalanceScheduleOption =
    schedule.option === "weekdays" || schedule.option === "monthly" ? schedule.option : "daily";
  const days = Array.isArray(schedule.days) ? schedule.days : [];
  return createBalanceScheduleDraft({
    id: typeof schedule.id === "string" && schedule.id ? schedule.id : undefined,
    time: schedule.time || "09:00",
    option,
    weekdays: option === "weekdays" ? days : [],
    monthDays: option === "monthly" ? days.join(", ") : "",
  });
}

function schedulesToSave(schedules: BalanceScheduleDraft[]): PartnerBalanceNotifySchedule[] {
  return schedules.map((schedule) => ({
    ...(schedule.id ? { id: schedule.id } : {}),
    time: schedule.time || "09:00",
    option: schedule.option,
    days: balanceDaysToSave(schedule),
  }));
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
  const [balanceNotifyFilter, setBalanceNotifyFilter] =
    useState<PartnerBalanceNotifyFilter>("negative");
  const [balanceSchedules, setBalanceSchedules] = useState<BalanceScheduleDraft[]>(() => [
    createBalanceScheduleDraft(),
  ]);
  const [notificationTemplates, setNotificationTemplates] = useState<PartnerNotificationTemplates>(
    () => emptyPartnerNotificationTemplates(),
  );
  const [balanceNotifyAfterTypes, setBalanceNotifyAfterTypes] =
    useState<PartnerBalanceNotifyAfterTypes>(() => emptyPartnerBalanceNotifyAfterTypes());
  const [activeTemplateType, setActiveTemplateType] =
    useState<PartnerNotificationTemplateType>("purchase");
  const [templateVarsOpen, setTemplateVarsOpen] = useState(false);
  const [orderDocumentType, setOrderDocumentType] =
    useState<PartnerOrderDocumentType>("doc_order_from_partner");
  const [orderBooked, setOrderBooked] = useState(true);
  const [activeTab, setActiveTab] = useState<PartnerTelegramTab>("bot");
  const [botSettingsSection, setBotSettingsSection] = useState<BotSettingsSection>("connection");
  const [importFieldId, setImportFieldId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSummary, setImportSummary] = useState<PartnerTelegramImportFromFieldResponse | null>(
    null,
  );
  const [accountSearchInput, setAccountSearchInput] = useState("");
  const [accountSearch, setAccountSearch] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAccountSearch(accountSearchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [accountSearchInput]);

  const botQuery = useQuery({
    queryKey: ["partner-telegram", "bot", token],
    queryFn: () => fetchPartnerTelegramBot(token ?? ""),
    enabled: Boolean(token),
  });
  const accountsQuery = useQuery({
    queryKey: ["partner-telegram", "accounts", token, accountSearch],
    queryFn: () => fetchPartnerTelegramAccounts(token ?? "", { search: accountSearch }),
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
    setBalanceNotifyFilter(bot.balance_notify_filter === "both" ? "both" : "negative");
    const loadedSchedules = (bot.balance_notify_schedules ?? []).map(scheduleDraftFromApi);
    setBalanceSchedules(loadedSchedules.length > 0 ? loadedSchedules : [createBalanceScheduleDraft()]);
    setNotificationTemplates(normalizePartnerNotificationTemplates(bot.notification_templates));
    setBalanceNotifyAfterTypes(
      normalizePartnerBalanceNotifyAfterTypes(bot.balance_notify_after_types),
    );
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
        balance_notify_filter: balanceNotifyFilter,
        balance_notify_schedules: schedulesToSave(balanceSchedules),
        notification_templates: notificationTemplates,
        balance_notify_after_types: balanceNotifyAfterTypes,
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
        size: 170,
      },
      {
        id: "phone",
        accessorFn: (account) => account.phone ?? "",
        header: t("partnerTelegram.phone", "Phone"),
        cell: ({ getValue }) => getValue<string>() || "—",
        size: 130,
      },
      {
        id: "language",
        accessorFn: (account) => account.language_code ?? "",
        header: t("partnerTelegram.language", "Language"),
        cell: ({ getValue }) => getValue<string>() || "—",
        size: 80,
      },
      {
        id: "status",
        accessorFn: (account) => (account.is_active ? "active" : "inactive"),
        header: t("common.status", "Status"),
        size: 100,
      },
      {
        id: "partner",
        accessorFn: (account) =>
          (account.partners ?? [])
            .map((partner) => partner.name)
            .join(", ") || account.partner_name || "",
        header: t("partnerTelegram.partner", "Partner"),
        size: 220,
      },
      {
        id: "warehouse",
        accessorFn: (account) => account.warehouse_id ?? 0,
        header: t("partnerTelegram.accountWarehouse", "Warehouse"),
        size: 150,
      },
      {
        id: "priceType",
        accessorFn: (account) => account.price_type_id ?? 0,
        header: t("partnerTelegram.accountPriceType", "Price type"),
        size: 150,
      },
      {
        id: "actions",
        header: t("common.actions", "Actions"),
        enableSorting: false,
        enableHiding: false,
        size: 220,
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
              <div className={styles.settingsLayout}>
                <nav
                  className={styles.settingsNav}
                  aria-label={t("partnerTelegram.settingsNav", "Partner bot settings")}
                >
                  {BOT_SETTINGS_NAV.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`${styles.settingsNavItem} ${
                        botSettingsSection === item.id ? styles.settingsNavItemActive : ""
                      }`}
                      aria-current={botSettingsSection === item.id ? "page" : undefined}
                      onClick={() => setBotSettingsSection(item.id)}
                    >
                      {t(item.titleKey, item.titleFallback)}
                    </button>
                  ))}
                </nav>
                <div className={styles.settingsContent}>
                  {botSettingsSection === "connection" ? (
                    <div className={styles.settings}>
                      <div className={styles.meta}>
                        <div>@{bot.bot_username}</div>
                        <div>
                          {t("partnerTelegram.miniAppUrl", "Mini App URL")}: {bot.mini_app_url}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {botSettingsSection === "defaults" ? (
                    <div className={styles.settings}>
                      <label className={styles.label}>
                        {t("partnerTelegram.defaultWarehouse", "Default warehouse")}
                        <select
                          className={styles.input}
                          value={warehouseId}
                          onChange={(event) => setWarehouseId(event.target.value)}
                        >
                          <option value="">
                            {t("partnerTelegram.useCompanyDefault", "Company default")}
                          </option>
                          {(referencesQuery.data?.warehouses ?? []).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.label}>
                        {t("partnerTelegram.defaultPriceType", "Default price type")}
                        <select
                          className={styles.input}
                          value={priceTypeId}
                          onChange={(event) => setPriceTypeId(event.target.value)}
                        >
                          <option value="">
                            {t("partnerTelegram.useCompanyDefault", "Company default")}
                          </option>
                          {(referencesQuery.data?.price_types ?? []).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.label}>
                        {t("partnerTelegram.defaultGroup", "Group for new partners")}
                        <select
                          className={styles.input}
                          value={groupId}
                          onChange={(event) => setGroupId(event.target.value)}
                        >
                          <option value="">{t("partnerTelegram.firstGroup", "First group")}</option>
                          {(groupsQuery.data?.groups ?? []).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
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
                        <input
                          type="checkbox"
                          checked={allowRegistration}
                          onChange={(event) => setAllowRegistration(event.target.checked)}
                        />
                        {t(
                          "partnerTelegram.allowSelfRegistration",
                          "Create a partner card when the phone number is new",
                        )}
                      </label>
                    </div>
                  ) : null}

                  {botSettingsSection === "catalog" ? (
                    <div className={styles.settings}>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={allowWarehouse}
                          onChange={(event) => setAllowWarehouse(event.target.checked)}
                        />
                        {t(
                          "partnerTelegram.allowWarehouse",
                          "Let partners choose a warehouse in the catalog",
                        )}
                      </label>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={showQuantities}
                          onChange={(event) => setShowQuantities(event.target.checked)}
                        />
                        {t(
                          "partnerTelegram.showProductQuantities",
                          "Show product quantities in the catalog",
                        )}
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
                    </div>
                  ) : null}

                  {botSettingsSection === "portalPages" ? (
                    <div className={styles.settings}>
                      <div className={styles.label}>
                        {t("partnerTelegram.portalPages", "Portal pages")}
                      </div>
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
                                setEnabledPages((current) => ({
                                  ...current,
                                  [key]: event.target.checked,
                                }))
                              }
                            />
                            {t(
                              PARTNER_PORTAL_PAGE_META[key].labelKey,
                              PARTNER_PORTAL_PAGE_META[key].fallback,
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {botSettingsSection === "balanceSchedule" ? (
                    <div className={styles.settings}>
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
                          "At each scheduled time, linked partners who owe the company receive a balance message and an Excel file. Message text is configured under Notification templates.",
                        )}
                      </p>
                      <label className={styles.label}>
                        {t("partnerTelegram.balanceNotifyFilter", "Balances to send")}
                        <select
                          className={styles.input}
                          value={balanceNotifyFilter}
                          onChange={(event) =>
                            setBalanceNotifyFilter(
                              event.target.value === "both" ? "both" : "negative",
                            )
                          }
                        >
                          <option value="negative">
                            {t(
                              "partnerTelegram.balanceNotifyFilter.negative",
                              "Debt only (negative balance)",
                            )}
                          </option>
                          <option value="both">
                            {t(
                              "partnerTelegram.balanceNotifyFilter.both",
                              "Debt and credit",
                            )}
                          </option>
                        </select>
                      </label>
                      <p className={styles.hint}>
                        {t(
                          "partnerTelegram.balanceNotifyFilterHint",
                          "Also applies when “Also send balance notification” is enabled for a document or payment type.",
                        )}
                      </p>
                      <div className={styles.label}>
                        {t("partnerTelegram.balanceSchedules", "Schedules")}
                      </div>
                      <div className={styles.scheduleList}>
                        {balanceSchedules.map((schedule, index) => (
                          <div key={schedule.key} className={styles.scheduleCard}>
                            <div className={styles.scheduleCardHeader}>
                              <div className={styles.scheduleCardTitle}>
                                {t("partnerTelegram.balanceScheduleItem", "Schedule {{n}}").replace(
                                  "{{n}}",
                                  String(index + 1),
                                )}
                              </div>
                              {balanceSchedules.length > 1 ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  disabled={savingBot}
                                  onClick={() =>
                                    setBalanceSchedules((current) =>
                                      current.filter((item) => item.key !== schedule.key),
                                    )
                                  }
                                >
                                  {t("partnerTelegram.balanceRemoveSchedule", "Remove")}
                                </Button>
                              ) : null}
                            </div>
                            <label className={styles.label}>
                              {t("partnerTelegram.balanceTime", "Time")}
                              <input
                                className={styles.input}
                                type="time"
                                value={schedule.time}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setBalanceSchedules((current) =>
                                    current.map((item) =>
                                      item.key === schedule.key ? { ...item, time: value } : item,
                                    ),
                                  );
                                }}
                              />
                            </label>
                            <label className={styles.label}>
                              {t("partnerTelegram.balanceOption", "Schedule")}
                              <select
                                className={styles.input}
                                value={schedule.option}
                                onChange={(event) => {
                                  const next = event.target.value as BalanceScheduleOption;
                                  setBalanceSchedules((current) =>
                                    current.map((item) => {
                                      if (item.key !== schedule.key) return item;
                                      return {
                                        ...item,
                                        option: next,
                                        weekdays:
                                          next === "weekdays" && item.weekdays.length === 0
                                            ? [0]
                                            : item.weekdays,
                                        monthDays:
                                          next === "monthly" && !item.monthDays.trim()
                                            ? "1"
                                            : item.monthDays,
                                      };
                                    }),
                                  );
                                }}
                              >
                                <option value="daily">
                                  {t("partnerTelegram.balanceOption.daily", "Every day")}
                                </option>
                                <option value="weekdays">
                                  {t(
                                    "partnerTelegram.balanceOption.weekdays",
                                    "Selected weekdays",
                                  )}
                                </option>
                                <option value="monthly">
                                  {t(
                                    "partnerTelegram.balanceOption.monthly",
                                    "Selected days of the month",
                                  )}
                                </option>
                              </select>
                            </label>
                            {schedule.option === "weekdays" ? (
                              <div>
                                <div className={styles.label}>
                                  {t("partnerTelegram.balanceWeekdays", "Weekdays")}
                                </div>
                                <div className={styles.dayList}>
                                  {WEEKDAYS.map(([key, day, label]) => (
                                    <label key={key}>
                                      <input
                                        type="checkbox"
                                        checked={schedule.weekdays.includes(day)}
                                        onChange={() =>
                                          setBalanceSchedules((current) =>
                                            current.map((item) =>
                                              item.key === schedule.key
                                                ? {
                                                    ...item,
                                                    weekdays: toggleDay(item.weekdays, day),
                                                  }
                                                : item,
                                            ),
                                          )
                                        }
                                      />
                                      {t(`partnerTelegram.weekday.${key}`, label)}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {schedule.option === "monthly" ? (
                              <label className={styles.label}>
                                {t("partnerTelegram.balanceMonthDays", "Days of the month")}
                                <input
                                  className={styles.input}
                                  value={schedule.monthDays}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setBalanceSchedules((current) =>
                                      current.map((item) =>
                                        item.key === schedule.key
                                          ? { ...item, monthDays: value }
                                          : item,
                                      ),
                                    );
                                  }}
                                  placeholder="1, 15, -1"
                                />
                                <span className={styles.hint}>
                                  {t(
                                    "partnerTelegram.balanceMonthDaysHint",
                                    "Comma-separated days from 1 to 31. Use negative values to count from the end of the month (−1 = last day, −2 = second-to-last).",
                                  )}
                                </span>
                              </label>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      <div className={styles.scheduleActions}>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={savingBot || balanceSchedules.length >= MAX_BALANCE_SCHEDULES}
                          onClick={() =>
                            setBalanceSchedules((current) => [
                              ...current,
                              createBalanceScheduleDraft(),
                            ])
                          }
                        >
                          {t("partnerTelegram.balanceAddSchedule", "Add schedule")}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {botSettingsSection === "notificationTemplates" ? (
                    <div className={styles.settings}>
                      <div className={styles.templateHeaderRow}>
                        <label className={styles.label}>
                          {t("partnerTelegram.notifyType", "Notification type")}
                          <select
                            className={styles.input}
                            value={activeTemplateType}
                            onChange={(event) =>
                              setActiveTemplateType(
                                event.target.value as PartnerNotificationTemplateType,
                              )
                            }
                          >
                            {PARTNER_NOTIFICATION_TEMPLATE_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {t(
                                  NOTIFICATION_TYPE_META[type].titleKey,
                                  NOTIFICATION_TYPE_META[type].titleFallback,
                                )}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setTemplateVarsOpen(true)}
                        >
                          {t("partnerTelegram.templateVariables", "Available variables")}
                        </Button>
                      </div>
                      <p className={styles.hint}>
                        {t(
                          "partnerTelegram.notificationTemplatesHint",
                          "Leave a language blank to use the built-in message. Messages use Telegram HTML (<b>, <i>, <code>, …). Open Available variables for the full placeholder list for this notification type.",
                        )}
                      </p>
                      <PartnerNotificationTemplateVariablesModal
                        open={templateVarsOpen}
                        onClose={() => setTemplateVarsOpen(false)}
                        templateType={activeTemplateType}
                      />
                      {activeTemplateType !== "balance" ? (
                        <label className={styles.check}>
                          <input
                            type="checkbox"
                            checked={
                              balanceNotifyAfterTypes[
                                activeTemplateType as PartnerBalanceNotifyAfterType
                              ]
                            }
                            onChange={(event) => {
                              const enabled = event.target.checked;
                              const key = activeTemplateType as PartnerBalanceNotifyAfterType;
                              setBalanceNotifyAfterTypes((current) => ({
                                ...current,
                                [key]: enabled,
                              }));
                            }}
                          />
                          {t(
                            "partnerTelegram.notifyAfterBalance",
                            "Also send balance notification",
                          )}
                        </label>
                      ) : null}
                      {(["uz", "ru", "en"] as const).map((lang) => (
                        <label key={lang} className={styles.label}>
                          {t(
                            `partnerTelegram.balanceTemplate.${lang}`,
                            lang === "uz" ? "Uzbek" : lang === "ru" ? "Russian" : "English",
                          )}
                          <textarea
                            className={styles.textarea}
                            value={notificationTemplates[activeTemplateType][lang]}
                            onChange={(event) => {
                              const value = event.target.value;
                              setNotificationTemplates((current) => ({
                                ...current,
                                [activeTemplateType]: {
                                  ...current[activeTemplateType],
                                  [lang]: value,
                                },
                              }));
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}

                  <div className={styles.settingsFooter}>
                    <Button type="button" onClick={() => void saveSettings()} disabled={savingBot}>
                      {t("partnerTelegram.saveSettings", "Save defaults")}
                    </Button>
                  </div>
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
                        exact: false,
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
            <div className={styles.accountToolbar}>
              <input
                className={styles.input}
                value={accountSearchInput}
                onChange={(event) => setAccountSearchInput(event.target.value)}
                placeholder={t(
                  "partnerTelegram.searchAccounts",
                  "Search by name, phone, username, or partner",
                )}
              />
            </div>
            {accountsQuery.isPending ? <p className={styles.hint}>{t("common.loading", "Loading...")}</p> : null}
            {accountsQuery.error ? <p className={styles.error}>{formatAuthError(accountsQuery.error)}</p> : null}
            {!accountsQuery.isPending && accounts.length === 0 ? (
              <p className={styles.hint}>
                {accountSearch
                  ? t("partnerTelegram.searchEmpty", "No accounts match this search.")
                  : t("partnerTelegram.empty", "No partner has opened the bot yet.")}
              </p>
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
                        accountSearch={accountSearch}
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
  accountSearch,
  warehouses,
  priceTypes,
  botEnabledPages,
}: {
  account: PartnerTelegramAccount;
  columns: Column<PartnerTelegramAccount, unknown>[];
  token: string;
  accountSearch: string;
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
  const linkedPartners = account.partners ?? [];
  const linkedIds = linkedPartners.map((partner) => partner.id);

  const refreshAccounts = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["partner-telegram", "accounts", token],
      exact: false,
    });
  };

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
        .then((response) =>
          setResults(response.partners.filter((partner) => !linkedIds.includes(partner.id))),
        )
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, token, linkedIds.join(",")]);

  const saveOption = async (field: "warehouse_id" | "price_type_id", value: number | null) => {
    setBusy(true);
    setError("");
    try {
      await updatePartnerTelegramAccount(token, account.id, { [field]: value });
      await refreshAccounts();
    } catch (saveError) {
      setError(formatAuthError(saveError));
    } finally {
      setBusy(false);
    }
  };

  const savePartners = async (partnerIds: number[], activePartnerId?: number | null) => {
    setBusy(true);
    setError("");
    try {
      await setPartnerTelegramAccountPartners(token, account.id, partnerIds, activePartnerId);
      setSearch("");
      setResults([]);
      await refreshAccounts();
    } catch (assignError) {
      setError(formatAuthError(assignError));
    } finally {
      setBusy(false);
    }
  };

  const addPartner = async (partnerId: number) => {
    if (linkedIds.includes(partnerId)) return;
    await savePartners([...linkedIds, partnerId], account.regos_partner_id ?? partnerId);
  };

  const removePartner = async (partnerId: number) => {
    const nextIds = linkedIds.filter((id) => id !== partnerId);
    const nextActive =
      account.regos_partner_id === partnerId
        ? nextIds[0] ?? null
        : account.regos_partner_id;
    await savePartners(nextIds, nextActive);
  };

  const setActivePartner = async (partnerId: number) => {
    await savePartners(linkedIds, partnerId);
  };

  const setActive = async (isActive: boolean) => {
    setBusy(true);
    setError("");
    try {
      await updatePartnerTelegramAccount(token, account.id, { is_active: isActive });
      await refreshAccounts();
    } catch (saveError) {
      setError(formatAuthError(saveError));
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async () => {
    const confirmed = window.confirm(
      t(
        "partnerTelegram.deleteAccountConfirm",
        "Delete this Telegram account? This cannot be undone.",
      ),
    );
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      await deletePartnerTelegramAccount(token, account.id);
      await refreshAccounts();
    } catch (deleteError) {
      setError(formatAuthError(deleteError));
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
      await refreshAccounts();
    } catch (saveError) {
      setError(formatAuthError(saveError));
    } finally {
      setBusy(false);
    }
  };

  const stateKey = `partnerTelegram.state.${account.link_state}`;
  const stateLabel = t(stateKey, account.link_state);

  const cellClassName = (columnId: string) => {
    if (columnId === "name") return styles.nameCell;
    if (columnId === "partner" || columnId === "warehouse" || columnId === "priceType") {
      return styles.stackCell;
    }
    if (columnId === "actions") return styles.actionsCell;
    return undefined;
  };

  return (
    <tr>
      {columns.map((column) => (
        <td
          key={column.id}
          className={cellClassName(column.id)}
          data-label={columnHeaderLabel(column)}
          style={{ width: column.getSize() }}
        >
          {column.id === "name" ? (
            <>
              <div>{accountName(account)}</div>
              {account.username ? <div className={styles.hint}>@{account.username}</div> : null}
              <div className={styles.hint}>{stateLabel}</div>
            </>
          ) : null}
          {column.id === "phone" ? account.phone || "—" : null}
          {column.id === "language" ? account.language_code || "—" : null}
          {column.id === "status" ? (
            <span className={`${styles.badge} ${account.is_active ? styles.active : styles.inactive}`}>
              {account.is_active
                ? t("common.active", "Active")
                : t("common.inactive", "Inactive")}
            </span>
          ) : null}
          {column.id === "partner" ? (
            <div className={styles.partnerLinks}>
              {linkedPartners.length === 0 ? <span className={styles.hint}>—</span> : null}
              {linkedPartners.map((partner) => (
                <div
                  key={partner.id}
                  className={`${styles.partnerChip} ${
                    partner.id === account.regos_partner_id ? styles.partnerChipActive : ""
                  }`}
                >
                  <button
                    type="button"
                    className={styles.partnerChipLabel}
                    disabled={busy || partner.id === account.regos_partner_id}
                    onClick={() => void setActivePartner(partner.id)}
                    title={t("partnerTelegram.setActivePartner", "Set as active partner")}
                  >
                    {partner.name || `#${partner.id}`}
                    {partner.id === account.regos_partner_id
                      ? ` (${t("partnerTelegram.activePartner", "active")})`
                      : ""}
                  </button>
                  <button
                    type="button"
                    className={styles.partnerChipRemove}
                    disabled={busy}
                    onClick={() => void removePartner(partner.id)}
                    aria-label={t("partnerTelegram.removePartner", "Remove partner")}
                  >
                    ×
                  </button>
                </div>
              ))}
              <input
                className={`${styles.input} ${styles.cellControl}`}
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
                      onClick={() => void addPartner(partner.id)}
                    >
                      {partner.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {column.id === "warehouse" ? (
            <select
              className={`${styles.input} ${styles.cellControl}`}
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
              className={`${styles.input} ${styles.cellControl}`}
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
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void setActive(!account.is_active)}
              >
                {account.is_active
                  ? t("partnerTelegram.deactivate", "Deactivate")
                  : t("partnerTelegram.activate", "Activate")}
              </Button>
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
              {linkedPartners.length > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void savePartners([])}
                >
                  {t("partnerTelegram.clear", "Clear link")}
                </Button>
              ) : null}
              <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void removeAccount()}>
                {t("common.delete", "Delete")}
              </Button>
              {error ? <div className={styles.error}>{error}</div> : null}
            </div>
          ) : null}
        </td>
      ))}
    </tr>
  );
}
