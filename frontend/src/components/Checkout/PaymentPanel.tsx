import { Banknote, CreditCard, Plus, Trash2, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/posui/Button";
import { formatAuthError } from "@/store/auth";
import { useSellContext } from "@/store/sell-context";
import { formatCurrency } from "@/lib/format";
import {
  collectKnownCurrencies,
  currencyLabel,
  currencyWithExchangeRate,
  paymentAmountFromSaleAmount,
  sameCurrency,
} from "@/lib/currency-conversion";
import {
  formatAmountWithCurrency,
  isClosingWithoutPayment,
  paymentLineAmountInSaleCurrency,
  paymentPanelLabels,
  remainingBalanceInPaymentCurrency,
  resolveAmountPaid,
  type PaymentPanelMode,
} from "@/lib/checkout-payments";
import { fetchPaymentTypes } from "@/lib/payment-api";
import type { CheckoutPaymentLineRequest } from "@/lib/sales-api";
import type { PaymentType } from "@/types/payment";
import type { RegosCurrencyOption } from "@/types/settings";
import styles from "./Checkout.module.css";

export type PaymentSubmitPayload = {
  payment_type_id?: number;
  payments?: CheckoutPaymentLineRequest[];
  amount_paid: number;
  tendered?: number;
  change?: number;
};

type PaymentLineState = {
  key: string;
  paymentTypeId: number;
  amount: string;
};

type Props = {
  mode: PaymentPanelMode;
  total: number;
  saleCurrency: RegosCurrencyOption | null;
  accessToken: string | null;
  active: boolean;
  processing?: boolean;
  tenderedQuickAmounts?: number[];
  onConfirm: (payload: PaymentSubmitPayload) => void;
  onCloseWithoutPayment?: () => void;
};

export function PaymentPanel({
  mode,
  total,
  saleCurrency,
  accessToken,
  active,
  processing = false,
  tenderedQuickAmounts = [],
  onConfirm,
  onCloseWithoutPayment,
}: Props) {
  const { t } = useLanguage();
  const labels = paymentPanelLabels(mode, t);
  const totals = useMemo(() => ({ total }), [total]);
  const priceTypes = useSellContext((s) => s.options.price_types);

  const [paymentTypes, setPaymentTypes] = useState<PaymentType[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tendered, setTendered] = useState("");
  const [debtAmount, setDebtAmount] = useState("0");
  const [splitPayment, setSplitPayment] = useState(false);
  const [paymentLines, setPaymentLines] = useState<PaymentLineState[]>([]);
  const lineKeyRef = useRef(0);
  const prevPaymentCurrencyIdRef = useRef<number | null>(null);
  const nextLineKey = () => {
    lineKeyRef.current += 1;
    return String(lineKeyRef.current);
  };

  const selected = useMemo(
    () => paymentTypes.find((t) => t.id === selectedId) ?? null,
    [paymentTypes, selectedId],
  );

  const paymentCurrency = selected?.currency ?? null;
  const knownCurrencies = useMemo(
    () =>
      collectKnownCurrencies(
        [saleCurrency],
        priceTypes.map((priceType) => priceType.currency),
        paymentTypes.map((type) => type.currency),
      ),
    [saleCurrency, priceTypes, paymentTypes],
  );
  const resolvedPaymentCurrency = useMemo(
    () => currencyWithExchangeRate(paymentCurrency, knownCurrencies),
    [paymentCurrency, knownCurrencies],
  );
  const currenciesDiffer = Boolean(selected && !sameCurrency(saleCurrency, resolvedPaymentCurrency));
  const paymentCurrencyCode = currencyLabel(resolvedPaymentCurrency);

  const tenderedNum = parseFloat(tendered) || 0;
  const debtAmountNum = parseFloat(debtAmount) || 0;
  const amountPaid = selected
    ? resolveAmountPaid(
        selected,
        totals,
        tenderedNum,
        debtAmountNum,
        saleCurrency,
        resolvedPaymentCurrency,
      )
    : 0;
  const balanceDue = Math.max(0, total - amountPaid);
  const totalInPaymentCurrency = currenciesDiffer
    ? paymentAmountFromSaleAmount(total, saleCurrency, resolvedPaymentCurrency)
    : total;
  const amountPaidInPaymentCurrency = currenciesDiffer
    ? paymentAmountFromSaleAmount(amountPaid, saleCurrency, resolvedPaymentCurrency)
    : amountPaid;
  const changeInPaymentCurrency = currenciesDiffer
    ? Math.max(0, tenderedNum - totalInPaymentCurrency)
    : Math.max(0, tenderedNum - total);
  const changeInSaleCurrency = currenciesDiffer
    ? paymentLineAmountInSaleCurrency(changeInPaymentCurrency, resolvedPaymentCurrency, saleCurrency)
    : changeInPaymentCurrency;
  const closingWithoutPayment = isClosingWithoutPayment(amountPaid);
  const isPartialPayment = amountPaid > 0.009 && balanceDue > 0.009;

  const canPayNow = Boolean(
    (selected?.is_cash && tenderedNum > 0) ||
      (selected?.allows_debt && debtAmountNum > 0) ||
      (selected && !selected.is_cash && !selected.allows_debt),
  );
  const canCloseWithoutPayment = Boolean(
    selected && (closingWithoutPayment || selected.is_cash || selected.allows_debt),
  );
  const canCharge = Boolean(
    selected && (canPayNow || canCloseWithoutPayment) && !processing && !typesLoading,
  );
  const showCloseSecondary = Boolean(
    !splitPayment &&
      selected &&
      !selected.is_cash &&
      !selected.allows_debt &&
      !processing &&
      !typesLoading,
  );

  const splitPaidInSaleCurrency = useMemo(() => {
    if (!splitPayment) return 0;
    return paymentLines.reduce((sum, line) => {
      const type = paymentTypes.find((t) => t.id === line.paymentTypeId);
      if (!type) return sum;
      const amountNum = parseFloat(line.amount) || 0;
      const lineCurrency = currencyWithExchangeRate(type.currency, knownCurrencies);
      return sum + paymentLineAmountInSaleCurrency(amountNum, lineCurrency, saleCurrency);
    }, 0);
  }, [splitPayment, paymentLines, paymentTypes, saleCurrency, knownCurrencies]);

  const splitBalanceDue = Math.max(0, total - splitPaidInSaleCurrency);
  const splitClosingWithoutPayment = splitPayment && isClosingWithoutPayment(splitPaidInSaleCurrency);
  const splitIsPartialPayment =
    splitPayment && splitPaidInSaleCurrency > 0.009 && splitBalanceDue > 0.009;
  const splitCanCharge = Boolean(
    splitPayment &&
      !processing &&
      !typesLoading &&
      paymentLines.length > 0 &&
      (splitPaidInSaleCurrency > 0.009 || splitClosingWithoutPayment) &&
      splitPaidInSaleCurrency <= total + 0.02,
  );

  const displayAmountPaid = splitPayment ? splitPaidInSaleCurrency : amountPaid;
  const displayBalanceDue = splitPayment ? splitBalanceDue : balanceDue;
  const displayClosingWithoutPayment = splitPayment
    ? splitClosingWithoutPayment
    : closingWithoutPayment;
  const displayIsPartialPayment = splitPayment ? splitIsPartialPayment : isPartialPayment;
  const displayCanCharge = splitPayment ? splitCanCharge : canCharge;

  const addTenderedAmount = (amount: number) => {
    setTendered((tenderedNum + amount).toFixed(2));
  };

  useEffect(() => {
    if (!active || !accessToken) return;

    let cancelled = false;
    setTypesLoading(true);
    setTypesError(null);

    void fetchPaymentTypes(accessToken)
      .then((data) => {
        if (cancelled) return;
        const types = data.payment_types ?? [];
        setPaymentTypes(types);
        const defaultType = types.find((t) => t.is_cash) ?? types[0] ?? null;
        setSelectedId(defaultType?.id ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPaymentTypes([]);
        setSelectedId(null);
        setTypesError(formatAuthError(err, t("checkout.errors.loadPaymentTypes", "Failed to load payment types")));
      })
      .finally(() => {
        if (!cancelled) setTypesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active, accessToken]);

  useEffect(() => {
    if (!active) {
      setTendered("");
      setDebtAmount("0");
      setSplitPayment(false);
      setPaymentLines([]);
      prevPaymentCurrencyIdRef.current = null;
    }
  }, [active]);

  useEffect(() => {
    if (!selected) return;

    const currencyId = paymentCurrency?.id ?? null;
    if (
      prevPaymentCurrencyIdRef.current !== null &&
      prevPaymentCurrencyIdRef.current !== currencyId
    ) {
      setTendered("");
      setDebtAmount("0");
    }
    prevPaymentCurrencyIdRef.current = currencyId;
  }, [selectedId, paymentCurrency?.id, selected]);

  const enableSplitPayment = () => {
    const typeId = selectedId ?? paymentTypes[0]?.id ?? 0;
    const type = paymentTypes.find((t) => t.id === typeId);
    let initialAmount = "";
    if (type?.is_cash) {
      initialAmount = tendered;
    } else if (type?.allows_debt) {
      initialAmount = debtAmount;
    } else {
      initialAmount = remainingBalanceInPaymentCurrency(
        total,
        saleCurrency,
        currencyWithExchangeRate(type?.currency, knownCurrencies),
      ).toFixed(2);
    }
    setPaymentLines([{ key: nextLineKey(), paymentTypeId: typeId, amount: initialAmount }]);
    setSplitPayment(true);
  };

  const disableSplitPayment = () => {
    const firstLine = paymentLines[0];
    if (firstLine) {
      setSelectedId(firstLine.paymentTypeId);
      const type = paymentTypes.find((t) => t.id === firstLine.paymentTypeId);
      if (type?.is_cash) {
        setTendered(firstLine.amount);
      } else if (type?.allows_debt) {
        setDebtAmount(firstLine.amount);
      }
    }
    setSplitPayment(false);
    setPaymentLines([]);
  };

  const addPaymentLine = () => {
    const typeId = paymentTypes[0]?.id ?? 0;
    const type = paymentTypes.find((t) => t.id === typeId);
    const amount = remainingBalanceInPaymentCurrency(
      splitBalanceDue,
      saleCurrency,
      currencyWithExchangeRate(type?.currency, knownCurrencies),
    ).toFixed(2);
    setPaymentLines((lines) => [
      ...lines,
      { key: nextLineKey(), paymentTypeId: typeId, amount },
    ]);
  };

  const updatePaymentLine = (
    key: string,
    patch: Partial<Pick<PaymentLineState, "paymentTypeId" | "amount">>,
  ) => {
    setPaymentLines((lines) =>
      lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const removePaymentLine = (key: string) => {
    setPaymentLines((lines) => {
      if (lines.length <= 1) return lines;
      return lines.filter((line) => line.key !== key);
    });
  };

  const buildPayload = (paidOverride?: number): PaymentSubmitPayload | null => {
    if (splitPayment) {
      if (!splitCanCharge) return null;
      const payments: CheckoutPaymentLineRequest[] = paymentLines.map((line) => {
        const type = paymentTypes.find((t) => t.id === line.paymentTypeId);
        const amountNum = parseFloat(line.amount) || 0;
        return {
          payment_type_id: line.paymentTypeId,
          amount_paid: type
            ? paymentLineAmountInSaleCurrency(
                amountNum,
                currencyWithExchangeRate(type.currency, knownCurrencies),
                saleCurrency,
              )
            : 0,
        };
      });
      return {
        payments,
        amount_paid: splitPaidInSaleCurrency,
      };
    }

    if (!selected || !canCharge) return null;
    const paid =
      paidOverride ??
      resolveAmountPaid(
        selected,
        totals,
        tenderedNum,
        debtAmountNum,
        saleCurrency,
        resolvedPaymentCurrency,
      );
    return {
      payment_type_id: selected.id,
      amount_paid: paid,
      tendered: selected.is_cash ? tenderedNum : undefined,
      change: selected.is_cash && changeInSaleCurrency > 0 ? changeInSaleCurrency : undefined,
    };
  };

  const handleConfirm = () => {
    const payload = buildPayload();
    if (payload) onConfirm(payload);
  };

  const handleCloseWithoutPayment = () => {
    if (splitPayment || !selected || processing) return;
    const payload = buildPayload(0);
    if (payload) {
      if (onCloseWithoutPayment) onCloseWithoutPayment();
      else onConfirm(payload);
    }
  };

  const chargeLabel = displayClosingWithoutPayment
    ? labels.closeWithout
    : displayIsPartialPayment
      ? splitPayment
        ? `${labels.charge} ${formatAmountWithCurrency(displayAmountPaid, saleCurrency)} · Due ${formatAmountWithCurrency(displayBalanceDue, saleCurrency)}`
        : currenciesDiffer
          ? `${labels.charge} ${formatAmountWithCurrency(amountPaidInPaymentCurrency, resolvedPaymentCurrency)} · Due ${formatAmountWithCurrency(balanceDue, saleCurrency)}`
          : `${labels.charge} ${formatCurrency(amountPaid)} · Due ${formatCurrency(balanceDue)}`
      : splitPayment
        ? `${labels.charge} ${formatCurrency(Math.min(displayAmountPaid, total))}`
        : currenciesDiffer
          ? `${labels.charge} ${formatAmountWithCurrency(totalInPaymentCurrency, resolvedPaymentCurrency)}`
          : `${labels.charge} ${formatCurrency(total)}`;

  const processingLabel = displayClosingWithoutPayment
    ? labels.closingWithoutProcessing
    : labels.processing;

  return (
    <>
      {currenciesDiffer && selected && !splitPayment && (
        <div className={styles.balanceDue}>
          <span>{t("checkout.payInCurrency", "Pay in {{currency}}", { currency: paymentCurrencyCode })}</span>
          <span>{formatAmountWithCurrency(totalInPaymentCurrency, resolvedPaymentCurrency)}</span>
        </div>
      )}

      {displayClosingWithoutPayment && (selected || splitPayment) && (
        <div className={styles.noPaymentNotice}>
          <div className={styles.noPaymentTitle}>{labels.noPaymentNotice}</div>
          <div className={styles.debtDescription}>
            {labels.noPaymentDescription}{" "}
            <strong>{formatAmountWithCurrency(total, saleCurrency)}</strong>.
          </div>
        </div>
      )}

      {displayIsPartialPayment && (selected || splitPayment) && (
        <div className={styles.balanceDue}>
          <span>{t("checkout.balanceDue", "Balance due")}</span>
          <span>{formatAmountWithCurrency(displayBalanceDue, saleCurrency)}</span>
        </div>
      )}

      {typesLoading ? (
        <div className={styles.statusMessage}>{t("checkout.loadingTypes", "Loading payment types…")}</div>
      ) : typesError ? (
        <div className={styles.statusError}>
          <div>{typesError}</div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (!accessToken) return;
              setTypesLoading(true);
              setTypesError(null);
              void fetchPaymentTypes(accessToken)
                .then((data) => {
                  const types = data.payment_types ?? [];
                  setPaymentTypes(types);
                  const defaultType = types.find((t) => t.is_cash) ?? types[0] ?? null;
                  setSelectedId(defaultType?.id ?? null);
                })
                .catch((err: unknown) => {
                  setTypesError(formatAuthError(err, t("checkout.errors.loadPaymentTypes", "Failed to load payment types")));
                })
                .finally(() => setTypesLoading(false));
            }}
          >
            {t("common.retry", "Retry")}
          </Button>
        </div>
      ) : paymentTypes.length === 0 ? (
        <div className={styles.statusMessage}>
          {t("checkout.noPaymentTypes", "No payment types configured in Regos.")}
        </div>
      ) : (
        <>
          <div className={styles.paymentModeRow}>
            <button
              type="button"
              className={clsx(styles.paymentModeBtn, !splitPayment && styles.paymentModeBtnActive)}
              onClick={() => {
                if (splitPayment) disableSplitPayment();
              }}
              disabled={processing}
            >
              {t("checkout.singlePayment", "Single payment")}
            </button>
            <button
              type="button"
              className={clsx(styles.paymentModeBtn, splitPayment && styles.paymentModeBtnActive)}
              onClick={() => {
                if (!splitPayment) enableSplitPayment();
              }}
              disabled={processing}
            >
              {t("checkout.splitPayment", "Split payment")}
            </button>
          </div>

          {splitPayment ? (
            <div className={styles.splitPayments}>
              {paymentLines.map((line) => {
                const lineType =
                  paymentTypes.find((t) => t.id === line.paymentTypeId) ?? paymentTypes[0];
                const lineCurrency = currencyWithExchangeRate(
                  lineType?.currency ?? null,
                  knownCurrencies,
                );
                const lineCurrenciesDiffer = Boolean(
                  lineType && !sameCurrency(saleCurrency, lineCurrency),
                );
                const lineCurrencyCode = currencyLabel(lineCurrency);
                const lineAmountNum = parseFloat(line.amount) || 0;
                const linePaidInSale = lineType
                  ? paymentLineAmountInSaleCurrency(lineAmountNum, lineCurrency, saleCurrency)
                  : 0;

                return (
                  <div key={line.key} className={styles.splitPaymentLine}>
                    <div className={styles.splitPaymentLineHeader}>
                      <select
                        className={styles.splitPaymentSelect}
                        value={line.paymentTypeId}
                        onChange={(e) =>
                          updatePaymentLine(line.key, {
                            paymentTypeId: Number(e.target.value),
                            amount: "",
                          })
                        }
                        disabled={processing}
                      >
                        {paymentTypes.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.name}
                          </option>
                        ))}
                      </select>
                      {paymentLines.length > 1 && (
                        <button
                          type="button"
                          className={styles.splitPaymentRemove}
                          onClick={() => removePaymentLine(line.key)}
                          disabled={processing}
                          aria-label={t("checkout.removePayment", "Remove payment")}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                    <div className={styles.label}>
                      {t("checkout.amount", "Amount")}
                      {lineCurrenciesDiffer && lineCurrencyCode ? ` (${lineCurrencyCode})` : ""}
                    </div>
                    <input
                      className={styles.tendered}
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.amount}
                      placeholder="0.00"
                      onChange={(e) => updatePaymentLine(line.key, { amount: e.target.value })}
                      disabled={processing}
                    />
                    {lineCurrenciesDiffer && lineAmountNum > 0 && (
                      <div className={styles.splitPaymentConverted}>
                        {t("checkout.convertedAmount", "≈ {{amount}} in sale currency", {
                          amount: formatAmountWithCurrency(linePaidInSale, saleCurrency),
                        })}
                      </div>
                    )}
                    <div className={styles.quickAmounts}>
                      <button
                        type="button"
                        className={styles.quick}
                        onClick={() =>
                          updatePaymentLine(line.key, {
                            amount: remainingBalanceInPaymentCurrency(
                              splitBalanceDue + linePaidInSale,
                              saleCurrency,
                              lineCurrency,
                            ).toFixed(2),
                          })
                        }
                        disabled={processing}
                      >
                        {t("checkout.remaining", "Remaining")}
                      </button>
                      <button
                        type="button"
                        className={styles.quick}
                        onClick={() => updatePaymentLine(line.key, { amount: "0" })}
                        disabled={processing}
                      >
                        {t("checkout.clear", "Clear")}
                      </button>
                    </div>
                  </div>
                );
              })}
              <Button
                size="sm"
                variant="secondary"
                onClick={addPaymentLine}
                disabled={processing || splitBalanceDue <= 0.009}
              >
                <Plus size={16} />
                {t("checkout.addPayment", "Add payment")}
              </Button>
              <div className={styles.splitPaymentSummary}>
                <div className={styles.paidNow}>
                  <span>{labels.payingNow}</span>
                  <span>{formatAmountWithCurrency(displayAmountPaid, saleCurrency)}</span>
                </div>
                {splitBalanceDue > 0.009 && (
                  <div className={styles.balanceDue}>
                    <span>{t("checkout.remaining", "Remaining")}</span>
                    <span>{formatAmountWithCurrency(splitBalanceDue, saleCurrency)}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className={styles.tabs} role="tablist" aria-label={t("checkout.paymentTypeAria", "Payment type")}>
                {paymentTypes.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    role="tab"
                    className={clsx(styles.tab, selectedId === type.id && styles.tabActive)}
                    onClick={() => setSelectedId(type.id)}
                    disabled={processing}
                    aria-selected={selectedId === type.id}
                  >
                    {type.image_url ? (
                      <img src={type.image_url} alt="" className={styles.tabImage} />
                    ) : type.is_cash ? (
                      <Banknote size={22} />
                    ) : type.allows_debt ? (
                      <Wallet size={22} />
                    ) : (
                      <CreditCard size={22} />
                    )}
                    <span className={styles.tabLabel}>{type.name}</span>
                  </button>
                ))}
              </div>

              {selected?.is_cash ? (
                <>
                  <div className={styles.cashSection}>
                    <div className={styles.label}>
                      {t("checkout.tendered.amount", "Amount tendered")}
                      {currenciesDiffer && paymentCurrencyCode ? ` (${paymentCurrencyCode})` : ""}
                    </div>
                    <input
                      className={styles.tendered}
                      type="number"
                      step="0.01"
                      min="0"
                      value={tendered}
                      placeholder="0.00"
                      onChange={(e) => setTendered(e.target.value)}
                      autoFocus
                    />
                    <div className={styles.quickAmounts}>
                      <button
                        type="button"
                        className={styles.quick}
                        onClick={() =>
                          setTendered(
                            (currenciesDiffer ? totalInPaymentCurrency : total).toFixed(2),
                          )
                        }
                      >
                        {t("checkout.tendered.exact", "Exact")}
                      </button>
                      {tenderedQuickAmounts.map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          className={styles.quick}
                          onClick={() => addTenderedAmount(amt)}
                        >
                          {formatCurrency(amt)}
                        </button>
                      ))}
                    </div>
                    <div className={styles.hint}>
                      {currenciesDiffer
                        ? labels.cashHint.replace("payment currency", paymentCurrencyCode || "payment currency")
                        : labels.cashHintSame}
                    </div>
                  </div>
                  {changeInPaymentCurrency > 0 && (
                    <div className={styles.change}>
                      <span>
                        {t("checkout.tendered.change", "Change")}
                        {currenciesDiffer && paymentCurrencyCode ? ` (${paymentCurrencyCode})` : ""}
                      </span>
                      <span>{formatCurrency(changeInPaymentCurrency)}</span>
                    </div>
                  )}
                  {currenciesDiffer && changeInSaleCurrency > 0 && (
                    <div className={styles.change}>
                      <span>
                        {t("checkout.tendered.change", "Change")} ({currencyLabel(saleCurrency)})
                      </span>
                      <span>{formatAmountWithCurrency(changeInSaleCurrency, saleCurrency)}</span>
                    </div>
                  )}
                  {isPartialPayment && (
                    <div className={styles.paidNow}>
                      <span>{labels.payingNow}</span>
                      <span>
                        {currenciesDiffer
                          ? formatAmountWithCurrency(amountPaid, saleCurrency)
                          : formatCurrency(amountPaid)}
                      </span>
                    </div>
                  )}
                </>
              ) : selected?.allows_debt ? (
                <div className={styles.cashSection}>
                  <div className={styles.label}>
                    {labels.amountPayingNow}
                    {currenciesDiffer && paymentCurrencyCode ? ` (${paymentCurrencyCode})` : ""}
                  </div>
                  <input
                    className={styles.tendered}
                    type="number"
                    step="0.01"
                    min="0"
                    max={currenciesDiffer ? totalInPaymentCurrency : total}
                    value={debtAmount}
                    placeholder="0.00"
                    onChange={(e) => setDebtAmount(e.target.value)}
                    autoFocus
                  />
                  <div className={styles.quickAmounts}>
                    <button type="button" className={styles.quick} onClick={() => setDebtAmount("0")}>
                      {t("checkout.debt.noPayment", "No payment")}
                    </button>
                    <button
                      type="button"
                      className={styles.quick}
                      onClick={() =>
                        setDebtAmount(
                          (currenciesDiffer ? totalInPaymentCurrency : total).toFixed(2),
                        )
                      }
                    >
                      {t("checkout.debt.payFull", "Pay full")}
                    </button>
                    <button
                      type="button"
                      className={styles.quick}
                      onClick={() =>
                        setDebtAmount(
                          ((currenciesDiffer ? totalInPaymentCurrency : total) / 2).toFixed(2),
                        )
                      }
                    >
                      {t("checkout.debt.half", "Half")}
                    </button>
                  </div>
                  <div className={styles.hint}>
                    {currenciesDiffer
                      ? labels.cashHint.replace("payment currency", paymentCurrencyCode || "payment currency")
                      : labels.cashHintSame}
                  </div>
                </div>
              ) : selected ? (
                <div className={styles.cardPrompt}>
                  {processing ? (
                    <>
                      <div className={styles.spinner} />
                      <div style={{ fontWeight: 500 }}>
                        {t("checkout.processing", "Processing {{type}}…", { type: selected.name })}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                        {labels.postingToRegos}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className={styles.cardIcon}>
                        <CreditCard size={28} />
                      </div>
                      <div style={{ fontWeight: 500 }}>
                        {t("checkout.completePayment", "Complete {{type}} payment", {
                          type: selected.name,
                        })}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                        {labels.cardPrompt}
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </>
          )}
        </>
      )}

      <div className={styles.checkoutActions}>
        <Button full size="lg" onClick={handleConfirm} disabled={!displayCanCharge || processing}>
          {processing ? processingLabel : chargeLabel}
        </Button>
        {showCloseSecondary && (
          <>
            <p className={styles.closeWithoutPaymentHint}>
              {labels.noPaymentDescription}{" "}
            <strong>{formatAmountWithCurrency(total, saleCurrency)}</strong>.
            </p>
            <Button
              full
              size="lg"
              variant="secondary"
              onClick={handleCloseWithoutPayment}
              disabled={processing}
            >
              {processing ? labels.closingWithoutProcessing : labels.closeWithout}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
