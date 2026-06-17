import { Minus, Plus, ShoppingBag, ShoppingCart, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { cartTotals, useCart } from "@/store/cart";
import { useCatalog } from "@/store/catalog";
import { usePosConfig } from "@/store/pos-config";
import { useSettings } from "@/store/settings";
import {
  clampCartQty,
  canIncreaseCartQty,
  getProductStock,
  maxCartQty,
} from "@/lib/cart-stock";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/posui/Button";
import { CheckoutModal } from "@/components/Checkout/CheckoutModal";
import { CartLineImage } from "./CartLineImage";
import { QtyKeypad } from "./QtyKeypad";
import styles from "./Cart.module.css";

export function CartPanel() {
  const items = useCart((s) => s.items);
  const discount = useCart((s) => s.discount);
  const setQty = useCart((s) => s.setQty);
  const setPrice = useCart((s) => s.setPrice);
  const remove = useCart((s) => s.remove);
  const setDiscount = useCart((s) => s.setDiscount);
  const clear = useCart((s) => s.clear);
  const catalogProducts = useCatalog((s) => s.products);
  const allowOutOfStock = usePosConfig((s) => s.allowOutOfStock);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [keypadFor, setKeypadFor] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const totals = cartTotals(items, discount);
  const keypadItem = items.find((i) => i.productId === keypadFor) ?? null;
  const keypadMaxQty = keypadItem
    ? maxCartQty(
        getProductStock(catalogProducts, keypadItem.productId),
        allowOutOfStock,
      )
    : null;
  const itemCount = items.reduce((s, i) => s + i.qty, 0);

  const autoOpenKeypad = useSettings((s) => s.autoOpenQtyKeypad);
  const lastAddedId = useCart((s) => s.lastAddedId);
  const lastAddedAt = useCart((s) => s.lastAddedAt);
  const seenAddRef = useRef(0);
  useEffect(() => {
    if (!lastAddedAt || lastAddedAt === seenAddRef.current) return;
    seenAddRef.current = lastAddedAt;
    if (autoOpenKeypad && lastAddedId) setKeypadFor(lastAddedId);
  }, [lastAddedAt, lastAddedId, autoOpenKeypad]);

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
                    onClick={() => setQty(i.productId, i.qty - 1)}
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
                    {i.qty}
                  </button>
                  <button
                    className={styles.qtyBtn}
                    disabled={!canIncrease}
                    onClick={() => {
                      if (!canIncrease) return;
                      setQty(i.productId, i.qty + 1);
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
          <span className={styles.discountInput}>
            <Trash2 size={12} /> Discount
          </span>
          <input
            className={styles.discountField}
            type="number"
            min={0}
            step="0.01"
            value={discount || ""}
            placeholder="0.00"
            onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div className={`${styles.row} ${styles.totalRow}`}>
          <span>Total</span>
          <span>{formatCurrency(totals.total)}</span>
        </div>
        <Button
          full
          size="lg"
          className={styles.charge}
          disabled={items.length === 0}
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
    </aside>

      <QtyKeypad
        open={keypadItem !== null}
        initial={keypadItem?.qty ?? 0}
        initialPrice={keypadItem?.price ?? 0}
        productName={keypadItem?.name}
        onClose={() => setKeypadFor(null)}
        onConfirm={(n, p) => {
          if (!keypadItem) return;
          const stock = getProductStock(catalogProducts, keypadItem.productId);
          setQty(
            keypadItem.productId,
            clampCartQty(n, stock, allowOutOfStock),
          );
          if (p !== undefined) setPrice(keypadItem.productId, p);
        }}
        maxQty={keypadMaxQty}
      />
    </>
  );
}
