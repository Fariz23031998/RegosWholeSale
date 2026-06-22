import { Banknote, CreditCard, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { useCart } from "@/store/cart";
import { formatAuthError, useAuth } from "@/store/auth";
import { useCatalog } from "@/store/catalog";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";
import { formatCurrency } from "@/lib/format";
import { fetchPaymentTypes } from "@/lib/payment-api";
import { checkoutSale } from "@/lib/sales-api";
import type { PaymentType } from "@/types/payment";
import type { Sale } from "@/data/seed";
import { ReceiptModal } from "@/components/Receipt/ReceiptModal";
import styles from "./Checkout.module.css";

type Totals = { subtotal: number; discount: number; total: number };

type Props = {
  open: boolean;
  onClose: () => void;
  totals: Totals;
};

function resolveAmountPaid(
  paymentType: PaymentType,
  totals: Totals,
  tenderedNum: number,
  debtAmount: number,
): number {
  if (paymentType.is_cash) {
    return Math.min(Math.max(tenderedNum, 0), totals.total);
  }
  if (paymentType.allows_debt) {
    return Math.min(Math.max(debtAmount, 0), totals.total);
  }
  return totals.total;
}

function isClosingWithoutPayment(amountPaid: number): boolean {
  return amountPaid <= 0.009;
}

export function CheckoutModal({ open, onClose, totals }: Props) {
  const items = useCart((s) => s.items);
  const clearCart = useCart((s) => s.clear);
  const cashier = useAuth((s) => s.cashier);
  const accessToken = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const canOverrideRegos = Boolean(user?.permissions.includes("pos.override_regos"));
  const checkoutOverrides = useSellContext((s) => s.checkoutOverrides);
  const requestCatalogRefresh = useCatalog((s) => s.requestRefresh);
  const tenderedQuickAmounts = usePosConfig((s) => s.tenderedQuickAmounts);

  const [paymentTypes, setPaymentTypes] = useState<PaymentType[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tendered, setTendered] = useState<string>("");
  const [debtAmount, setDebtAmount] = useState<string>("0");
  const [processing, setProcessing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);

  const selected = useMemo(
    () => paymentTypes.find((t) => t.id === selectedId) ?? null,
    [paymentTypes, selectedId],
  );

  const tenderedNum = parseFloat(tendered) || 0;
  const debtAmountNum = parseFloat(debtAmount) || 0;
  const amountPaid = selected
    ? resolveAmountPaid(selected, totals, tenderedNum, debtAmountNum)
    : 0;
  const balanceDue = Math.max(0, totals.total - amountPaid);
  const change = Math.max(0, tenderedNum - totals.total);
  const closingWithoutPayment = isClosingWithoutPayment(amountPaid);
  const isPartialPayment =
    amountPaid > 0.009 && balanceDue > 0.009;

  const canPayNow = Boolean(
    (selected?.is_cash && tenderedNum > 0) ||
      (selected?.allows_debt && debtAmountNum > 0) ||
      (selected && !selected.is_cash && !selected.allows_debt),
  );
  const canCloseWithoutPayment = Boolean(
    selected &&
      (closingWithoutPayment || selected.is_cash || selected.allows_debt),
  );
  const canCharge = Boolean(
    selected &&
      (canPayNow || canCloseWithoutPayment) &&
      !processing &&
      !typesLoading,
  );
  const showCloseSecondary = Boolean(
    selected && !selected.is_cash && !selected.allows_debt && !processing && !typesLoading,
  );

  const addTenderedAmount = (amount: number) => {
    const next = tenderedNum + amount;
    setTendered(next.toFixed(2));
  };

  useEffect(() => {
    if (!open || !accessToken) return;

    let cancelled = false;
    setTypesLoading(true);
    setTypesError(null);
    setCheckoutError(null);

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
        setTypesError(formatAuthError(err, "Failed to load payment types"));
      })
      .finally(() => {
        if (!cancelled) setTypesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, accessToken]);

  const reset = () => {
    setTendered("");
    setDebtAmount("0");
    setProcessing(false);
    setTypesError(null);
    setCheckoutError(null);
  };

  const handleClose = () => {
    if (processing) return;
    reset();
    onClose();
  };

  const buildSaleFromResponse = (
    paymentType: PaymentType,
    wholesaleCode: string,
    performedAt: string,
    paid: number,
    due: number,
  ): Sale => ({
    id: wholesaleCode,
    createdAt: performedAt,
    cashierId: cashier?.id ?? "",
    cashierName: cashier?.name ?? "Cashier",
    items: items.map((i) => ({
      productId: i.productId,
      name: i.name,
      price: i.price,
      qty: i.qty,
    })),
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: 0,
    total: totals.total,
    paymentTypeId: paymentType.id,
    paymentTypeName: paymentType.name,
    isCash: paymentType.is_cash,
    tendered: paymentType.is_cash ? tenderedNum : undefined,
    change: paymentType.is_cash && change > 0 ? change : undefined,
    amountPaid: paid,
    balanceDue: due,
  });

  const submitCheckout = async (paymentType: PaymentType, paidOverride?: number) => {
    if (!accessToken || !cashier) return;

    const cartItems = items.filter((i) => i.regosItemId > 0);
    if (cartItems.length !== items.length) {
      setCheckoutError("Some cart items are missing Regos product ids.");
      return;
    }

    const paid =
      paidOverride ?? resolveAmountPaid(paymentType, totals, tenderedNum, debtAmountNum);

    setProcessing(true);
    setCheckoutError(null);

    try {
      const result = await checkoutSale(accessToken, {
        items: cartItems.map((i) => ({
          regos_item_id: i.regosItemId,
          qty: i.qty,
          price: i.price,
        })),
        discount: totals.discount,
        payment_type_id: paymentType.id,
        total: totals.total,
        amount_paid: paid,
        tendered: paymentType.is_cash ? tenderedNum : undefined,
        change: paymentType.is_cash && change > 0 ? change : undefined,
        description: `POS ${cashier.name}`,
        ...(canOverrideRegos ? checkoutOverrides() : {}),
      });

      const sale = buildSaleFromResponse(
        paymentType,
        result.wholesale_code,
        result.performed_at,
        result.amount_paid,
        result.balance_due,
      );
      clearCart();
      requestCatalogRefresh();
      setCompletedSale(sale);
      reset();
      onClose();
    } catch (err: unknown) {
      setCheckoutError(formatAuthError(err, "Checkout failed"));
    } finally {
      setProcessing(false);
    }
  };

  const handleCharge = () => {
    if (!selected || !canCharge) return;
    void submitCheckout(selected);
  };

  const handleCloseWithoutPayment = () => {
    if (!selected || processing) return;
    void submitCheckout(selected, 0);
  };

  const chargeLabel = closingWithoutPayment
    ? "Close without payment"
    : isPartialPayment
      ? `Charge ${formatCurrency(amountPaid)} · Due ${formatCurrency(balanceDue)}`
      : `Charge ${formatCurrency(totals.total)}`;

  const processingLabel = closingWithoutPayment
    ? "Closing without payment…"
    : "Processing…";

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title="Checkout"
        overlayClassName={styles.checkoutOverlay}
        modalClassName={styles.checkoutModal}
        bodyClassName={styles.checkoutBody}
      >
        <div className={styles.checkoutInner}>
          <div className={styles.checkoutScroll}>
        <div className={styles.totalLine}>
          <div className={styles.totalLabel}>Total due</div>
          <div className={styles.totalValue}>{formatCurrency(totals.total)}</div>
        </div>

        {closingWithoutPayment && selected && (
          <div className={styles.noPaymentNotice}>
            <div className={styles.noPaymentTitle}>Closing without payment</div>
            <div className={styles.debtDescription}>
              No payment will be recorded in Regos. Customer debt will be{" "}
              <strong>{formatCurrency(totals.total)}</strong>.
            </div>
          </div>
        )}

        {isPartialPayment && selected && (
          <div className={styles.balanceDue}>
            <span>Balance due</span>
            <span>{formatCurrency(balanceDue)}</span>
          </div>
        )}

        {checkoutError && <div className={styles.statusError}>{checkoutError}</div>}

        {typesLoading ? (
          <div className={styles.statusMessage}>Loading payment types…</div>
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
                    setTypesError(formatAuthError(err, "Failed to load payment types"));
                  })
                  .finally(() => setTypesLoading(false));
              }}
            >
              Retry
            </Button>
          </div>
        ) : paymentTypes.length === 0 ? (
          <div className={styles.statusMessage}>No payment types configured in Regos.</div>
        ) : (
          <>
            <div className={styles.tabs} role="tablist" aria-label="Payment type">
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
                  <div className={styles.label}>Amount tendered</div>
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
                      onClick={() => setTendered(totals.total.toFixed(2))}
                    >
                      Exact
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
                    Enter the amount received now, or leave at 0 to close without payment.
                  </div>
                </div>
                {change > 0 && (
                  <div className={styles.change}>
                    <span>Change</span>
                    <span>{formatCurrency(change)}</span>
                  </div>
                )}
                {isPartialPayment && (
                  <div className={styles.paidNow}>
                    <span>Paying now</span>
                    <span>{formatCurrency(amountPaid)}</span>
                  </div>
                )}
              </>
            ) : selected?.allows_debt ? (
              <div className={styles.cashSection}>
                <div className={styles.label}>Amount paying now</div>
                <input
                  className={styles.tendered}
                  type="number"
                  step="0.01"
                  min="0"
                  max={totals.total}
                  value={debtAmount}
                  placeholder="0.00"
                  onChange={(e) => setDebtAmount(e.target.value)}
                  autoFocus
                />
                <div className={styles.quickAmounts}>
                  <button
                    type="button"
                    className={styles.quick}
                    onClick={() => setDebtAmount("0")}
                  >
                    No payment
                  </button>
                  <button
                    type="button"
                    className={styles.quick}
                    onClick={() => setDebtAmount(totals.total.toFixed(2))}
                  >
                    Pay full
                  </button>
                  <button
                    type="button"
                    className={styles.quick}
                    onClick={() => setDebtAmount((totals.total / 2).toFixed(2))}
                  >
                    Half
                  </button>
                </div>
                <div className={styles.hint}>
                  Enter the amount received now, or leave at 0 to close without payment.
                </div>
              </div>
            ) : selected ? (
              <div className={styles.cardPrompt}>
                {processing ? (
                  <>
                    <div className={styles.spinner} />
                    <div style={{ fontWeight: 500 }}>Processing {selected.name}…</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                      Posting sale to Regos
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.cardIcon}>
                      <CreditCard size={28} />
                    </div>
                    <div style={{ fontWeight: 500 }}>Complete {selected.name} payment</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                      Tap Charge to confirm
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </>
        )}
          </div>

          <div className={styles.checkoutActions}>
            <Button full size="lg" onClick={handleCharge} disabled={!canCharge}>
              {processing ? processingLabel : chargeLabel}
            </Button>
            {showCloseSecondary && (
              <>
                <p className={styles.closeWithoutPaymentHint}>
                  No payment will be recorded in Regos. Customer debt will be{" "}
                  <strong>{formatCurrency(totals.total)}</strong>.
                </p>
                <Button
                  full
                  size="lg"
                  variant="secondary"
                  onClick={handleCloseWithoutPayment}
                  disabled={processing}
                >
                  {processing ? "Closing without payment…" : "Close without payment"}
                </Button>
              </>
            )}
          </div>
        </div>
      </Modal>

      <ReceiptModal sale={completedSale} onClose={() => setCompletedSale(null)} />
    </>
  );
}
