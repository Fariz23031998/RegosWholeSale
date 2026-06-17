import { Banknote, CreditCard } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { useCart } from "@/store/cart";
import { formatAuthError, useAuth } from "@/store/auth";
import { useCatalog } from "@/store/catalog";
import { usePosConfig } from "@/store/pos-config";
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

export function CheckoutModal({ open, onClose, totals }: Props) {
  const items = useCart((s) => s.items);
  const discount = useCart((s) => s.discount);
  const clearCart = useCart((s) => s.clear);
  const cashier = useAuth((s) => s.cashier);
  const accessToken = useAuth((s) => s.accessToken);
  const requestCatalogRefresh = useCatalog((s) => s.requestRefresh);
  const tenderedQuickAmounts = usePosConfig((s) => s.tenderedQuickAmounts);

  const [paymentTypes, setPaymentTypes] = useState<PaymentType[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tendered, setTendered] = useState<string>("");
  const [processing, setProcessing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);

  const selected = useMemo(
    () => paymentTypes.find((t) => t.id === selectedId) ?? null,
    [paymentTypes, selectedId],
  );

  const tenderedNum = parseFloat(tendered) || 0;
  const change = Math.max(0, tenderedNum - totals.total);
  const canCash = Boolean(selected?.is_cash && tenderedNum >= totals.total);
  const canCharge = Boolean(
    selected && (!selected.is_cash || canCash) && !processing && !typesLoading,
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
    change: paymentType.is_cash ? change : undefined,
  });

  const submitCheckout = async (paymentType: PaymentType) => {
    if (!accessToken || !cashier) return;

    const cartItems = items.filter((i) => i.regosItemId > 0);
    if (cartItems.length !== items.length) {
      setCheckoutError("Some cart items are missing Regos product ids.");
      return;
    }

    setProcessing(true);
    setCheckoutError(null);

    try {
      const result = await checkoutSale(accessToken, {
        items: cartItems.map((i) => ({
          regos_item_id: i.regosItemId,
          qty: i.qty,
          price: i.price,
        })),
        discount,
        payment_type_id: paymentType.id,
        total: totals.total,
        tendered: paymentType.is_cash ? tenderedNum : undefined,
        change: paymentType.is_cash ? change : undefined,
        description: `POS ${cashier.name}`,
      });

      const sale = buildSaleFromResponse(
        paymentType,
        result.wholesale_code,
        result.performed_at,
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
                </div>
                <div className={styles.change}>
                  <span>Change</span>
                  <span>{formatCurrency(change)}</span>
                </div>
              </>
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
              {processing ? "Processing…" : `Charge ${formatCurrency(totals.total)}`}
            </Button>
          </div>
        </div>
      </Modal>

      <ReceiptModal sale={completedSale} onClose={() => setCompletedSale(null)} />
    </>
  );
}
