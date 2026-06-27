import { Minus, Percent, Plus, Printer, ShoppingBag, ShoppingCart, Tag, X } from "lucide-react";
import { startTransition, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import { cartTotals, useCart } from "@/store/cart";
import { useCatalog } from "@/store/catalog";
import { usePosConfig } from "@/store/pos-config";
import { usePermissions } from "@/hooks/use-permissions";
import { filterCheckoutOverrides } from "@/types/users";
import { useAuth, formatAuthError } from "@/store/auth";
import { useSellContext } from "@/store/sell-context";
import { useCheckoutTabs, getReservedQtyInOtherTabs } from "@/store/checkout-tabs";
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
import { toast } from "sonner";
import { postponeSale } from "@/lib/sales-api";
import { buildPrintContextFromCartDraft } from "@/lib/receipt-context-builder";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import { Button } from "@/components/posui/Button";
import { CheckoutModal } from "@/components/Checkout/CheckoutModal";
import { ContinueSaleModal } from "@/components/Cart/ContinueSaleModal";
import { ReceiptModal } from "@/components/Receipt/ReceiptModal";
import { CheckoutTabs } from "./CheckoutTabs";
import { CartLineImage } from "./CartLineImage";
import { QtyKeypad } from "./QtyKeypad";
import styles from "./Cart.module.css";

export function CartPanel() {
  const { t } = useLanguage();
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
  const postponedDocType = useCart((s) => s.postponedDocType);
  const accessToken = useAuth((s) => s.accessToken);
  const cashier = useAuth((s) => s.cashier);
  const {
    canChangeWarehouse,
    canChangePriceType,
    canChangePartner,
    canApplyDiscount,
    canModifyPrice,
    canPostponeSale,
    canContinueSale,
    canPrintDocuments,
  } = usePermissions();
  const checkoutOverrides = useSellContext((s) => s.checkoutOverrides);
  const permittedOverrides = () =>
    filterCheckoutOverrides(checkoutOverrides(), {
      canChangeWarehouse: canChangeWarehouse(),
      canChangePriceType: canChangePriceType(),
      canChangePartner: canChangePartner(),
    });
  const saleCurrency = useSellContext((s) => s.saleCurrency);
  const partnerId = useSellContext((s) => s.partnerId);
  const warehouseId = useSellContext((s) => s.warehouseId);
  const partners = useSellContext((s) => s.options.partners);
  const warehouses = useSellContext((s) => s.options.warehouses);
  const clearActiveTabAfterCheckout = useCheckoutTabs(
    (s) => s.clearActiveTabAfterCheckout,
  );
  const checkoutTabs = useCheckoutTabs((s) => s.tabs);
  const activeCheckoutTabId = useCheckoutTabs((s) => s.activeTabId);
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
        getReservedQtyInOtherTabs(
          checkoutTabs,
          activeCheckoutTabId,
          keypadItem.productId,
        ),
      )
    : null;
  const itemCount = items.reduce((s, i) => s + i.qty, 0);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [continueOpen, setContinueOpen] = useState(false);
  const [postponing, setPostponing] = useState(false);
  const [postponeError, setPostponeError] = useState<string | null>(null);
  const [printContext, setPrintContext] = useState<DocumentPrintContext | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const lastAddedId = useCart((s) => s.lastAddedId);
  const lastAddedAt = useCart((s) => s.lastAddedAt);
  const skipKeypadOnLastAdd = useCart((s) => s.skipKeypadOnLastAdd);
  const clearSkipKeypadOnLastAdd = useCart((s) => s.clearSkipKeypadOnLastAdd);
  const seenAddRef = useRef(0);
  useEffect(() => {
    if (!lastAddedAt || lastAddedAt === seenAddRef.current) return;
    seenAddRef.current = lastAddedAt;
    if (autoOpenKeypad && lastAddedId && !skipKeypadOnLastAdd) {
      setKeypadFor(lastAddedId);
    }
    if (skipKeypadOnLastAdd) clearSkipKeypadOnLastAdd();
  }, [
    autoOpenKeypad,
    clearSkipKeypadOnLastAdd,
    lastAddedAt,
    lastAddedId,
    skipKeypadOnLastAdd,
  ]);

  const openDraftPrint = () => {
    if (items.length === 0 || postponing) return;

    const cartItems = items.filter((item) => item.regosItemId > 0);
    if (cartItems.length !== items.length) {
      setPrintError(t("cart.missingRegosIds", "Some cart items are missing Regos product ids."));
      return;
    }

    setPrintError(null);
    const partner = partners.find((entry) => entry.id === partnerId) ?? null;
    const warehouse = warehouses.find((entry) => entry.id === warehouseId) ?? null;

    setPrintContext(
      buildPrintContextFromCartDraft({
        items: cartItems,
        totals,
        catalogProducts,
        saleCurrency,
        partnerId,
        partnerName: partner?.name ?? null,
        stockId: warehouseId,
        stockName: warehouse?.name ?? null,
        cashierId: cashier?.id ?? null,
        cashierName: cashier?.name ?? t("checkout.cashierFallback", "Cashier"),
        wholesaleDocId: postponedWholesaleDocId,
      }),
    );
  };

  const handlePostponeSale = async () => {
    if (!accessToken || !cashier || items.length === 0 || postponing) return;

    const cartItems = items.filter((item) => item.regosItemId > 0);
    if (cartItems.length !== items.length) {
      setPostponeError(t("cart.missingRegosIds", "Some cart items are missing Regos product ids."));
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
        ...(permittedOverrides()),
      });
      toast.success(t("cart.postponeSuccess", "Sale postponed"));
      clear();
      clearActiveTabAfterCheckout();
      setMobileOpen(false);
    } catch (err: unknown) {
      setPostponeError(formatAuthError(err, t("cart.errors.postponeFailed", "Failed to postpone sale")));
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
        aria-label={t("cart.openCurrentSale", "Open current sale")}
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
            {t("cart.currentSale", "Current Sale")}{" "}
            <span className={styles.count}>{items.length}</span>
          </div>
          <div className={styles.headerActions}>
            {items.length > 0 && canPrintDocuments() && (
              <>
                <button
                  type="button"
                  className={styles.printBtn}
                  onClick={openDraftPrint}
                  disabled={postponing}
                  aria-label={t("sales.printModalTitle", "Print sale")}
                  title={t("sales.printModalTitle", "Print sale")}
                >
                  <Printer size={18} />
                </button>
                <button className={styles.clear} onClick={clear}>
                  {t("cart.clear", "Clear")}
                </button>
              </>
            )}
            {items.length > 0 && !canPrintDocuments() && (
              <button className={styles.clear} onClick={clear}>
                {t("cart.clear", "Clear")}
              </button>
            )}
            <button
              className={styles.closeBtn}
              onClick={() => setMobileOpen(false)}
              aria-label={t("common.close", "Close")}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <CheckoutTabs />

        {postponedWholesaleDocId !== null && (
          <div className={styles.postponedBanner}>
            {postponedDocType === "order_from_partner"
              ? t("cart.postponedOrderBanner", "Continuing postponed order #{{id}}", {
                  id: postponedWholesaleDocId,
                })
              : t("cart.postponedBanner", "Continuing postponed sale #{{id}}", {
                  id: postponedWholesaleDocId,
                })}
          </div>
        )}

      <div className={styles.items}>
        {items.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>
              <ShoppingBag size={22} />
            </div>
            <div style={{ fontWeight: 500, color: "var(--color-text-muted)" }}>
              {t("cart.empty", "Cart is empty")}
            </div>
            <div>{t("cart.emptyHint", "Tap a product to add it to the sale.")}</div>
          </div>
        ) : (
          items.map((i) => {
            const unitType = resolveCartUnitType(
              i.unitType,
              catalogProducts,
              i.productId,
            );
            const reservedInOtherTabs = getReservedQtyInOtherTabs(
              checkoutTabs,
              activeCheckoutTabId,
              i.productId,
            );
            const canIncrease = canIncreaseCartQty(
              i.productId,
              i.qty,
              catalogProducts,
              allowOutOfStock,
              reservedInOtherTabs,
            );
            return (
            <div key={i.productId} className={styles.line}>
              <CartLineImage image={i.image} name={i.name} />
              <div>
                <div className={styles.lineName}>{i.name}</div>
                <div className={styles.linePrice}>
                  {t("cart.priceEa", "{{price}} ea", { price: formatCurrency(i.price) })}
                </div>
                <div className={styles.qty} style={{ marginTop: 6, width: "fit-content" }}>
                  <button
                    className={styles.qtyBtn}
                    onClick={() => {
                      startTransition(() => setQty(i.productId, i.qty - 1, unitType));
                    }}
                    aria-label={t("cart.qty.decrease", "Decrease")}
                  >
                    <Minus size={13} />
                  </button>
                  <button
                    type="button"
                    className={styles.qtyVal}
                    onClick={() => setKeypadFor(i.productId)}
                    aria-label={`Edit quantity for ${i.name}`}
                    title={t("cart.qty.tapToEnter", "Tap to enter quantity")}
                  >
                    {formatCartQty(i.qty, unitType)}
                  </button>
                  <button
                    className={styles.qtyBtn}
                    disabled={!canIncrease}
                    onClick={() => {
                      if (!canIncrease) return;
                      startTransition(() => setQty(i.productId, i.qty + 1, unitType));
                    }}
                    aria-label={t("cart.qty.increase", "Increase")}
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
              <div className={styles.lineRight}>
                <button
                  className={styles.qtyBtn}
                  onClick={() => {
                    startTransition(() => remove(i.productId));
                  }}
                  aria-label={t("cart.qty.remove", "Remove")}
                  title={t("cart.qty.remove", "Remove")}
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
          <span>{t("cart.subtotal", "Subtotal")}</span>
          <span>{formatCurrency(totals.subtotal)}</span>
        </div>
        {canApplyDiscount() && (
        <div className={styles.row}>
          <span className={styles.discountLabel}>{t("cart.discount", "Discount")}</span>
          <div className={styles.discountControls}>
            <button
              type="button"
              className={styles.discountModeBtn}
              onClick={() => {
                startTransition(() => toggleDiscountMode());
              }}
              aria-label={
                discountMode === "percent"
                  ? t("cart.discountMode.toFixed", "Switch to fixed amount discount")
                  : t("cart.discountMode.toPercent", "Switch to percentage discount")
              }
              title={
                discountMode === "percent"
                  ? t("cart.discountMode.percentHint", "Percentage — click for fixed amount")
                  : t("cart.discountMode.fixedHint", "Fixed amount — click for percentage")
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
                  ? t("cart.discountLabel.percent", "Discount percentage")
                  : t("cart.discountLabel.amount", "Discount amount")
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
        )}
        <div className={`${styles.row} ${styles.totalRow}`}>
          <span>{t("cart.total", "Total")}</span>
          <span>{formatCurrency(totals.total)}</span>
        </div>
        {postponeError && <div className={styles.postponeError}>{postponeError}</div>}
        {printError && <div className={styles.postponeError}>{printError}</div>}
        {(canContinueSale() || canPostponeSale()) && (
        <div className={styles.saleActions}>
          {canContinueSale() && (
          <Button
            full
            variant="secondary"
            disabled={postponing}
            onClick={() => setContinueOpen(true)}
          >
            {t("cart.continueSale", "Continue Sale")}
          </Button>
          )}
          {canPostponeSale() && (
          <Button
            full
            variant="secondary"
            disabled={items.length === 0 || postponing}
            onClick={() => void handlePostponeSale()}
          >
            {postponing ? t("cart.postponing", "Postponing…") : t("cart.postponeSale", "Postpone Sale")}
          </Button>
          )}
        </div>
        )}
        <Button
          full
          size="lg"
          className={styles.charge}
          disabled={items.length === 0 || postponing}
          onClick={() => setCheckoutOpen(true)}
        >
          {t("cart.charge", "Charge {{total}}", { total: formatCurrency(totals.total) })}
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
      {printContext ? (
        <ReceiptModal
          context={printContext}
          title={t("sales.printModalTitle", "Print sale")}
          closeLabel={t("common.close", "Close")}
          onClose={() => setPrintContext(null)}
        />
      ) : null}
    </aside>

      <QtyKeypad
        open={keypadItem !== null}
        initial={keypadItem?.qty ?? 0}
        initialPrice={canModifyPrice() ? keypadItem?.price ?? 0 : undefined}
        productName={keypadItem?.name}
        allowDecimals={keypadQtyAllowsDecimals}
        onClose={() => setKeypadFor(null)}
        onConfirm={(n, p) => {
          if (!keypadItem) return;
          const stock = getProductStock(catalogProducts, keypadItem.productId);
          const reservedInOtherTabs = getReservedQtyInOtherTabs(
            checkoutTabs,
            activeCheckoutTabId,
            keypadItem.productId,
          );
          setQty(
            keypadItem.productId,
            clampCartQty(
              n,
              stock,
              allowOutOfStock,
              keypadUnitType,
              reservedInOtherTabs,
            ),
            keypadUnitType,
          );
          if (p !== undefined) setPrice(keypadItem.productId, p);
        }}
        maxQty={keypadMaxQty}
      />
    </>
  );
}
