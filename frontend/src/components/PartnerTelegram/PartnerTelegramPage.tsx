import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  assignPartnerTelegramAccount,
  deletePartnerTelegramBot,
  fetchPartnerTelegramAccounts,
  fetchPartnerTelegramBot,
  savePartnerTelegramBot,
  savePartnerTelegramBotSettings,
  updatePartnerTelegramAccount,
  type PartnerTelegramAccount,
} from "@/lib/partner-telegram-api";
import { fetchPartnerGroups, fetchPartners } from "@/lib/partners-api";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import { formatAuthError, useAuth } from "@/store/auth";
import type { Partner } from "@/types/partners";
import styles from "./PartnerTelegram.module.css";

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

  useEffect(() => {
    const bot = botQuery.data;
    if (!bot?.configured) return;
    setWarehouseId(bot.default_warehouse_id ? String(bot.default_warehouse_id) : "");
    setPriceTypeId(bot.default_price_type_id ? String(bot.default_price_type_id) : "");
    setGroupId(bot.default_partner_group_id ? String(bot.default_partner_group_id) : "");
    setAllowWarehouse(bot.allow_catalog_warehouse_selection);
    setAllowRegistration(bot.allow_self_registration);
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
        default_partner_group_id: groupId ? Number(groupId) : null,
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
              <label className={styles.check}>
                <input type="checkbox" checked={allowWarehouse} onChange={(event) => setAllowWarehouse(event.target.checked)} />
                {t("partnerTelegram.allowWarehouse", "Let partners choose a warehouse in the catalog")}
              </label>
              <label className={styles.check}>
                <input type="checkbox" checked={allowRegistration} onChange={(event) => setAllowRegistration(event.target.checked)} />
                {t("partnerTelegram.allowSelfRegistration", "Create a partner card when the phone number is new")}
              </label>
              <Button type="button" onClick={() => void saveSettings()} disabled={savingBot}>
                {t("partnerTelegram.saveSettings", "Save defaults")}
              </Button>
            </div>
          </div>
        ) : null}
        {botError ? <p className={styles.error}>{botError}</p> : null}
        {botInfo ? <p className={styles.meta}>{botInfo}</p> : null}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{t("partnerTelegram.accountsTitle", "Telegram accounts")}</h2>
        {accountsQuery.isPending ? <p className={styles.hint}>{t("common.loading", "Loading...")}</p> : null}
        {accountsQuery.error ? <p className={styles.error}>{formatAuthError(accountsQuery.error)}</p> : null}
        {!accountsQuery.isPending && accounts.length === 0 ? (
          <p className={styles.hint}>{t("partnerTelegram.empty", "No partner has opened the bot yet.")}</p>
        ) : null}
        {accounts.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("common.name", "Name")}</th>
                  <th>{t("partnerTelegram.phone", "Phone")}</th>
                  <th>{t("partnerTelegram.language", "Language")}</th>
                  <th>{t("partnerTelegram.partner", "Partner")}</th>
                  <th>{t("partnerTelegram.accountWarehouse", "Warehouse")}</th>
                  <th>{t("partnerTelegram.accountPriceType", "Price type")}</th>
                  <th>{t("common.actions", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    token={token ?? ""}
                    warehouses={referencesQuery.data?.warehouses ?? []}
                    priceTypes={referencesQuery.data?.price_types ?? []}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function AccountRow({
  account,
  token,
  warehouses,
  priceTypes,
}: {
  account: PartnerTelegramAccount;
  token: string;
  warehouses: { id: number; name: string }[];
  priceTypes: { id: number; name: string }[];
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Partner[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  const stateKey = `partnerTelegram.state.${account.link_state}`;
  const stateLabel = t(stateKey, account.link_state);

  return (
    <tr>
      <td>
        <div>{accountName(account)}</div>
        {account.username ? <div className={styles.hint}>@{account.username}</div> : null}
        <div className={styles.hint}>{stateLabel}</div>
      </td>
      <td>{account.phone || "—"}</td>
      <td>{account.language_code || "—"}</td>
      <td>
        {account.partner_name || (account.regos_partner_id ? `#${account.regos_partner_id}` : "—")}
      </td>
      <td>
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
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </td>
      <td>
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
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </td>
      <td>
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
          {account.link_state === "linked" ? (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void assign(null)}>
              {t("partnerTelegram.clear", "Clear link")}
            </Button>
          ) : null}
          {error ? <div className={styles.error}>{error}</div> : null}
        </div>
      </td>
    </tr>
  );
}
