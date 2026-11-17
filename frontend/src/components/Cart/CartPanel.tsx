import { Minus, Percent, Plus, Printer, ShoppingBag, ShoppingCart, Tag, X } from "lucide-react";
import { startTransition, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import { cartTotals, toCheckoutCartItem, useCart } from "@/store/cart";
import { useCatalog } from "@/store/catalog";
import { usePosConfig } from "@/store/pos-config";
import { useBookedOrderContinuation } from "@/hooks/use-booked-order-continuation";
import { usePermissions } from "@/hooks/use-permissions";
import { filterCheckoutOverrides } from "@/types/users";
import { useAuth, formatAuthError } from "@/store/auth";
import { useSellContext } from "@/store/sell-context";
import { useCheckoutTabs, getReservedQtyInOtherTabs } from "@/store/checkout-tabs";
import {
  allowsDecimalQty,
  applyStockAdjustments,
  canFitBaseQtyInCart,
  cartLinesWithinStock,
  computePostponeStockAdjustments,
  formatCartQty,
  getCartAvailabilityStock,
  getProductStock,
  maxCartQty,
  resolveCartUnitType,
  shouldReserveStockOnPostpone,
  type StockAdjustOp,
} from "@/lib/cart-stock";
import {
  maxEnteredQty,
  productHasSecondaryUnit,
  unitMetaForSelection,
  type SelectedUnitKind,
} from "@/lib/secondary-units";
import { formatAmountWithCurrency } from "@/lib/checkout-payments";
import { amountInPriceCurrency } from "@/lib/currency-conversion";
import {
  convertCartTotalsForSaleCurrency,
  convertPriceAmount,
} from "@/lib/sale-currency-amounts";
import { toast } from "sonner";
import { extractWholesaleDocIdFromError } from "@/lib/checkout-error";
import { isCacheEnabled } from "@/lib/cache-policy";
import { enqueuePendingSaleSync } from "@/lib/pending-sales-sync";
import { buildPendingSalesScopeKey } from "@/types/pending-sale";
import { postponeSale, type PostponeRequest } from "@/lib/sales-api";
import { usePendingSales } from "@/store/pending-sales";
import { buildPrintContextFromCartDraft, loadPrintContextFromCartDraft } from "@/lib/receipt-context-builder";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import { Button } from "@/components/posui/Button";
import { CheckoutModal } from "@/components/Checkout/CheckoutModal";
import { ContinueSaleModal } from "@/components/Cart/ContinueSaleModal";
import { ReceiptModal } from "@/components/Receipt/ReceiptModal";
import type { PaymentSubmitPayload } from "@/components/Checkout/PaymentPanel";
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
  const setSelectedUnit = useCart((s) => s.setSelectedUnit);
  const setPrice = useCart((s) => s.setPrice);
  const remove = useCart((s) => s.remove);
  const setDiscountValue = useCart((s) => s.setDiscountValue);
  const toggleDiscountMode = useCart((s) => s.toggleDiscountMode);
  const clear = useCart((s) => s.clear);
  const postponedWholesaleDocId = useCart((s) => s.postponedWholesaleDocId);
  const postponedDocType = useCart((s) => s.postponedDocType);
  const setPostponedWholesaleDocId = useCart((s) => s.setPostponedWholesaleDocId);
  const setPostponedDocType = useCart((s) => s.setPostponedDocType);
  const accessToken = useAuth((s) => s.accessToken);
  const cashier = useAuth((s) => s.cashier);
  const user = useAuth((s) => s.user);
  const {
    canChangeWarehouse,
    canChangePriceType,
    canChangePartner,
    canChangeCurrency,
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
      canChangeCurrency: canChangeCurrency(),
    });
  const saleCurrency = useSellContext((s) => s.saleCurrency);
  const priceCurrency = useSellContext((s) => s.priceCurrency);
  const priceTypeId = useSellContext((s) => s.priceTypeId);
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
  const decrementStock = useCatalog((s) => s.decrementStock);
  const incrementStock = useCatalog((s) => s.incrementStock);
  const allowOutOfStock = usePosConfig((s) => s.allowOutOfStock);
  const postponeDocumentType = usePosConfig((s) => s.postponeDocumentType);
  const postponeOrderBooked = usePosConfig((s) => s.postponeOrderBooked);
  const keypadUpdateDiscountedPriceOnly = usePosConfig(
    (s) => s.keypadUpdateDiscountedPriceOnly,
  );
  const bookedOrderContinuation = useBookedOrderContinuation();
  const catalogStockOptions = bookedOrderContinuation
    ? { bookedOrderContinuation: true as const }
    : undefined;
  const autoOpenKeypad = usePosConfig((s) => s.autoOpenQtyKeypad);
  const secondaryUnitMode = usePosConfig((s) => s.secondaryUnitMode);
  const [keypadFor, setKeypadFor] = useState<string | null>(null);
  const [keypadPendingUnit, setKeypadPendingUnit] =
    useState<SelectedUnitKind>("main");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const totals = cartTotals(items, discountMode, discountValue);
  const displayTotals = convertCartTotalsForSaleCurrency(
    totals,
    priceCurrency,
    saleCurrency,
  );
  const formatSaleAmount = (amount: number) =>
    formatAmountWithCurrency(
      convertPriceAmount(amount, priceCurrency, saleCurrency),
      saleCurrency,
    );
  const keypadItem = items.find((i) => i.productId === keypadFor) ?? null;
  const keypadCatalogProduct = keypadItem
    ? catalogProducts.find((p) => p.id === keypadItem.productId)
    : undefined;
  const keypadShowUnitChoice = Boolean(
    secondaryUnitMode === "ask" &&
      keypadCatalogProduct &&
      productHasSecondaryUnit(keypadCatalogProduct),
  );
  const keypadPendingMeta =
    keypadShowUnitChoice && keypadCatalogProduct
      ? unitMetaForSelection(keypadCatalogProduct, keypadPendingUnit)
      : null;
  const keypadUnitType = keypadItem
    ? resolveCartUnitType(
        keypadPendingMeta?.selectedUnitType ??
          keypadItem.selectedUnitType ??
          keypadItem.unitType,
        catalogProducts,
        keypadItem.productId,
      )
    : undefined;
  const keypadQtyAllowsDecimals = allowsDecimalQty(keypadUnitType);
  const keypadFactor =
    keypadPendingMeta?.conversionFactor ?? keypadItem?.conversionFactor ?? 1;
  const keypadLineFactor = keypadItem?.conversionFactor ?? 1;
  const keypadEnteredQty = keypadItem
    ? (keypadItem.enteredQty ??
      (keypadLineFactor > 0
        ? keypadItem.qty / keypadLineFactor
        : keypadItem.qty))
    : 0;
  const keypadMaxBaseQty = keypadItem
    ? maxCartQty(
        getCartAvailabilityStock(
          getProductStock(catalogProducts, keypadItem.productId),
          keypadItem.qty,
          catalogStockOptions,
        ),
        allowOutOfStock,
        getReservedQtyInOtherTabs(
          checkoutTabs,
          activeCheckoutTabId,
          keypadItem.productId,
        ),
      )
    : null;
  const keypadMaxQty = maxEnteredQty(
    keypadMaxBaseQty,
    keypadFactor,
    keypadUnitType,
  );
  const keypadSecondaryMeta =
    keypadShowUnitChoice && keypadCatalogProduct
      ? unitMetaForSelection(keypadCatalogProduct, "secondary")
      : null;
  const keypadSecondaryMaxQty = keypadSecondaryMeta
    ? maxEnteredQty(
        keypadMaxBaseQty,
        keypadSecondaryMeta.conversionFactor,
        resolveCartUnitType(
          keypadSecondaryMeta.selectedUnitType,
          catalogProducts,
          keypadItem?.productId ?? "",
        ),
      )
    : null;
  const keypadSecondaryDisabled =
    keypadSecondaryMaxQty != null && keypadSecondaryMaxQty < 1;
  const itemCount = items.reduce((s, i) => s + i.qty, 0);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [restorePaymentPayload, setRestorePaymentPayload] =
    useState<PaymentSubmitPayload | null>(null);
  const [restoreRetryLocalId, setRestoreRetryLocalId] = useState<string | null>(null);
  const enqueuePendingSale = usePendingSales((s) => s.enqueue);
  const upsertPendingSale = usePendingSales((s) => s.upsertRecord);
  const setActiveRetryLocalId = usePendingSales((s) => s.setActiveRetryLocalId);
  const activeRetryLocalId = usePendingSales((s) => s.activeRetryLocalId);
  const checkoutRestoreRequest = usePendingSales((s) => s.checkoutRestoreRequest);
  const clearCheckoutRestore = usePendingSales((s) => s.clearCheckoutRestore);
  const [continueOpen, setContinueOpen] = useState(false);
  const [postponing, setPostponing] = useState(false);
  const [postponeError, setPostponeError] = useState<string | null>(null);
  const [printContext, setPrintContext] = useState<DocumentPrintContext | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const lastAddedId = useCart((s) => s.lastAddedId);
  const lastAddedAt = useCart((s) => s.lastAddedAt);
  const skipKeypadOnLastAdd = useCart((s) => s.skipKeypadOnLastAdd);
  const forceKeypadOnLastAdd = useCart((s) => s.forceKeypadOnLastAdd);
  const clearSkipKeypadOnLastAdd = useCart((s) => s.clearSkipKeypadOnLastAdd);
  const clearForceKeypadOnLastAdd = useCart((s) => s.clearForceKeypadOnLastAdd);
  const seenAddRef = useRef(0);

  useEffect(() => {
    if (!checkoutRestoreRequest) return;
    setRestorePaymentPayload(checkoutRestoreRequest.initialPaymentPayload);
    setRestoreRetryLocalId(checkoutRestoreRequest.localId);
    setCheckoutOpen(true);
    clearCheckoutRestore();
  }, [checkoutRestoreRequest, clearCheckoutRestore]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!keypadFor) return;
    const item = items.find((i) => i.productId === keypadFor);
    if (item) setKeypadPendingUnit(item.selectedUnit ?? "main");
    // Only re-init when opening for a product id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keypadFor]);

  useEffect(() => {
    if (!lastAddedAt || lastAddedAt === seenAddRef.current) return;
    seenAddRef.current = lastAddedAt;
    if (
      (autoOpenKeypad || forceKeypadOnLastAdd) &&
      lastAddedId &&
      !skipKeypadOnLastAdd
    ) {
      setKeypadFor(lastAddedId);
    }
    if (skipKeypadOnLastAdd) clearSkipKeypadOnLastAdd();
    if (forceKeypadOnLastAdd) clearForceKeypadOnLastAdd();
  }, [
    autoOpenKeypad,
    clearForceKeypadOnLastAdd,
    clearSkipKeypadOnLastAdd,
    forceKeypadOnLastAdd,
    lastAddedAt,
    lastAddedId,
    skipKeypadOnLastAdd,
  ]);

  const openDraftPrint = () => {
    if (items.length === 0 || postponing || printLoading) return;

    const cartItems = items.filter((item) => item.regosItemId > 0);
    if (cartItems.length !== items.length) {
      setPrintError(t("cart.missingRegosIds", "Some cart items are missing Regos product ids."));
      return;
    }

    setPrintError(null);
    const partner = partners.find((entry) => entry.id === partnerId) ?? null;
    const warehouse = warehouses.find((entry) => entry.id === warehouseId) ?? null;
    const draftInput = {
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
      keypadUpdateDiscountedPriceOnly,
    };

    setPrintLoading(true);
    void loadPrintContextFromCartDraft(accessToken, draftInput)
      .then((context) => {
        setPrintContext(context);
      })
      .catch(() => {
        setPrintContext(buildPrintContextFromCartDraft(draftInput));
      })
      .finally(() => {
        setPrintLoading(false);
      });
  };

  const handlePostponeSale = async () => {
    if (!accessToken || !cashier || !user || items.length === 0 || postponing) return;

    const cartItems = items.filter((item) => item.regosItemId > 0);
    if (cartItems.length !== items.length) {
      setPostponeError(t("cart.missingRegosIds", "Some cart items are missing Regos product ids."));
      return;
    }

    const reservedByProductId: Record<string, number> = {};
    for (const item of cartItems) {
      reservedByProductId[item.productId] = getReservedQtyInOtherTabs(
        checkoutTabs,
        activeCheckoutTabId,
        item.productId,
      );
    }
    if (
      !cartLinesWithinStock(
        cartItems,
        catalogProducts,
        allowOutOfStock,
        reservedByProductId,
        catalogStockOptions,
      )
    ) {
      setPostponeError(
        t(
          "checkout.errors.insufficientStock",
          "Some products exceed available stock. Reduce quantities or enable out-of-stock sales.",
        ),
      );
      return;
    }

    const scopeKey = buildPendingSalesScopeKey(user.company_id, user.id);
    if (!scopeKey) return;

    setPostponing(true);
    setPostponeError(null);

    const saleTotals = convertCartTotalsForSaleCurrency(
      totals,
      priceCurrency,
      saleCurrency,
    );
    const request: PostponeRequest = {
      // Line prices stay in price-type currency; backend converts into sale currency.
      items: cartItems.map((item) =>
        toCheckoutCartItem(item, keypadUpdateDiscountedPriceOnly),
      ),
      discount: totals.discount,
      total: saleTotals.total,
      description: `POS ${cashier.name}`,
      ...(postponedWholesaleDocId
        ? { wholesale_doc_id: postponedWholesaleDocId }
        : {}),
      ...permittedOverrides(),
    };

    let stockAdjustments: StockAdjustOp[] = [];
    if (shouldReserveStockOnPostpone(postponeDocumentType, postponeOrderBooked)) {
      stockAdjustments = computePostponeStockAdjustments(
        cartItems,
        postponedWholesaleDocId != null,
      );
    }

    const localId = activeRetryLocalId ?? crypto.randomUUID();
    const record = {
      localId,
      scopeKey,
      kind: "postpone" as const,
      status: "pending" as const,
      companyId: user.company_id,
      userId: user.id,
      createdAt: Date.now(),
      lastAttemptAt: null,
      attemptCount: 0,
      errorMessage: null,
      errorCode: null,
      request,
      wholesaleDocId: postponedWholesaleDocId,
      postponedDocType,
      cartItems: [...cartItems],
      discountMode,
      discountValue,
      totals: { ...totals },
      sellContext: {
        warehouseId,
        priceTypeId,
        partnerId,
        saleCurrency,
      },
      cashier: { id: cashier.id, name: cashier.name },
      description: request.description ?? "",
      stockAdjustments,
    };

    try {
      if (activeRetryLocalId || isCacheEnabled()) {
        if (activeRetryLocalId) {
          // Upsert so the retried sale is re-created even if the stored record
          // was removed in the meantime, instead of being silently dropped.
          await upsertPendingSale(record);
          setActiveRetryLocalId(null);
        } else {
          await enqueuePendingSale(record);
        }
        if (stockAdjustments.length > 0) {
          applyStockAdjustments(stockAdjustments, decrementStock, incrementStock);
        }
        toast.success(t("cart.postponeSuccess", "Sale postponed"));
        clear();
        clearActiveTabAfterCheckout();
        setMobileOpen(false);
        enqueuePendingSaleSync(localId);
        return;
      }

      await postponeSale(accessToken, request);
      if (stockAdjustments.length > 0) {
        applyStockAdjustments(stockAdjustments, decrementStock, incrementStock);
      }
      toast.success(t("cart.postponeSuccess", "Sale postponed"));
      clear();
      clearActiveTabAfterCheckout();
      setMobileOpen(false);
    } catch (err: unknown) {
      if (!activeRetryLocalId && !isCacheEnabled()) {
        const failedWholesaleDocId = extractWholesaleDocIdFromError(err);
        if (failedWholesaleDocId !== null) {
          setPostponedWholesaleDocId(failedWholesaleDocId);
          setPostponedDocType("wholesale");
        }
      }
      setPostponeError(formatAuthError(err, t("cart.errors.postponeFailed", "Failed to postpone sale")));
    } finally {
      setPostponing(false);
    }
  };

  const handleClearCart = () => {
    clear();
    clearActiveTabAfterCheckout();
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
                  disabled={postponing || printLoading}
                  aria-label={t("sales.printModalTitle", "Print sale")}
                  title={t("sales.printModalTitle", "Print sale")}
                >
                  <Printer size={18} />
                </button>
                <button className={styles.clear} onClick={handleClearCart}>
                  {t("cart.clear", "Clear")}
                </button>
              </>
            )}
            {items.length > 0 && !canPrintDocuments() && (
              <button className={styles.clear} onClick={handleClearCart}>
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
            const factor = i.conversionFactor ?? 1;
            const unitType = resolveCartUnitType(
              i.selectedUnitType ?? i.unitType,
              catalogProducts,
              i.productId,
            );
            const catalogProduct = catalogProducts.find(
              (p) => p.id === i.productId,
            );
            const mainUnitType = catalogProduct?.unit_type ?? null;
            const mainUnitName =
              i.itemUnitName?.trim() ||
              catalogProduct?.unit_name?.trim() ||
              "";
            const enteredQty =
              i.enteredQty ?? (factor > 0 ? i.qty / factor : i.qty);
            const reservedInOtherTabs = getReservedQtyInOtherTabs(
              checkoutTabs,
              activeCheckoutTabId,
              i.productId,
            );
            const canIncrease = catalogProduct
              ? canFitBaseQtyInCart(
                  catalogProduct,
                  i.qty,
                  factor,
                  allowOutOfStock,
                  reservedInOtherTabs,
                  catalogStockOptions,
                )
              : allowOutOfStock;
            const unitLabel =
              i.selectedUnitName?.trim() || i.itemUnitName?.trim() || "";
            const showMainEquivalent =
              i.selectedUnit === "secondary" && factor > 0;
            return (
            <div key={i.productId} className={styles.line}>
              <CartLineImage image={i.image} name={i.name} />
              <div>
                <div className={styles.lineName}>{i.name}</div>
                <div className={styles.linePrice}>
                  {t("cart.priceEa", "{{price}} ea", {
                    price: formatSaleAmount(i.price * factor),
                  })}
                  {unitLabel ? ` · ${unitLabel}` : null}
                </div>
                <div className={styles.qty} style={{ marginTop: 6, width: "fit-content" }}>
                  <button
                    className={styles.qtyBtn}
                    onClick={() => {
                      startTransition(() =>
                        setQty(i.productId, enteredQty - 1, unitType),
                      );
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
                    {formatCartQty(enteredQty, unitType)}
                  </button>
                  <button
                    className={styles.qtyBtn}
                    disabled={!canIncrease}
                    onClick={() => {
                      if (!canIncrease) return;
                      startTransition(() =>
                        setQty(i.productId, enteredQty + 1, unitType),
                      );
                    }}
                    aria-label={t("cart.qty.increase", "Increase")}
                  >
                    <Plus size={13} />
                  </button>
                </div>
                {showMainEquivalent ? (
                  <div className={styles.mainEquivalent}>
                    {t("cart.qty.mainEquivalent", "= {{qty}} {{unit}}", {
                      qty: formatCartQty(i.qty, mainUnitType),
                      unit: mainUnitName,
                    })}
                  </div>
                ) : null}
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
                  {formatSaleAmount(i.price * i.qty)}
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
          <span>{formatAmountWithCurrency(displayTotals.subtotal, saleCurrency)}</span>
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
            {discountMode === "percent" && displayTotals.discount > 0 && (
              <span className={styles.discountAmount}>
                −{formatAmountWithCurrency(displayTotals.discount, saleCurrency)}
              </span>
            )}
          </div>
        </div>
        )}
        <div className={`${styles.row} ${styles.totalRow}`}>
          <span>{t("cart.total", "Total")}</span>
          <span>{formatAmountWithCurrency(displayTotals.total, saleCurrency)}</span>
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
          {t("cart.charge", "Charge {{total}}", {
            total: formatAmountWithCurrency(displayTotals.total, saleCurrency),
          })}
        </Button>
      </div>

      <CheckoutModal
        open={checkoutOpen}
        onClose={() => {
          setCheckoutOpen(false);
          setRestorePaymentPayload(null);
          setRestoreRetryLocalId(null);
          setActiveRetryLocalId(null);
        }}
        onSuccess={() => {
          if (isMobile) setMobileOpen(false);
          setRestorePaymentPayload(null);
          setRestoreRetryLocalId(null);
          setActiveRetryLocalId(null);
        }}
        totals={totals}
        initialPaymentPayload={restorePaymentPayload}
        retryLocalId={restoreRetryLocalId}
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
        initial={keypadEnteredQty}
        initialPrice={
          canModifyPrice()
            ? convertPriceAmount(
                keypadItem?.price ?? 0,
                priceCurrency,
                saleCurrency,
              )
            : undefined
        }
        productName={keypadItem?.name}
        allowDecimals={keypadQtyAllowsDecimals}
        unitChoice={
          keypadShowUnitChoice && keypadCatalogProduct
            ? {
                selected: keypadPendingUnit,
                mainLabel:
                  keypadCatalogProduct.unit_name?.trim() ||
                  t("pos.unitChoice.main", "Main unit"),
                secondaryLabel:
                  keypadCatalogProduct.secondary_unit_name?.trim() ||
                  t("pos.unitChoice.secondary", "Secondary unit"),
                secondaryDisabled: keypadSecondaryDisabled,
                onSelect: setKeypadPendingUnit,
              }
            : null
        }
        onClose={() => setKeypadFor(null)}
        onConfirm={(n, p) => {
          if (!keypadItem) return;
          const stock = getProductStock(catalogProducts, keypadItem.productId);
          const reservedInOtherTabs = getReservedQtyInOtherTabs(
            checkoutTabs,
            activeCheckoutTabId,
            keypadItem.productId,
          );
          const factor = keypadFactor;
          const maxBase = maxCartQty(
            getCartAvailabilityStock(stock, keypadItem.qty, catalogStockOptions),
            allowOutOfStock,
            reservedInOtherTabs,
          );
          const maxEntered = maxEnteredQty(
            maxBase,
            factor,
            keypadUnitType,
          );
          const clampedEntered =
            maxEntered == null
              ? n
              : Math.min(n, maxEntered);
          if (keypadShowUnitChoice && keypadCatalogProduct) {
            setSelectedUnit(
              keypadItem.productId,
              keypadPendingUnit,
              keypadCatalogProduct,
            );
          }
          setQty(keypadItem.productId, clampedEntered, keypadUnitType);
          if (p !== undefined) {
            setPrice(
              keypadItem.productId,
              amountInPriceCurrency(p, priceCurrency, saleCurrency),
            );
          }
        }}
        maxQty={keypadMaxQty}
      />
    </>
  );
}
