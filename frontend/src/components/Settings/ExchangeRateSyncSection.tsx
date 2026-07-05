import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { collectDashboardCurrencies } from "@/lib/dashboard-api";
import {
  fetchExchangeRateSync,
  patchExchangeRateSync,
  previewExchangeRateFormula,
  runExchangeRateSync,
} from "@/lib/settings-api";
import { formatAuthError } from "@/store/auth";
import type {
  ExchangeRateSyncRule,
  ExchangeRateSyncSettings,
  RegosCurrencyOption,
  RegosPriceTypeOption,
} from "@/types/settings";
import styles from "@/routes/settings.module.css";

type ExchangeRateSyncSectionProps = {
  token: string;
  tokenConfigured: boolean;
  priceTypes: RegosPriceTypeOption[];
  defaultCurrency: RegosCurrencyOption | null;
  disabled?: boolean;
};

const EMPTY_RULE: ExchangeRateSyncRule = {
  currency_id: 0,
  currency_code: "",
  formula: "exchange_rate",
  enabled: true,
};

type RoundingFunction = "round" | "ceil" | "floor";

function wrapFormulaWithRounding(formula: string, roundingFn: RoundingFunction): string {
  const expression = formula.trim() || "exchange_rate";
  return `${roundingFn}(${expression})`;
}

function formatRate(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function ExchangeRateSyncSection({
  token,
  tokenConfigured,
  priceTypes,
  defaultCurrency,
  disabled = false,
}: ExchangeRateSyncSectionProps) {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<ExchangeRateSyncSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [previewingIndex, setPreviewingIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [previewInfo, setPreviewInfo] = useState("");

  const currencyOptions = useMemo(
    () => collectDashboardCurrencies(priceTypes, defaultCurrency),
    [priceTypes, defaultCurrency],
  );

  const foreignCurrencies = useMemo(
    () =>
      currencyOptions.filter((currency) => {
        const code = (currency.code_chr || "").trim().toUpperCase();
        return code && code !== "UZS" && code !== "SUM" && code !== "СУМ";
      }),
    [currencyOptions],
  );

  useEffect(() => {
    if (!token || !tokenConfigured) {
      setSettings(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    void fetchExchangeRateSync(token)
      .then((response) => {
        if (!cancelled) {
          setSettings(response.settings);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(formatAuthError(reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, tokenConfigured]);

  const updateSettings = (patch: Partial<ExchangeRateSyncSettings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current));
  };

  const updateRule = (index: number, patch: Partial<ExchangeRateSyncRule>) => {
    setSettings((current) => {
      if (!current) return current;
      const rules = current.rules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      );
      return { ...current, rules };
    });
  };

  const handleAddRule = () => {
    const firstCurrency = foreignCurrencies[0];
    updateSettings({
      rules: [
        ...(settings?.rules ?? []),
        firstCurrency
          ? {
              currency_id: firstCurrency.id,
              currency_code: (firstCurrency.code_chr || "").trim().toUpperCase(),
              formula: "exchange_rate",
              enabled: true,
            }
          : { ...EMPTY_RULE },
      ],
    });
  };

  const handleRemoveRule = (index: number) => {
    updateSettings({
      rules: (settings?.rules ?? []).filter((_, ruleIndex) => ruleIndex !== index),
    });
  };

  const handleCurrencyChange = (index: number, currencyId: number) => {
    const currency = foreignCurrencies.find((item) => item.id === currencyId);
    if (!currency) return;
    updateRule(index, {
      currency_id: currency.id,
      currency_code: (currency.code_chr || "").trim().toUpperCase(),
    });
  };

  const handleSave = async () => {
    if (!token || !settings) return;

    setSaving(true);
    setError("");
    setInfo("");
    try {
      const response = await patchExchangeRateSync(token, {
        enabled: settings.enabled,
        rules: settings.rules,
      });
      setSettings(response.settings);
      setInfo(t("settings.exchangeRateSync.saved", "Exchange rate sync settings saved."));
    } catch (reason) {
      setError(formatAuthError(reason));
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    if (!token) return;
    setRunning(true);
    setError("");
    setInfo("");
    try {
      const response = await runExchangeRateSync(token);
      const refreshed = await fetchExchangeRateSync(token);
      setSettings(refreshed.settings);
      setInfo(
        t(
          "settings.exchangeRateSync.runCompleted",
          "Sync completed with status: {{status}}.",
          { status: response.status },
        ),
      );
    } catch (reason) {
      setError(formatAuthError(reason));
    } finally {
      setRunning(false);
    }
  };

  const handlePreview = async (index: number) => {
    if (!token || !settings) return;
    const rule = settings.rules[index];
    if (!rule?.formula.trim()) return;
    setPreviewingIndex(index);
    setPreviewInfo("");
    setError("");
    try {
      const response = await previewExchangeRateFormula(token, {
        formula: rule.formula,
        currency_code: rule.currency_code || undefined,
      });
      setPreviewInfo(
        t(
          "settings.exchangeRateSync.previewResult",
          "Official: {{official}} → Calculated: {{calculated}}",
          {
            official: formatRate(response.official_rate),
            calculated: formatRate(response.calculated_rate),
          },
        ),
      );
    } catch (reason) {
      setError(formatAuthError(reason));
    } finally {
      setPreviewingIndex(null);
    }
  };

  const handleApplyRounding = (index: number, roundingFn: RoundingFunction) => {
    const rule = settings?.rules[index];
    if (!rule) return;
    updateRule(index, { formula: wrapFormulaWithRounding(rule.formula, roundingFn) });
  };

  const sectionDisabled = disabled || !tokenConfigured || loading || saving || running;

  return (
    <div className={styles.subsection}>
      <div className={styles.rowTitle}>
        {t("settings.exchangeRateSync.title", "Exchange rate sync")}
      </div>
      <p className={styles.rowDesc}>
        {t(
          "settings.exchangeRateSync.desc",
          "Official Central Bank of Uzbekistan rates are fetched once daily (Asia/Tashkent). Apply your formula and update REGOS using the cached rates.",
        )}
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
      {info ? <p className={styles.success}>{info}</p> : null}
      {previewInfo ? <p className={styles.note}>{previewInfo}</p> : null}

      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={settings?.enabled ?? false}
          disabled={sectionDisabled}
          onChange={(event) => updateSettings({ enabled: event.target.checked })}
        />
        <span>{t("settings.exchangeRateSync.enabled", "Enable automatic daily sync")}</span>
      </label>

      <p className={styles.note}>
        {t(
          "settings.exchangeRateSync.scheduleNote",
          "Rates refresh automatically once daily (Asia/Tashkent). Preview and Sync now always use the latest cached rates.",
        )}
      </p>

      <div className={styles.rowTitle}>
        {t("settings.exchangeRateSync.rulesTitle", "Currency rules")}
      </div>
      <p className={styles.note}>
        {t(
          "settings.exchangeRateSync.formulaHelp",
          "Use exchange_rate in formulas, for example: exchange_rate - 100, exchange_rate * 1.05, round(exchange_rate * 1.05), floor(exchange_rate), ceil(exchange_rate / 100) * 100.",
        )}
      </p>

      {(settings?.rules ?? []).map((rule, index) => (
        <div key={`${rule.currency_id}-${index}`} className={styles.ruleCard}>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.label}>
                {t("settings.exchangeRateSync.currency", "Currency")}
              </span>
              <select
                className={styles.input}
                value={rule.currency_id || ""}
                disabled={sectionDisabled || foreignCurrencies.length === 0}
                onChange={(event) => handleCurrencyChange(index, Number(event.target.value))}
              >
                <option value="">
                  {t("settings.exchangeRateSync.selectCurrency", "Select currency")}
                </option>
                {foreignCurrencies.map((currency) => (
                  <option key={currency.id} value={currency.id}>
                    {(currency.code_chr || currency.name).toUpperCase()} — {currency.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>
                {t("settings.exchangeRateSync.formula", "Formula")}
              </span>
              <input
                className={styles.input}
                type="text"
                value={rule.formula}
                disabled={sectionDisabled}
                onChange={(event) => updateRule(index, { formula: event.target.value })}
              />
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  disabled={sectionDisabled}
                  onClick={() => handleApplyRounding(index, "round")}
                >
                  {t("settings.exchangeRateSync.roundFormula", "Round")}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  disabled={sectionDisabled}
                  onClick={() => handleApplyRounding(index, "ceil")}
                >
                  {t("settings.exchangeRateSync.roundUpFormula", "Round up")}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  disabled={sectionDisabled}
                  onClick={() => handleApplyRounding(index, "floor")}
                >
                  {t("settings.exchangeRateSync.roundDownFormula", "Round down")}
                </button>
              </div>
            </label>
          </div>
          <div className={styles.buttonRow}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={rule.enabled}
                disabled={sectionDisabled}
                onChange={(event) => updateRule(index, { enabled: event.target.checked })}
              />
              <span>{t("settings.exchangeRateSync.ruleEnabled", "Enabled")}</span>
            </label>
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={sectionDisabled || previewingIndex === index}
              onClick={() => void handlePreview(index)}
            >
              {previewingIndex === index
                ? t("settings.exchangeRateSync.previewing", "Previewing…")
                : t("settings.exchangeRateSync.preview", "Preview")}
            </button>
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={sectionDisabled}
              onClick={() => handleRemoveRule(index)}
            >
              {t("settings.exchangeRateSync.removeRule", "Remove")}
            </button>
          </div>
        </div>
      ))}

      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.btnSecondary}
          disabled={sectionDisabled || foreignCurrencies.length === 0}
          onClick={handleAddRule}
        >
          {t("settings.exchangeRateSync.addRule", "Add currency rule")}
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={sectionDisabled || !settings}
          onClick={() => void handleSave()}
        >
          {saving
            ? t("common.saving", "Saving…")
            : t("settings.exchangeRateSync.save", "Save sync settings")}
        </button>
        <button
          type="button"
          className={styles.btnSecondary}
          disabled={sectionDisabled}
          onClick={() => void handleRunNow()}
        >
          {running
            ? t("settings.exchangeRateSync.running", "Syncing…")
            : t("settings.exchangeRateSync.runNow", "Sync now")}
        </button>
      </div>

      {settings?.last_run_at ? (
        <div className={styles.note}>
          <div>
            {t("settings.exchangeRateSync.lastRun", "Last run")}: {settings.last_run_at}
          </div>
          {settings.last_run_status ? (
            <div>
              {t("settings.exchangeRateSync.lastRunStatus", "Status")}: {settings.last_run_status}
            </div>
          ) : null}
          {settings.last_run_message ? <div>{settings.last_run_message}</div> : null}
          {(settings.last_run_results ?? []).map((result, index) => (
            <div key={index}>
              {String(result.currency_code ?? result.currency_id ?? "—")}:{" "}
              {String(result.status ?? "—")}
              {result.message ? ` — ${String(result.message)}` : ""}
            </div>
          ))}
        </div>
      ) : null}

      {loading ? (
        <p className={styles.note}>
          {t("settings.exchangeRateSync.loading", "Loading exchange rate sync settings…")}
        </p>
      ) : null}
      {!tokenConfigured ? (
        <p className={styles.note}>
          {t(
            "settings.exchangeRateSync.tokenRequired",
            "Save a REGOS integration token before configuring exchange rate sync.",
          )}
        </p>
      ) : null}
    </div>
  );
}
