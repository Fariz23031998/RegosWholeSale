import { getApiBaseUrl } from "@/lib/api";
import {
  invalidateGroups,
  removeProducts,
  upsertProducts,
} from "@/lib/catalog-products-db";
import { refreshProductsByIds } from "@/lib/catalog-service";
import { fetchProductsByIds } from "@/lib/catalog-api";
import {
  fetchPaymentTypes,
  patchPaymentTypesInMemory,
  removePaymentTypesFromMemory,
  setCachedPaymentTypes,
} from "@/lib/payment-api";
import {
  fetchRegosReferenceOptions,
  patchReferenceOptionsInMemory,
} from "@/lib/settings-api";
import {
  loadCachedPaymentTypes,
  removePaymentTypes,
  saveCachedPaymentTypes,
} from "@/lib/payment-types-db";
import { patchCachedReferenceOptions } from "@/lib/reference-options-db";
import { buildCatalogScopeKey } from "@/lib/pulse-pos-db";
import type { Product } from "@/types/catalog";
import type { PaymentType } from "@/types/payment";

export const CATALOG_EVENTS_CHANNEL = "pulse-pos-catalog-events";

const catalogEventsSourceId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now());

export type ReferenceOptionKind = "warehouse" | "price_type" | "partner";

export type CatalogEventMessage =
  | {
      type: "products_updated";
      regos_item_ids: number[];
      stock_id?: number;
      source_action: string;
      occurred_at: string;
    }
  | {
      type: "products_removed";
      regos_item_ids: number[];
      source_action: string;
      occurred_at: string;
    }
  | {
      type: "groups_invalidated";
      source_action: string;
      occurred_at: string;
    }
  | {
      type: "payment_types_updated";
      payment_type_ids: number[];
      source_action: string;
      occurred_at: string;
    }
  | {
      type: "payment_types_removed";
      payment_type_ids: number[];
      source_action: string;
      occurred_at: string;
    }
  | {
      type: "reference_options_invalidated";
      kinds: ReferenceOptionKind[];
      source_action: string;
      occurred_at: string;
    };

export type ReferenceOptionsInvalidatedEvent = Extract<
  CatalogEventMessage,
  { type: "reference_options_invalidated" }
>;

type ReferenceOptionsEventListener = (event: ReferenceOptionsInvalidatedEvent) => void;

const referenceOptionsEventListeners = new Set<ReferenceOptionsEventListener>();

export function subscribeReferenceOptionsEvents(
  listener: ReferenceOptionsEventListener,
): () => void {
  referenceOptionsEventListeners.add(listener);
  return () => {
    referenceOptionsEventListeners.delete(listener);
  };
}

function notifyReferenceOptionsEventListeners(event: ReferenceOptionsInvalidatedEvent): void {
  for (const listener of referenceOptionsEventListeners) {
    try {
      listener(event);
    } catch {
      // ignore listener failures
    }
  }
}

export type CatalogEventHandlers = {
  onProductsUpdated?: (products: Product[]) => void;
  onProductsRemoved?: (productIds: string[]) => void;
  onGroupsInvalidated?: () => void;
  onPaymentTypesUpdated?: (paymentTypes: PaymentType[]) => void;
  onPaymentTypesRemoved?: (paymentTypeIds: number[]) => void;
  onReferenceOptionsInvalidated?: (kinds: ReferenceOptionKind[]) => void;
};

export type CatalogEventConnection = {
  close: () => void;
};

type CatalogEventContext = {
  companyId: number;
  warehouseId?: number | null;
  priceTypeId?: number | null;
  canChangeWarehouse?: boolean;
  canChangePriceType?: boolean;
};

function parseCatalogEvent(data: string): CatalogEventMessage | null {
  try {
    const parsed = JSON.parse(data) as CatalogEventMessage;
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function broadcastCatalogEvent(event: CatalogEventMessage): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CATALOG_EVENTS_CHANNEL);
    channel.postMessage({ sourceId: catalogEventsSourceId, event });
    channel.close();
  } catch {
    // ignore cross-tab sync failures
  }
}

function regosItemIdsToProductIds(regosItemIds: number[]): string[] {
  return regosItemIds.map((id) => String(id));
}

async function handleCatalogEvent(
  token: string,
  event: CatalogEventMessage,
  context: CatalogEventContext,
  handlers: CatalogEventHandlers,
): Promise<void> {
  if (event.type === "reference_options_invalidated") {
    if (!handlers.onReferenceOptionsInvalidated) return;
    try {
      const fresh = await fetchRegosReferenceOptions(token, {
        force: true,
        cacheScope: { companyId: context.companyId },
      });
      await patchCachedReferenceOptions(context.companyId, {
        warehouses: fresh.warehouses,
        price_types: fresh.price_types,
        partners: fresh.partners,
      }).catch(() => undefined);
      patchReferenceOptionsInMemory(token, {
        warehouses: fresh.warehouses,
        price_types: fresh.price_types,
        partners: fresh.partners,
      });
      notifyReferenceOptionsEventListeners(event);
      handlers.onReferenceOptionsInvalidated(event.kinds);
    } catch {
      // ignore reference options refresh failures
    }
    return;
  }

  if (event.type === "groups_invalidated") {
    await invalidateGroups(context.companyId).catch(() => undefined);
    handlers.onGroupsInvalidated?.();
    return;
  }

  if (event.type === "payment_types_removed") {
    await removePaymentTypes(context.companyId, event.payment_type_ids).catch(() => undefined);
    removePaymentTypesFromMemory(token, event.payment_type_ids);
    const cached = await loadCachedPaymentTypes(context.companyId).catch(() => null);
    if (cached) {
      setCachedPaymentTypes(token, { payment_types: cached.payment_types });
      handlers.onPaymentTypesRemoved?.(event.payment_type_ids);
      return;
    }
    handlers.onPaymentTypesRemoved?.(event.payment_type_ids);
    return;
  }

  if (event.type === "payment_types_updated") {
    try {
      const fresh = await fetchPaymentTypes(token, { force: true });
      await saveCachedPaymentTypes(context.companyId, fresh.payment_types).catch(() => undefined);
      patchPaymentTypesInMemory(token, fresh.payment_types);
      handlers.onPaymentTypesUpdated?.(fresh.payment_types);
    } catch {
      // ignore payment type refresh failures
    }
    return;
  }

  const fetchQuery = {
    warehouseId: context.canChangeWarehouse ? context.warehouseId ?? undefined : undefined,
    priceTypeId: context.canChangePriceType ? context.priceTypeId ?? undefined : undefined,
  };
  const activeScope = {
    companyId: context.companyId,
    warehouseId: fetchQuery.warehouseId,
    priceTypeId: fetchQuery.priceTypeId,
  };
  const activeScopeKey = buildCatalogScopeKey(
    context.companyId,
    fetchQuery.warehouseId,
    fetchQuery.priceTypeId,
  );

  if (event.type === "products_removed") {
    const productIds = regosItemIdsToProductIds(event.regos_item_ids);
    await removeProducts(activeScopeKey, productIds).catch(() => undefined);
    handlers.onProductsRemoved?.(productIds);
    return;
  }

  const eventStockId = event.stock_id;
  const activeWarehouseId = context.canChangeWarehouse ? context.warehouseId ?? null : null;
  const shouldPatchActiveView =
    eventStockId == null ||
    activeWarehouseId == null ||
    eventStockId === activeWarehouseId;

  if (eventStockId != null) {
    const eventScope = {
      companyId: context.companyId,
      warehouseId: eventStockId,
      priceTypeId: fetchQuery.priceTypeId,
    };
    await refreshProductsByIds(token, event.regos_item_ids, eventScope, {
      warehouseId: eventStockId,
      priceTypeId: fetchQuery.priceTypeId,
    }).catch(() => undefined);
  }

  if (!shouldPatchActiveView) return;

  try {
    const fresh = await fetchProductsByIds(token, event.regos_item_ids, fetchQuery);
    await upsertProducts(activeScopeKey, fresh.products).catch(() => undefined);
    handlers.onProductsUpdated?.(fresh.products);
  } catch {
    const cached = await refreshProductsByIds(
      token,
      event.regos_item_ids,
      activeScope,
      fetchQuery,
    ).catch(() => null);
    if (cached) {
      handlers.onProductsUpdated?.(cached.products);
    }
  }
}

export function connectCatalogEvents(
  token: string,
  context: CatalogEventContext,
  handlers: CatalogEventHandlers,
): CatalogEventConnection {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/v1/regos/catalog-events?access_token=${encodeURIComponent(token)}`;
  const source = new EventSource(url);

  const onMessage = (messageEvent: MessageEvent<string>) => {
    const event = parseCatalogEvent(messageEvent.data);
    if (!event) return;
    broadcastCatalogEvent(event);
    void handleCatalogEvent(token, event, context, handlers).catch(() => undefined);
  };

  source.addEventListener("message", onMessage as EventListener);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CATALOG_EVENTS_CHANNEL);
    channel.onmessage = (message) => {
      const payload = message.data as { sourceId?: string; event?: CatalogEventMessage };
      if (payload?.sourceId === catalogEventsSourceId) return;
      const event = payload?.event;
      if (!event || typeof event !== "object" || !("type" in event)) return;
      void handleCatalogEvent(token, event, context, handlers).catch(() => undefined);
    };
  }

  return {
    close: () => {
      source.removeEventListener("message", onMessage as EventListener);
      source.close();
      channel?.close();
    },
  };
}
