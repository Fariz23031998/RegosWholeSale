import { isBookedOrderFromPartnerContinuation } from "@/lib/cart-stock";
import { useCart } from "@/store/cart";
import { usePosConfig } from "@/store/pos-config";

export function useBookedOrderContinuation(): boolean {
  const postponeDocumentType = usePosConfig((state) => state.postponeDocumentType);
  const postponeOrderBooked = usePosConfig((state) => state.postponeOrderBooked);
  const postponedDocType = useCart((state) => state.postponedDocType);
  const postponedWholesaleDocId = useCart((state) => state.postponedWholesaleDocId);

  return isBookedOrderFromPartnerContinuation(
    postponedDocType,
    postponedWholesaleDocId,
    postponeDocumentType,
    postponeOrderBooked,
  );
}
