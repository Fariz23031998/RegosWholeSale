import { getApiBaseUrl } from "@/lib/api";
import {
  invalidateGroups,
  removeProducts,
  upsertProducts,
} from "./catalog-products-db";
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
import { updateProductPriceOnly } from "@/lib/catalog-events/updateProductPriceOnly/updateProductPriceOnly";
import { updateProductStockOnly } from "@/lib/catalog-events/updateProductStockOnly/updateProductStockOnly";
import { updateProductInfoOnly } from "@/lib/catalog-events/updateProductInfoOnly/updateProductInfoOnly";
import { loadCachedProductIdsByScope } from "@/lib/catalog-products-db/loadCachedProductIdsByScope/loadCachedProductIdsByScope";
import { fetchAllPartners, fetchPartnerGroups } from "@/lib/partners-api";
import { saveCachedPartners, saveCachedPartnerGroups } from "@/lib/partners-db";


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

/** Age after which a quiet SSE stream is treated as stale for resume gap-fill. */
export const CATALOG_SSE_STALE_MS = 60_000;

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

function parseCatalogEvent(data: string): CatalogEventMessage | "heartbeat" | null {
  try {
    const parsed = JSON.parse(data) as { type?: string };
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
    if (parsed.type === "heartbeat") return "heartbeat";
    return parsed as CatalogEventMessage;
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

export async function handleCatalogEvent(
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
      if (event.kinds.includes("partner")) {
        const [allPartners, groupsResponse] = await Promise.all([
          fetchAllPartners(token),
          fetchPartnerGroups(token),
        ]);
        await Promise.all([
          saveCachedPartners(context.companyId, allPartners).catch(() => undefined),
          saveCachedPartnerGroups(context.companyId, groupsResponse.groups).catch(() => undefined),
        ]);
      }
      notifyReferenceOptionsEventListeners(event);
      handlers.onReferenceOptionsInvalidated(event.kinds);
    } catch {
      // ignore reference options refresh failures
    }
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

  const priceOnlyEvents = new Set(["DocSetPricePerformCanceled", "DocSetPricePerformed"]);
  const stockOnlyEvents = new Set([
    "DocChequeClosed",
    "DocInOutPerformCanceled",
    "DocInOutPerformed",
    "DocMovementPerformCanceled",
    "DocMovementPerformed",
    "DocReturnsToPartnerPerformCanceled",
    "DocReturnsToPartnerPerformed",
    "DocWholeSalePerformCanceled",
    "DocWholeSalePerformed",
    "DocWholeSaleReturnPerformCanceled",
    "DocWholeSaleReturnPerformed",
  ]);
  // Purchase can change stock at the document warehouse and prices for all warehouses.
  const stockAndPriceEvents = new Set([
    "DocPurchasePerformCanceled",
    "DocPurchasePerformed",
  ]);
  const productInfoEvents = new Set([
    "ItemAdded",
    "ItemDeleted",
    "ItemDeleteMarked",
    "ItemEdited",
    "ItemGroupAdded",
    "ItemGroupDeleted",
    "ItemGroupEdited",
  ]);

  if (event.type === "groups_invalidated") {
    await invalidateGroups(context.companyId).catch(() => undefined);
    handlers.onGroupsInvalidated?.();
    if (productInfoEvents.has(event.source_action) && handlers.onProductsUpdated) {
      const cachedIds = await loadCachedProductIdsByScope(activeScopeKey).catch(() => []);
      if (cachedIds.length > 0) {
        const itemIds = cachedIds.map((id) => Number(id)).filter((id) => !isNaN(id));
        await updateProductInfoOnly(
          token,
          itemIds,
          activeScopeKey,
          handlers.onProductsUpdated,
        ).catch(() => undefined);
      }
    }
    return;
  }

  if (event.type === "products_removed") {
    if (productInfoEvents.has(event.source_action)) {
      if (handlers.onProductsUpdated) {
        await updateProductInfoOnly(
          token,
          event.regos_item_ids,
          activeScopeKey,
          handlers.onProductsUpdated,
        ).catch(() => undefined);
      }
      return;
    }
    const productIds = regosItemIdsToProductIds(event.regos_item_ids);
    await removeProducts(activeScopeKey, productIds).catch(() => undefined);
    handlers.onProductsRemoved?.(productIds);
    return;
  }

  if (event.type === "products_updated") {
    if (!handlers.onProductsUpdated) return;

    const action = event.source_action;
    const eventStockId = event.stock_id;
    const activeWarehouseId = context.canChangeWarehouse ? context.warehouseId ?? null : null;
    const shouldPatchActiveView =
      eventStockId == null ||
      activeWarehouseId == null ||
      eventStockId === activeWarehouseId;

    if (priceOnlyEvents.has(action)) {
      if (shouldPatchActiveView) {
        await updateProductPriceOnly(
          token,
          event.regos_item_ids,
          activeScopeKey,
          fetchQuery,
          handlers.onProductsUpdated,
        ).catch(() => undefined);
      }
      return;
    }

    if (stockOnlyEvents.has(action)) {
      // Warm the document-warehouse cache when it differs from the active view.
      if (
        eventStockId != null &&
        activeWarehouseId != null &&
        eventStockId !== activeWarehouseId
      ) {
        const eventScopeKey = buildCatalogScopeKey(
          context.companyId,
          eventStockId,
          fetchQuery.priceTypeId,
        );
        await updateProductStockOnly(
          token,
          event.regos_item_ids,
          eventScopeKey,
          {
            warehouseId: eventStockId,
            priceTypeId: fetchQuery.priceTypeId,
          },
        ).catch(() => undefined);
      }

      if (shouldPatchActiveView) {
        await updateProductStockOnly(
          token,
          event.regos_item_ids,
          activeScopeKey,
          fetchQuery,
          handlers.onProductsUpdated,
        ).catch(() => undefined);
      }
      return;
    }

    if (productInfoEvents.has(action)) {
      if (shouldPatchActiveView) {
        await updateProductInfoOnly(
          token,
          event.regos_item_ids,
          activeScopeKey,
          handlers.onProductsUpdated,
        ).catch(() => undefined);
      }
      return;
    }

    if (stockAndPriceEvents.has(action)) {
      // Warm the document-warehouse cache when it differs from the active view.
      if (
        eventStockId != null &&
        activeWarehouseId != null &&
        eventStockId !== activeWarehouseId
      ) {
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

      // Always refresh the active view so price changes are visible on any warehouse.
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
      return;
    }

    // Warm a non-active warehouse cache without duplicating the active-view fetch.
    if (
      eventStockId != null &&
      activeWarehouseId != null &&
      eventStockId !== activeWarehouseId
    ) {
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
}

const MAX_SIGNATURES = 100;

function getEventSignature(event: CatalogEventMessage): string {
  const ids = "regos_item_ids" in event ? event.regos_item_ids.join(",") : "";
  const stock = "stock_id" in event ? event.stock_id ?? "" : "";
  const kinds = "kinds" in event ? event.kinds.join(",") : "";
  const paymentTypeIds = "payment_type_ids" in event ? event.payment_type_ids.join(",") : "";
  return `${event.type}:${event.source_action}:${ids}:${stock}:${kinds}:${paymentTypeIds}:${event.occurred_at}`;
}

interface ConnectionInfo {
  token: string;
  context: CatalogEventContext;
  handlers: CatalogEventHandlers;
}

type CatalogReconnectListener = () => void;

interface GlobalSSEState {
  sharedSource: EventSource | null;
  sharedToken: string | null;
  sharedChannel: BroadcastChannel | null;
  activeConnections: Set<ConnectionInfo>;
  processedEventSignatures: Set<string>;
  lastEventAt: number | null;
  wasDisconnected: boolean;
  everOpened: boolean;
  reconnectListeners: Set<CatalogReconnectListener>;
}

const getGlobalSseState = (): GlobalSSEState => {
  const empty = (): GlobalSSEState => ({
    sharedSource: null,
    sharedToken: null,
    sharedChannel: null,
    activeConnections: new Set<ConnectionInfo>(),
    processedEventSignatures: new Set<string>(),
    lastEventAt: null,
    wasDisconnected: false,
    everOpened: false,
    reconnectListeners: new Set<CatalogReconnectListener>(),
  });

  if (typeof window === "undefined") {
    const glob = global as any;
    if (!glob.__pulse_pos_sse_global__) {
      glob.__pulse_pos_sse_global__ = empty();
    }
    return glob.__pulse_pos_sse_global__;
  }
  const win = window as any;
  if (!win.__pulse_pos_sse_global__) {
    win.__pulse_pos_sse_global__ = empty();
  }
  return win.__pulse_pos_sse_global__;
};

function markCatalogEventReceived(): void {
  getGlobalSseState().lastEventAt = Date.now();
}

function notifyCatalogReconnectListeners(): void {
  const state = getGlobalSseState();
  for (const listener of state.reconnectListeners) {
    try {
      listener();
    } catch {
      // ignore listener failures
    }
  }
}

export function isCatalogEventsConnected(): boolean {
  const source = getGlobalSseState().sharedSource;
  return source != null && source.readyState === EventSource.OPEN;
}

export function getCatalogEventsLastEventAt(): number | null {
  return getGlobalSseState().lastEventAt;
}

/** True when SSE is down or has been quiet long enough that resume should force gap-fill. */
export function shouldForceCatalogGapFill(staleMs = CATALOG_SSE_STALE_MS): boolean {
  const state = getGlobalSseState();
  if (!isCatalogEventsConnected()) return true;
  if (state.lastEventAt == null) return true;
  return Date.now() - state.lastEventAt > staleMs;
}

export function subscribeCatalogEventsReconnect(listener: CatalogReconnectListener): () => void {
  const state = getGlobalSseState();
  state.reconnectListeners.add(listener);
  return () => {
    state.reconnectListeners.delete(listener);
  };
}

function isDuplicateEvent(event: CatalogEventMessage): boolean {
  const signature = getEventSignature(event);
  const state = getGlobalSseState();
  if (state.processedEventSignatures.has(signature)) {
    return true;
  }
  state.processedEventSignatures.add(signature);
  if (state.processedEventSignatures.size > MAX_SIGNATURES) {
    const firstKey = state.processedEventSignatures.values().next().value;
    if (firstKey !== undefined) {
      state.processedEventSignatures.delete(firstKey);
    }
  }
  return false;
}

function handleIncomingEvent(event: CatalogEventMessage) {
  const state = getGlobalSseState();
  for (const conn of state.activeConnections) {
    void handleCatalogEvent(conn.token, event, conn.context, conn.handlers).catch(() => undefined);
  }
}

function attachSharedCatalogSource(token: string): void {
  const state = getGlobalSseState();
  if (state.sharedSource && state.sharedToken === token) return;

  if (state.sharedSource) {
    state.sharedSource.close();
    state.sharedSource = null;
    state.wasDisconnected = true;
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/v1/regos/catalog-events?access_token=${encodeURIComponent(token)}`;
  const source = new EventSource(url);
  state.sharedSource = source;
  state.sharedToken = token;

  const onMessage = (messageEvent: MessageEvent<string>) => {
    const event = parseCatalogEvent(messageEvent.data);
    if (!event) return;
    markCatalogEventReceived();
    if (event === "heartbeat") return;
    if (isDuplicateEvent(event)) return;
    broadcastCatalogEvent(event);
    handleIncomingEvent(event);
  };

  source.addEventListener("message", onMessage as EventListener);

  source.onopen = () => {
    const current = getGlobalSseState();
    const shouldGapFill = current.wasDisconnected;
    current.wasDisconnected = false;
    current.everOpened = true;
    markCatalogEventReceived();
    if (shouldGapFill) {
      notifyCatalogReconnectListeners();
    }
  };

  source.onerror = () => {
    const current = getGlobalSseState();
    current.wasDisconnected = true;
  };
}

function ensureSharedCatalogChannel(): void {
  const state = getGlobalSseState();
  if (state.sharedChannel || typeof BroadcastChannel === "undefined") return;

  const channel = new BroadcastChannel(CATALOG_EVENTS_CHANNEL);
  state.sharedChannel = channel;
  channel.onmessage = (message) => {
    const payload = message.data as { sourceId?: string; event?: CatalogEventMessage };
    if (payload?.sourceId === catalogEventsSourceId) return;
    const event = payload?.event;
    if (!event || typeof event !== "object" || !("type" in event)) return;
    if (event.type === "heartbeat") return;
    if (isDuplicateEvent(event)) return;
    markCatalogEventReceived();
    handleIncomingEvent(event);
  };
}

export function connectCatalogEvents(
  token: string,
  context: CatalogEventContext,
  handlers: CatalogEventHandlers,
): CatalogEventConnection {
  const connection: ConnectionInfo = { token, context, handlers };
  const state = getGlobalSseState();
  state.activeConnections.add(connection);

  attachSharedCatalogSource(token);
  ensureSharedCatalogChannel();

  return {
    close: () => {
      const currentState = getGlobalSseState();
      currentState.activeConnections.delete(connection);
      if (currentState.activeConnections.size === 0) {
        if (currentState.sharedSource) {
          currentState.sharedSource.close();
          currentState.sharedSource = null;
        }
        currentState.sharedToken = null;
        currentState.wasDisconnected = false;
        currentState.everOpened = false;
        if (currentState.sharedChannel) {
          currentState.sharedChannel.close();
          currentState.sharedChannel = null;
        }
      }
    },
  };
}

