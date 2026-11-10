import { useMemo, useState } from "react";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import { currencyLabel } from "@/lib/currency-conversion";
import { balanceTotalInCurrency, type CurrencyGroup } from "@/lib/partner-balance";
import type { RegosCurrencyOption } from "@/types/settings";
import { formatAmount } from "./partner-format";
import styles from "./PartnerPortal.module.css";

export function PartnerBalanceTotal({
  groups,
  className,
}: {
  groups: CurrencyGroup[];
  className?: string;
}) {
  const { t } = useLanguage();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const currencies = useMemo(() => {
    const seen = new Set<number>();
    const options: RegosCurrencyOption[] = [];
    for (const group of groups) {
      const currency = group.currency;
      if (!currency?.id || seen.has(currency.id)) continue;
      seen.add(currency.id);
      options.push(currency);
    }
    return options;
  }, [groups]);

  const defaultId = useMemo(() => {
    const base = currencies.find((currency) => currency.exchange_rate === 1);
    return base?.id ?? currencies[0]?.id ?? null;
  }, [currencies]);

  if (currencies.length === 0 || defaultId == null) return null;

  const activeId = currencies.some((currency) => currency.id === selectedId) ? selectedId : defaultId;
  const selected = currencies.find((currency) => currency.id === activeId) ?? currencies[0]!;
  const total = balanceTotalInCurrency(groups, selected);
  const code = currencyLabel(selected);
  const amountText = total === 0 ? "0" : `${formatAmount(Math.abs(total))}${code ? ` ${code}` : ""}`;
  const sideLabel =
    total > 0
      ? t("partners.balance.debt", "Debt")
      : total < 0
        ? t("partners.balance.firmDebt", "Firm debt")
        : "";

  return (
    <div className={clsx(styles.balanceTotal, className)}>
      <label className={styles.balanceTotalCurrency}>
        <span>{t("partners.balance.totalCurrency", "Total in")}</span>
        <select
          value={selected.id}
          onChange={(event) => {
            const value = Number(event.target.value);
            setSelectedId(Number.isFinite(value) ? value : null);
          }}
          aria-label={t("partners.balance.totalCurrency", "Total in")}
        >
          {currencies.map((currency) => (
            <option key={currency.id} value={currency.id}>
              {currencyLabel(currency) || currency.name}
            </option>
          ))}
        </select>
      </label>
      <div
        className={clsx(
          styles.balanceTotalAmount,
          total > 0 && styles.balanceTotalDebt,
          total < 0 && styles.balanceTotalFirm,
          total === 0 && styles.balanceTotalZero,
        )}
      >
        <span>{t("partners.balance.totalBalance", "Total")}</span>
        <strong>
          {sideLabel ? `${sideLabel} ${amountText}` : amountText}
        </strong>
      </div>
    </div>
  );
}
