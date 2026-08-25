import type { PaymentSubmitPayload } from "@/components/Checkout/PaymentPanel";
import type { StockAdjustOp } from "@/lib/cart-stock";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import type {
  CheckoutRequest,
  CheckoutResponse,
  PostponeRequest,
  PostponeResponse,
} from "@/lib/sales-api";
import type { CartItem, DiscountMode, PostponedDocType } from "@/store/cart";
import type { RegosCurrencyOption } from "@/types/settings";

export type PendingSaleKind = "checkout" | "postpone";
export type PendingSaleStatus = "pending" | "syncing" | "failed";

export type PendingSaleRecord = {
  localId: string;
  scopeKey: string;
  kind: PendingSaleKind;
  status: PendingSaleStatus;
  companyId: number;
  userId: number;
  createdAt: number;
  lastAttemptAt: number | null;
  attemptCount: number;
  errorMessage: string | null;
  errorCode: string | null;

  request: CheckoutRequest | PostponeRequest;
  paymentPayload?: PaymentSubmitPayload;
  wholesaleDocId?: number | null;
  postponedDocType?: PostponedDocType;

  cartItems: CartItem[];
  discountMode: DiscountMode;
  discountValue: number;
  totals: { subtotal: number; discount: number; total: number };
  sellContext: {
    warehouseId: number | null;
    priceTypeId: number | null;
    partnerId: number | null;
    saleCurrency: RegosCurrencyOption | null;
  };
  cashier: { id: string; name: string };
  description: string;

  stockAdjustments?: StockAdjustOp[];

  receiptContext?: DocumentPrintContext;

  serverResponse?: CheckoutResponse | PostponeResponse;
};

export function buildPendingSalesScopeKey(
  companyId: number | null | undefined,
  userId: number | null | undefined,
): string | null {
  if (userId == null) return null;
  return `${companyId ?? 0}:${userId}`;
}
