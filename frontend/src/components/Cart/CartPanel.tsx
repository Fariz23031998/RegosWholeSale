import { Minus, Percent, Plus, ShoppingBag, ShoppingCart, Tag, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { cartTotals, useCart } from "@/store/cart";
import { useCatalog } from "@/store/catalog";
import { usePosConfig } from "@/store/pos-config";
import { useAuth, formatAuthError } from "@/store/auth";
import { useSellContext } from "@/store/sell-context";
import { useCheckoutTabs } from "@/store/checkout-tabs";
import {
  allowsDecimalQty,
  clampCartQty,
  canIncreaseCartQty,
  formatCartQty,
  getProductStock,
  maxCartQty,
  resolveCartUnitType,
} from "@/lib/cart-stock";
import { formatCurrency } from "@/lib/format";
import { postponeSale } from "@/lib/sales-api";
import { Button } from "@/components/posui/Button";
import { CheckoutModal } from "@/components/Checkout/CheckoutModal";
import { ContinueSaleModal } from "@/components/Cart/ContinueSaleModal";
import { CheckoutTabs } from "./CheckoutTabs";
import { CartLineImage } from "./CartLineImage";
import { QtyKeypad } from "./QtyKeypad";
import styles from "./Cart.module.css";

export function CartPanel() {
  const items = useCart((s) => s.items);
  const discountMode = useCart((s) => s.discountMode);
  const discountValue = useCart((s) => s.discountValue);
  const setQty = useCart((s) => s.setQty);
  const setPrice = useCart((s) => s.setPrice);
  const remove = useCart((s) => s.remove);
  const setDiscountValue = useCart((s) => s.setDiscountValue);
  const toggleDiscountMode = useCart((s) => s.toggleDiscountMode);
  const clear = useCart((s) => s.clear);
  const postponedWholesaleDocId = useCart((s) => s.postponedWholesaleDocId);
  const accessToken = useAuth((s) => s.accessToken);
  const cashier = useAuth((s) => s.cashier);
  const user = useAuth((s) => s.user);
  const canOverrideRegos = Boolean(user?.permissions.includes("pos.override_regos"));
  const checkoutOverrides = useSellContext((s) => s.checkoutOverrides);
  const clearActiveTabAfterCheckout = useCheckoutTabs(
    (s) => s.clearActiveTabAfterCheckout,
  );
  const catalogProducts = useCatalog((s) => s.products);
  const allowOutOfStock = usePosConfig((s) => s.allowOutOfStock);
  const autoOpenKeypad = usePosConfig((s) => s.autoOpenQtyKeypad);
  const [keypadFor, setKeypadFor] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const totals = cartTotals(items, discountMode, discountValue);
  const keypadItem = items.find((i) => i.productId === keypadFor) ?? null;
  const keypadUnitType = keypadItem
    ? resolveCartUnitType(keypadItem.unitType, catalogProducts, keypadItem.productId)
    : undefined;
  const keypadQtyAllowsDecimals = allowsDecimalQty(keypadUnitType);
  const keypadMaxQty = keypadItem
    ? maxCartQty(
        getProductStock(catalogProducts, keypadItem.productId),
        allowOutOfStock,
      )
    : null;
  const itemCount = items.reduce((s, i) => s + i.qty, 0);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [continueOpen, setContinueOpen] = useState(false);
  const [postponing, setPostponing] = useState(false);
  const [postponeError, setPostponeError] = useState<string | null>(null);
  const lastAddedId = useCart((s) => s.lastAddedId);
  const lastAddedAt = useCart((s) => s.lastAddedAt);
  const seenAddRef = useRef(0);
  useEffect(() => {
    if (!lastAddedAt || lastAddedAt === seenAddRef.current) return;
    seenAddRef.current = lastAddedAt;
    if (autoOpenKeypad && lastAddedId) setKeypadFor(lastAddedId);
  }, [lastAddedAt, lastAddedId, autoOpenKeypad]);

  const handlePostponeSale = async () => {
    if (!accessToken || !cashier || items.length === 0 || postponing) return;

    const cartItems = items.filter((item) => item.regosItemId > 0);
    if (cartItems.length !== items.length) {
      setPostponeError("Some cart items are missing Regos product ids.");
      return;
    }

    setPostponing(true);
    setPostponeError(null);

    try {
      await postponeSale(accessToken, {
        items: cartItems.map((item) => ({
          regos_item_id: item.regosItemId,
          qty: item.qty,
          price: item.price,
        })),
        discount: totals.discount,
        total: totals.total,
        description: `POS ${cashier.name}`,
        ...(postponedWholesaleDocId
          ? { wholesale_doc_id: postponedWholesaleDocId }
          : {}),
        ...(canOverrideRegos ? checkoutOverrides() : {}),
      });
      clear();
      clearActiveTabAfterCheckout();
      setMobileOpen(false);
    } catch (err: unknown) {
      setPostponeError(formatAuthError(err, "Failed to postpone sale"));
    } finally {
      setPostponing(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.fab}
        onClick={() => setMobileOpen(true)}
        aria-label="Open current sale"
      >
        <ShoppingCart size={22} />
        {itemCount > 0 && <span className={styles.fabBadge}>{itemCount}</span>}
      </button>

      {mobileOpen && (
        <div
          className={styles.backdrop}
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside className={clsx(styles.cart, mobileOpen && styles.cartOpen)}>
        <div className={styles.header}>
          <div className={styles.title}>
            Current Sale{" "}
            <span className={styles.count}>{items.length}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {items.length > 0 && (
              <button className={styles.clear} onClick={clear}>
                Clear
              </button>
            )}
            <button
              className={styles.closeBtn}
              onClick={() => setMobileOpen(false)}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <CheckoutTabs />

        {postponedWholesaleDocId !== null && (
          <div className={styles.postponedBanner}>
            Continuing postponed sale #{postponedWholesaleDocId}
          </div>
        )}

      <div className={styles.items}>
        {items.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>
              <ShoppingBag size={22} />
            </div>
            <div style={{ fontWeight: 500, color: "var(--color-text-muted)" }}>
              Cart is empty
            </div>
            <div>Tap a product to add it to the sale.</div>
          </div>
        ) : (
          items.map((i) => {
            const unitType = resolveCartUnitType(
              i.unitType,
              catalogProducts,
              i.productId,
            );
            const canIncrease = canIncreaseCartQty(
              i.productId,
              i.qty,
              catalogProducts,
              allowOutOfStock,
            );
            return (
            <div key={i.productId} className={styles.line}>
              <CartLineImage image={i.image} name={i.name} />
              <div>
                <div className={styles.lineName}>{i.name}</div>
                <div className={styles.linePrice}>
                  {formatCurrency(i.price)} ea
                </div>
                <div className={styles.qty} style={{ marginTop: 6, width: "fit-content" }}>
                  <button
                    className={styles.qtyBtn}
                    onClick={() => setQty(i.productId, i.qty - 1, unitType)}
                    aria-label="Decrease"
                  >
                    <Minus size={13} />
                  </button>
                  <button
                    type="button"
                    className={styles.qtyVal}
                    onClick={() => setKeypadFor(i.productId)}
                    aria-label={`Edit quantity for ${i.name}`}
                    title="Tap to enter quantity"
                  >
                    {formatCartQty(i.qty, unitType)}
                  </button>
                  <button
                    className={styles.qtyBtn}
                    disabled={!canIncrease}
                    onClick={() => {
                      if (!canIncrease) return;
                      setQty(i.productId, i.qty + 1, unitType);
                    }}
                    aria-label="Increase"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
              <div className={styles.lineRight}>
                <button
                  className={styles.qtyBtn}
                  onClick={() => remove(i.productId)}
                  aria-label="Remove"
                  title="Remove"
                >
                  <X size={14} />
                </button>
                <div className={styles.lineTotal}>
                  {formatCurrency(i.price * i.qty)}
                </div>
              </div>
            </div>
            );
          })
        )}
      </div>

      <div className={styles.summary}>
        <div className={styles.row}>
          <span>Subtotal</span>
          <span>{formatCurrency(totals.subtotal)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.discountLabel}>Discount</span>
          <div className={styles.discountControls}>
            <button
              type="button"
              className={styles.discountModeBtn}
              onClick={toggleDiscountMode}
              aria-label={
                discountMode === "percent"
                  ? "Switch to fixed amount discount"
                  : "Switch to percentage discount"
              }
              title={
                discountMode === "percent"
                  ? "Percentage — click for fixed amount"
                  : "Fixed amount — click for percentage"
              }
            >
              {discountMode === "percent" ? (
                <Percent size={14} />
              ) : (
                <Tag size={14} />
              )}
            </button>
            <input
              className={styles.discountField}
              type="number"
              min={0}
              max={discountMode === "percent" ? 100 : undefined}
              step={discountMode === "percent" ? "0.01" : "0.01"}
              value={discountValue || ""}
              placeholder={discountMode === "percent" ? "0" : "0.00"}
              aria-label={
                discountMode === "percent"
                  ? "Discount percentage"
                  : "Discount amount"
              }
              onChange={(e) =>
                setDiscountValue(parseFloat(e.target.value) || 0)
              }
            />
            <span className={styles.discountSuffix}>
              {discountMode === "percent" ? "%" : ""}
            </span>
            {discountMode === "percent" && totals.discount > 0 && (
              <span className={styles.discountAmount}>
                −{formatCurrency(totals.discount)}
              </span>
            )}
          </div>
        </div>
        <div className={`${styles.row} ${styles.totalRow}`}>
          <span>Total</span>
          <span>{formatCurrency(totals.total)}</span>
        </div>
        {postponeError && <div className={styles.postponeError}>{postponeError}</div>}
        <div className={styles.saleActions}>
          <Button
            full
            variant="secondary"
            disabled={postponing}
            onClick={() => setContinueOpen(true)}
          >
            Continue Sale
          </Button>
          <Button
            full
            variant="secondary"
            disabled={items.length === 0 || postponing}
            onClick={() => void handlePostponeSale()}
          >
            {postponing ? "Postponing…" : "Postpone Sale"}
          </Button>
        </div>
        <Button
          full
          size="lg"
          className={styles.charge}
          disabled={items.length === 0 || postponing}
          onClick={() => setCheckoutOpen(true)}
        >
          Charge {formatCurrency(totals.total)}
        </Button>
      </div>

      <CheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        totals={totals}
      />
      <ContinueSaleModal
        open={continueOpen}
        onClose={() => setContinueOpen(false)}
      />
    </aside>

      <QtyKeypad
        open={keypadItem !== null}
        initial={keypadItem?.qty ?? 0}
        initialPrice={keypadItem?.price ?? 0}
        productName={keypadItem?.name}
        allowDecimals={keypadQtyAllowsDecimals}
        onClose={() => setKeypadFor(null)}
        onConfirm={(n, p) => {
          if (!keypadItem) return;
          const stock = getProductStock(catalogProducts, keypadItem.productId);
          setQty(
            keypadItem.productId,
            clampCartQty(n, stock, allowOutOfStock, keypadUnitType),
            keypadUnitType,
          );
          if (p !== undefined) setPrice(keypadItem.productId, p);
        }}
        maxQty={keypadMaxQty}
      />
    </>
  );
}
