import { useState } from "react";
import { Printer } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Modal } from "@/components/posui/Modal";
import { useCart } from "@/store/cart";
import { usePermissions } from "@/hooks/use-permissions";
import { filterCheckoutOverrides } from "@/types/users";
import { formatAuthError, useAuth } from "@/store/auth";
import { useCatalog } from "@/store/catalog";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";
import { useCheckoutTabs } from "@/store/checkout-tabs";
import { usePendingSales } from "@/store/pending-sales";
import {
  applyStockAdjustments,
  computeCheckoutStockAdjustments,
  isBookedOrderFromPartnerContinuation,
  type StockAdjustOp,
} from "@/lib/cart-stock";
import { formatAmountWithCurrency } from "@/lib/checkout-payments";
import { extractWholesaleDocIdFromError } from "@/lib/checkout-error";
import { isCacheEnabled } from "@/lib/cache-policy";
import { checkoutSale, type CheckoutRequest } from "@/lib/sales-api";
import type { PaymentType } from "@/types/payment";
import type { Sale, SalePaymentLine } from "@/data/seed";
import {
  buildPrintContextFromCartDraft,
  loadPrintContextFromCartDraft,
} from "@/lib/receipt-context-builder";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import { enqueuePendingSaleSync } from "@/lib/pending-sales-sync";
import { buildPendingSalesScopeKey } from "@/types/pending-sale";
import { ReceiptModal } from "@/components/Receipt/ReceiptModal";
import {
  PaymentPanel,
  type PaymentSubmitPayload,
} from "@/components/Checkout/PaymentPanel";
import styles from "./Checkout.module.css";

type Totals = { subtotal: number; discount: number; total: number };

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  totals: Totals;
  initialPaymentPayload?: PaymentSubmitPayload | null;
  retryLocalId?: string | null;
};

export function CheckoutModal({
  open,
  onClose,
  onSuccess,
  totals,
  initialPaymentPayload = null,
  retryLocalId = null,
}: Props) {
  const { t } = useLanguage();
  const items = useCart((s) => s.items);
  const clearCart = useCart((s) => s.clear);
  const discountMode = useCart((s) => s.discountMode);
  const discountValue = useCart((s) => s.discountValue);
  const clearActiveTabAfterCheckout = useCheckoutTabs(
    (s) => s.clearActiveTabAfterCheckout,
  );
  const cashier = useAuth((s) => s.cashier);
  const user = useAuth((s) => s.user);
  const accessToken = useAuth((s) => s.accessToken);
  const { canChangeWarehouse, canChangePriceType, canChangePartner, canPrintDocuments } =
    usePermissions();
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
  const postponedWholesaleDocId = useCart((s) => s.postponedWholesaleDocId);
  const postponedDocType = useCart((s) => s.postponedDocType);
  const setPostponedWholesaleDocId = useCart((s) => s.setPostponedWholesaleDocId);
  const setPostponedDocType = useCart((s) => s.setPostponedDocType);
  const decrementStock = useCatalog((s) => s.decrementStock);
  const incrementStock = useCatalog((s) => s.incrementStock);
  const catalogProducts = useCatalog((s) => s.products);
  const postponeDocumentType = usePosConfig((s) => s.postponeDocumentType);
  const postponeOrderBooked = usePosConfig((s) => s.postponeOrderBooked);
  const tenderedQuickAmounts = usePosConfig((s) => s.tenderedQuickAmounts);
  const enqueuePendingSale = usePendingSales((s) => s.enqueue);
  const upsertPendingSale = usePendingSales((s) => s.upsertRecord);
  const setActiveRetryLocalId = usePendingSales((s) => s.setActiveRetryLocalId);
  const activeRetryLocalId = usePendingSales((s) => s.activeRetryLocalId);

  const [processing, setProcessing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [draftPrintContext, setDraftPrintContext] = useState<DocumentPrintContext | null>(null);
  const [completedContext, setCompletedContext] = useState<DocumentPrintContext | null>(null);
  const [draftPrintLoading, setDraftPrintLoading] = useState(false);

  const reset = () => {
    setProcessing(false);
    setCheckoutError(null);
  };

  const handleClose = () => {
    if (processing) return;
    reset();
    onClose();
  };

  const openDraftPrint = () => {
    if (processing || draftPrintLoading || items.length === 0) return;

    const cartItems = items.filter((item) => item.regosItemId > 0);
    if (cartItems.length !== items.length) {
      setCheckoutError(t("checkout.missingRegosIds", "Some cart items are missing Regos product ids."));
      return;
    }

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
    };

    setDraftPrintLoading(true);
    void loadPrintContextFromCartDraft(accessToken, draftInput)
      .then((context) => {
        setDraftPrintContext(context);
      })
      .catch(() => {
        setDraftPrintContext(buildPrintContextFromCartDraft(draftInput));
      })
      .finally(() => {
        setDraftPrintLoading(false);
      });
  };

  const submitCheckout = async (payload: PaymentSubmitPayload) => {
    if (!accessToken || !cashier || !user) return;

    const cartItems = items.filter((i) => i.regosItemId > 0);
    if (cartItems.length !== items.length) {
      setCheckoutError(t("checkout.missingRegosIds", "Some cart items are missing Regos product ids."));
      return;
    }

    const scopeKey = buildPendingSalesScopeKey(user.company_id, user.id);
    if (!scopeKey) return;

    setProcessing(true);
    setCheckoutError(null);

    const { postponedWholesaleDocId, postponedDocType } = useCart.getState();
    const wholesaleDocId =
      postponedDocType === "wholesale" || postponedDocType == null
        ? postponedWholesaleDocId
        : null;
    const orderFromPartnerDocId =
      postponedDocType === "order_from_partner" && postponedWholesaleDocId != null
        ? postponedWholesaleDocId
        : null;

    const request: CheckoutRequest = {
      items: cartItems.map((i) => ({
        regos_item_id: i.regosItemId,
        qty: i.qty,
        price: i.price,
      })),
      discount: totals.discount,
      total: totals.total,
      description: `POS ${cashier.name}`,
      ...(wholesaleDocId ? { wholesale_doc_id: wholesaleDocId } : {}),
      ...(orderFromPartnerDocId
        ? { order_from_partner_doc_id: orderFromPartnerDocId }
        : {}),
      ...(payload.payments
        ? { payments: payload.payments }
        : {
            payment_type_id: payload.payment_type_id,
            amount_paid: payload.amount_paid,
            tendered: payload.tendered,
            change: payload.change,
          }),
      ...permittedOverrides(),
    };

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
      cashierId: cashier.id ?? null,
      cashierName: cashier.name ?? t("checkout.cashierFallback", "Cashier"),
      wholesaleDocId: postponedWholesaleDocId,
    };

    const stockAdjustments: StockAdjustOp[] = computeCheckoutStockAdjustments(
      cartItems,
      isBookedOrderFromPartnerContinuation(
        postponedDocType,
        postponedWholesaleDocId,
        postponeDocumentType,
        postponeOrderBooked,
      ),
    );

    let receiptContext: DocumentPrintContext;
    try {
      receiptContext = accessToken
        ? await loadPrintContextFromCartDraft(accessToken, draftInput)
        : buildPrintContextFromCartDraft(draftInput);
    } catch {
      receiptContext = buildPrintContextFromCartDraft(draftInput);
    }

    const effectiveRetryId = retryLocalId ?? activeRetryLocalId;
    const localId = effectiveRetryId ?? crypto.randomUUID();
    const record = {
      localId,
      scopeKey,
      kind: "checkout" as const,
      status: "pending" as const,
      companyId: user.company_id,
      userId: user.id,
      createdAt: Date.now(),
      lastAttemptAt: null,
      attemptCount: 0,
      errorMessage: null,
      errorCode: null,
      request,
      paymentPayload: payload,
      wholesaleDocId: postponedWholesaleDocId,
      postponedDocType,
      cartItems: [...cartItems],
      discountMode,
      discountValue,
      totals: { ...totals },
      sellContext: {
        warehouseId,
        priceTypeId: useSellContext.getState().priceTypeId,
        partnerId,
        saleCurrency,
      },
      cashier: { id: cashier.id, name: cashier.name },
      description: request.description ?? "",
      stockAdjustments,
      receiptContext,
    };

    try {
      if (effectiveRetryId || isCacheEnabled()) {
        if (effectiveRetryId) {
          if (cartItems.length === 0) {
            setActiveRetryLocalId(null);
            setCheckoutError(t("checkout.errors.failed", "Checkout failed"));
            return;
          }
          // Upsert so the retried sale is re-created even if the stored record
          // was removed in the meantime, instead of being silently dropped.
          await upsertPendingSale(record);
          setActiveRetryLocalId(null);
        } else {
          await enqueuePendingSale(record);
        }

        applyStockAdjustments(stockAdjustments, decrementStock, incrementStock);
        clearCart();
        clearActiveTabAfterCheckout();
        setCompletedContext(receiptContext);
        reset();
        onClose();
        onSuccess?.();
        enqueuePendingSaleSync(localId);
        return;
      }

      await checkoutSale(accessToken, request);
      applyStockAdjustments(stockAdjustments, decrementStock, incrementStock);
      clearCart();
      clearActiveTabAfterCheckout();
      setCompletedContext(receiptContext);
      reset();
      onClose();
      onSuccess?.();
    } catch (err: unknown) {
      if (!effectiveRetryId && !isCacheEnabled()) {
        const failedWholesaleDocId = extractWholesaleDocIdFromError(err);
        if (failedWholesaleDocId !== null) {
          setPostponedWholesaleDocId(failedWholesaleDocId);
          setPostponedDocType("wholesale");
        }
      }
      setCheckoutError(formatAuthError(err, t("checkout.errors.failed", "Checkout failed")));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={t("checkout.title", "Checkout")}
        overlayClassName={styles.checkoutOverlay}
        modalClassName={styles.checkoutModal}
        bodyClassName={styles.checkoutBody}
        headerActions={
          canPrintDocuments() ? (
          <button
            type="button"
            className={styles.headerPrintBtn}
            onClick={openDraftPrint}
            disabled={processing || draftPrintLoading || items.length === 0}
            aria-label={t("sales.printModalTitle", "Print sale")}
            title={t("sales.printModalTitle", "Print sale")}
          >
            <Printer size={18} />
          </button>
          ) : null
        }
      >
        <div className={styles.checkoutInner}>
          <div className={styles.checkoutScroll}>
            <div className={styles.totalLine}>
              <div className={styles.totalLabel}>{t("checkout.totalDue", "Total due")}</div>
              <div className={styles.totalValue}>
                {formatAmountWithCurrency(totals.total, saleCurrency)}
              </div>
            </div>

            {checkoutError && <div className={styles.statusError}>{checkoutError}</div>}

            <PaymentPanel
              mode="sale"
              total={totals.total}
              saleCurrency={saleCurrency}
              accessToken={accessToken}
              active={open}
              processing={processing}
              tenderedQuickAmounts={tenderedQuickAmounts}
              initialPaymentPayload={initialPaymentPayload}
              onConfirm={(payload) => void submitCheckout(payload)}
            />
          </div>
        </div>
      </Modal>

      {(draftPrintContext ?? completedContext) ? (
        <ReceiptModal
          context={(draftPrintContext ?? completedContext)!}
          title={draftPrintContext ? t("sales.printModalTitle", "Print sale") : undefined}
          closeLabel={draftPrintContext ? t("common.close", "Close") : undefined}
          onClose={() => {
            setDraftPrintContext(null);
            setCompletedContext(null);
          }}
        />
      ) : null}
    </>
  );
}
