import { useCart } from "@/store/cart";
import { useSellContext } from "@/store/sell-context";
import type { PendingSaleRecord } from "@/types/pending-sale";

export function restorePendingSaleSnapshot(record: PendingSaleRecord): void {
  useCart.getState().restore({
    items: record.cartItems,
    discountMode: record.discountMode,
    discountValue: record.discountValue,
    postponedWholesaleDocId: record.wholesaleDocId ?? null,
    postponedDocType: record.postponedDocType ?? null,
  });

  const sellContext = useSellContext.getState();
  sellContext.setWarehouseId(record.sellContext.warehouseId);
  sellContext.setPriceTypeId(record.sellContext.priceTypeId);
  sellContext.setPartnerId(record.sellContext.partnerId);
}
