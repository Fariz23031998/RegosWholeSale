import { formatAuthError } from "@/store/auth";
import { useNotifications } from "@/store/notifications";
import { usePendingSales } from "@/store/pending-sales";
import { extractWholesaleDocIdFromError } from "@/lib/checkout-error";
import { listPendingSales, listSyncable } from "@/lib/pending-sales-db";
import { checkoutSale, postponeSale } from "@/lib/sales-api";
import type {
  CheckoutRequest,
  PostponeRequest,
} from "@/lib/sales-api";
import type { PendingSaleRecord } from "@/types/pending-sale";
import { languageService } from "@/services/language";

const inFlight = new Set<string>();
let accessToken: string | null = null;
let scopeKey: string | null = null;
let processing = false;
let onlineListener: (() => void) | null = null;

function buildSyncRequest(record: PendingSaleRecord): CheckoutRequest | PostponeRequest {
  const base = { ...record.request };

  if (record.kind === "checkout") {
    const request = base as CheckoutRequest;
    if (record.wholesaleDocId != null) {
      if (record.postponedDocType === "order_from_partner") {
        request.order_from_partner_doc_id = record.wholesaleDocId;
        delete request.wholesale_doc_id;
      } else {
        request.wholesale_doc_id = record.wholesaleDocId;
        delete request.order_from_partner_doc_id;
      }
    }
    return request;
  }

  const request = base as PostponeRequest;
  if (record.wholesaleDocId != null) {
    request.wholesale_doc_id = record.wholesaleDocId;
  }
  return request;
}

async function syncRecord(record: PendingSaleRecord, token: string): Promise<void> {
  if (inFlight.has(record.localId)) return;
  inFlight.add(record.localId);

  const pendingSales = usePendingSales.getState();
  await pendingSales.markSyncing(record.localId);

  try {
    const request = buildSyncRequest(record);
    const response =
      record.kind === "checkout"
        ? await checkoutSale(token, request as CheckoutRequest)
        : await postponeSale(token, request as PostponeRequest);

    await pendingSales.remove(record.localId);
    useNotifications.getState().markRead(record.localId);
    void response;
  } catch (err: unknown) {
    const wholesaleDocId = extractWholesaleDocIdFromError(err);
    const patch: Partial<PendingSaleRecord> = {};
    if (wholesaleDocId !== null) {
      patch.wholesaleDocId = wholesaleDocId;
      if (record.kind === "checkout" && record.postponedDocType == null) {
        patch.postponedDocType = "wholesale";
      }
    }
    if (Object.keys(patch).length > 0) {
      await pendingSales.updateRecord(record.localId, patch);
    }

    const message = formatAuthError(
      err,
      languageService.t("notifications.syncFailed", "Sale sync failed"),
    );
    await pendingSales.markFailed(record.localId, message);
    useNotifications.getState().markUnread(record.localId);
  } finally {
    inFlight.delete(record.localId);
  }
}

async function requeueFailedSales(): Promise<void> {
  if (!scopeKey) return;
  const records = await listPendingSales(scopeKey);
  const pendingSales = usePendingSales.getState();
  for (const record of records) {
    if (record.status === "failed") {
      await pendingSales.markPending(record.localId);
    }
  }
}

async function processQueue(): Promise<void> {
  if (processing || !accessToken || !scopeKey) return;
  processing = true;

  try {
    while (accessToken && scopeKey) {
      const syncable = await listSyncable(scopeKey);
      const next = syncable.find(
        (record) => record.status === "pending" && !inFlight.has(record.localId),
      );
      if (!next) break;
      await syncRecord(next, accessToken);
    }
  } finally {
    processing = false;
  }
}

export function startPendingSaleSync(token: string): void {
  accessToken = token;
  scopeKey = usePendingSales.getState().scopeKey;

  if (!onlineListener && typeof window !== "undefined") {
    const onOnline = () => {
      void requeueFailedSales().then(() => processQueue());
    };
    window.addEventListener("online", onOnline);
    onlineListener = () => window.removeEventListener("online", onOnline);
  }

  void requeueFailedSales().then(() => processQueue());
}

/** @internal Test helper */
export function __configurePendingSaleSyncForTests(token: string, key: string): void {
  accessToken = token;
  scopeKey = key;
}

export function stopPendingSaleSync(): void {
  accessToken = null;
  scopeKey = null;
  onlineListener?.();
  onlineListener = null;
}

export function enqueuePendingSaleSync(localId?: string): void {
  if (localId) {
    inFlight.delete(localId);
  }
  void processQueue();
}

export async function retryPendingSaleSync(localId: string): Promise<void> {
  await usePendingSales.getState().markPending(localId);
  enqueuePendingSaleSync(localId);
}

/** @internal Test helper */
export function __resetPendingSaleSyncForTests(): void {
  inFlight.clear();
  accessToken = null;
  scopeKey = null;
  processing = false;
  onlineListener?.();
  onlineListener = null;
}

/** @internal Test helper */
export { processQueue as __processPendingSaleQueueForTests };
