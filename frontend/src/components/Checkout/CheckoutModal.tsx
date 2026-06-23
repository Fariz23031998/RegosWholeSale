import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Modal } from "@/components/posui/Modal";
import { useCart } from "@/store/cart";
import { formatAuthError, useAuth } from "@/store/auth";
import { useCatalog } from "@/store/catalog";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";
import { useCheckoutTabs } from "@/store/checkout-tabs";
import { formatAmountWithCurrency } from "@/lib/checkout-payments";
import { checkoutSale } from "@/lib/sales-api";
import type { CheckoutResponse } from "@/lib/sales-api";
import type { PaymentType } from "@/types/payment";
import type { RegosCurrencyOption } from "@/types/settings";
import type { Sale, SalePaymentLine } from "@/data/seed";
import { saleToPrintContext, type ReceiptPrintContext } from "@/lib/receipt-print-context";
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
  totals: Totals;
};

export function CheckoutModal({ open, onClose, totals }: Props) {
  const { t } = useLanguage();
  const items = useCart((s) => s.items);
  const clearCart = useCart((s) => s.clear);
  const clearActiveTabAfterCheckout = useCheckoutTabs(
    (s) => s.clearActiveTabAfterCheckout,
  );
  const cashier = useAuth((s) => s.cashier);
  const accessToken = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const canOverrideRegos = Boolean(user?.permissions.includes("pos.override_regos"));
  const checkoutOverrides = useSellContext((s) => s.checkoutOverrides);
  const saleCurrency = useSellContext((s) => s.saleCurrency);
  const partnerId = useSellContext((s) => s.partnerId);
  const partners = useSellContext((s) => s.options.partners);
  const postponedWholesaleDocId = useCart((s) => s.postponedWholesaleDocId);
  const requestCatalogRefresh = useCatalog((s) => s.requestRefresh);
  const tenderedQuickAmounts = usePosConfig((s) => s.tenderedQuickAmounts);

  const [processing, setProcessing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [completedContext, setCompletedContext] = useState<ReceiptPrintContext | null>(null);

  const reset = () => {
    setProcessing(false);
    setCheckoutError(null);
  };

  const handleClose = () => {
    if (processing) return;
    reset();
    onClose();
  };

  const buildSalePaymentLines = (
    result: CheckoutResponse,
    types: PaymentType[],
  ): SalePaymentLine[] =>
    (result.payments ?? []).map((payment) => {
      const type = types.find((t) => t.id === payment.payment_type_id);
      return {
        paymentTypeId: payment.payment_type_id,
        paymentTypeName: type?.name ?? t("checkout.paymentFallback", "Payment"),
        isCash: type?.is_cash ?? false,
        amountPaid: payment.amount_paid,
        paymentCurrency: payment.payment_currency ?? type?.currency ?? null,
        paymentAmount: payment.payment_amount ?? undefined,
      };
    });

  const buildSaleFromResponse = (
    paymentType: PaymentType,
    result: CheckoutResponse,
    payload: PaymentSubmitPayload,
  ): Sale => ({
    id: result.wholesale_code,
    createdAt: result.performed_at,
    cashierId: cashier?.id ?? "",
    cashierName: cashier?.name ?? t("checkout.cashierFallback", "Cashier"),
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
    tendered: payload.tendered,
    change: payload.change,
    amountPaid: result.amount_paid,
    balanceDue: result.balance_due,
    saleCurrency: result.payment.sale_currency ?? saleCurrency,
    paymentCurrency: result.payment.payment_currency ?? paymentType.currency ?? null,
    paymentAmount: result.payment.payment_amount ?? undefined,
  });

  const submitCheckout = async (payload: PaymentSubmitPayload) => {
    if (!accessToken || !cashier) return;

    const cartItems = items.filter((i) => i.regosItemId > 0);
    if (cartItems.length !== items.length) {
      setCheckoutError(t("checkout.missingRegosIds", "Some cart items are missing Regos product ids."));
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
        discount: totals.discount,
        total: totals.total,
        description: `POS ${cashier.name}`,
        ...(postponedWholesaleDocId
          ? { wholesale_doc_id: postponedWholesaleDocId }
          : {}),
        ...(payload.payments
          ? { payments: payload.payments }
          : {
              payment_type_id: payload.payment_type_id,
              amount_paid: payload.amount_paid,
              tendered: payload.tendered,
              change: payload.change,
            }),
        ...(canOverrideRegos ? checkoutOverrides() : {}),
      });

      const paymentTypeId = payload.payment_type_id ?? payload.payments?.[0]?.payment_type_id ?? 0;
      const paymentType: PaymentType = {
        id: paymentTypeId,
        name: result.payment.payment_type_id
          ? t("checkout.paymentFallback", "Payment")
          : t("checkout.paymentFallback", "Payment"),
        is_cash: false,
        allows_debt: false,
        image_url: "",
        currency: result.payment.payment_currency ?? null,
      };

      const sale: Sale = payload.payments
        ? {
            id: result.wholesale_code,
            createdAt: result.performed_at,
            cashierId: cashier?.id ?? "",
            cashierName: cashier?.name ?? t("checkout.cashierFallback", "Cashier"),
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
            paymentTypeId: result.payment.payment_type_id,
            paymentTypeName:
              (result.payments ?? []).length > 1
                ? (result.payments ?? [])
                    .map(() => t("checkout.paymentFallback", "Payment"))
                    .join(" + ")
                : t("checkout.paymentFallback", "Payment"),
            isCash: false,
            amountPaid: result.amount_paid,
            balanceDue: result.balance_due,
            saleCurrency: result.payment.sale_currency ?? saleCurrency,
            payments: buildSalePaymentLines(result, []),
          }
        : buildSaleFromResponse(paymentType, result, payload);

      const partnerName = partners.find((partner) => partner.id === partnerId)?.name ?? null;
      clearCart();
      clearActiveTabAfterCheckout();
      requestCatalogRefresh();
      setCompletedContext(
        saleToPrintContext(sale, {
          partner_name: partnerName,
          document_code: result.wholesale_code,
        }),
      );
      reset();
      onClose();
    } catch (err: unknown) {
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
              onConfirm={(payload) => void submitCheckout(payload)}
            />
          </div>
        </div>
      </Modal>

      <ReceiptModal
        context={completedContext}
        onClose={() => setCompletedContext(null)}
      />
    </>
  );
}
