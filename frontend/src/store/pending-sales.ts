import { create } from "zustand";
import type { PaymentSubmitPayload } from "@/components/Checkout/PaymentPanel";
import {
  deletePendingSale,
  listPendingSales,
  savePendingSale,
  updatePendingSale,
} from "@/lib/pending-sales-db";
import {
  buildPendingSalesScopeKey,
  type PendingSaleRecord,
} from "@/types/pending-sale";

const PENDING_SALES_CHANNEL = "pulse-pos-pending-sales";

const crossWindowSourceId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now());

let crossWindowUnsubscribe: (() => void) | null = null;

export type CheckoutRestoreRequest = {
  localId: string;
  totals: { subtotal: number; discount: number; total: number };
  initialPaymentPayload: PaymentSubmitPayload;
};

type PendingSalesState = {
  scopeKey: string | null;
  hydrated: boolean;
  records: PendingSaleRecord[];
  activeRetryLocalId: string | null;
  checkoutRestoreRequest: CheckoutRestoreRequest | null;
  hydrate: (userId: number | null, companyId: number | null) => Promise<void>;
  reset: () => void;
  enqueue: (record: PendingSaleRecord) => Promise<void>;
  updateRecord: (localId: string, patch: Partial<PendingSaleRecord>) => Promise<PendingSaleRecord | null>;
  upsertRecord: (record: PendingSaleRecord) => Promise<void>;
  markSyncing: (localId: string) => Promise<void>;
  markFailed: (localId: string, errorMessage: string, errorCode?: string | null) => Promise<void>;
  markPending: (localId: string) => Promise<void>;
  remove: (localId: string) => Promise<void>;
  setActiveRetryLocalId: (localId: string | null) => void;
  requestCheckoutRestore: (request: CheckoutRestoreRequest) => void;
  clearCheckoutRestore: () => void;
  failedRecords: () => PendingSaleRecord[];
  failedCount: () => number;
};

function broadcastPendingSalesUpdate(scopeKey: string) {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(PENDING_SALES_CHANNEL);
    channel.postMessage({ scopeKey, sourceId: crossWindowSourceId });
    channel.close();
  } catch {
    // Ignore broadcast failures; IndexedDB remains the source of truth.
  }
}

function sortRecords(records: PendingSaleRecord[]): PendingSaleRecord[] {
  return [...records].sort((a, b) => a.createdAt - b.createdAt);
}

function replaceRecord(
  records: PendingSaleRecord[],
  next: PendingSaleRecord,
): PendingSaleRecord[] {
  const index = records.findIndex((record) => record.localId === next.localId);
  if (index < 0) return sortRecords([...records, next]);
  const copy = [...records];
  copy[index] = next;
  return sortRecords(copy);
}

async function reloadPendingSalesFromStorage(get: () => PendingSalesState) {
  const { scopeKey, hydrated } = get();
  if (!hydrated || !scopeKey) return;

  try {
    const stored = await listPendingSales(scopeKey);
    usePendingSales.setState({ records: stored });
  } catch {
    // Ignore reload errors; in-memory state remains available.
  }
}

function ensureCrossWindowSync(get: () => PendingSalesState) {
  if (crossWindowUnsubscribe || typeof BroadcastChannel === "undefined") return;

  const channel = new BroadcastChannel(PENDING_SALES_CHANNEL);
  channel.onmessage = (event) => {
    const { scopeKey, hydrated } = get();
    if (!hydrated || !scopeKey) return;
    if (event.data?.sourceId === crossWindowSourceId) return;
    if (event.data?.scopeKey !== scopeKey) return;
    void reloadPendingSalesFromStorage(get);
  };
  crossWindowUnsubscribe = () => {
    channel.close();
    crossWindowUnsubscribe = null;
  };
}

export const usePendingSales = create<PendingSalesState>((set, get) => ({
  scopeKey: null,
  hydrated: false,
  records: [],
  activeRetryLocalId: null,
  checkoutRestoreRequest: null,

  hydrate: async (userId, companyId) => {
    const scopeKey = buildPendingSalesScopeKey(companyId, userId);
    if (!scopeKey) {
      set({
        scopeKey: null,
        hydrated: true,
        records: [],
      });
      ensureCrossWindowSync(get);
      return;
    }

    set({ hydrated: false, scopeKey });

    try {
      const stored = await listPendingSales(scopeKey);
      set({ records: stored, hydrated: true });
    } catch {
      set({ records: [], hydrated: true });
    }

    ensureCrossWindowSync(get);
  },

  reset: () => {
    crossWindowUnsubscribe?.();
    crossWindowUnsubscribe = null;
    set({
      scopeKey: null,
      hydrated: false,
      records: [],
      activeRetryLocalId: null,
      checkoutRestoreRequest: null,
    });
  },

  enqueue: async (record) => {
    await savePendingSale(record);
    set((state) => ({ records: sortRecords([...state.records, record]) }));
    const { scopeKey } = get();
    if (scopeKey) broadcastPendingSalesUpdate(scopeKey);
  },

  updateRecord: async (localId, patch) => {
    const updated = await updatePendingSale(localId, patch);
    if (!updated) return null;
    set((state) => ({ records: replaceRecord(state.records, updated) }));
    const { scopeKey } = get();
    if (scopeKey) broadcastPendingSalesUpdate(scopeKey);
    return updated;
  },

  upsertRecord: async (record) => {
    await savePendingSale(record);
    set((state) => ({ records: replaceRecord(state.records, record) }));
    const { scopeKey } = get();
    if (scopeKey) broadcastPendingSalesUpdate(scopeKey);
  },

  markSyncing: async (localId) => {
    await get().updateRecord(localId, { status: "syncing", lastAttemptAt: Date.now() });
  },

  markFailed: async (localId, errorMessage, errorCode = null) => {
    const record = get().records.find((entry) => entry.localId === localId);
    await get().updateRecord(localId, {
      status: "failed",
      errorMessage,
      errorCode,
      attemptCount: (record?.attemptCount ?? 0) + 1,
      lastAttemptAt: Date.now(),
    });
  },

  markPending: async (localId) => {
    await get().updateRecord(localId, {
      status: "pending",
      errorMessage: null,
      errorCode: null,
    });
  },

  remove: async (localId) => {
    await deletePendingSale(localId);
    set((state) => ({
      records: state.records.filter((record) => record.localId !== localId),
      activeRetryLocalId:
        state.activeRetryLocalId === localId ? null : state.activeRetryLocalId,
    }));
    const { scopeKey } = get();
    if (scopeKey) broadcastPendingSalesUpdate(scopeKey);
  },

  setActiveRetryLocalId: (localId) => set({ activeRetryLocalId: localId }),

  requestCheckoutRestore: (request) => set({ checkoutRestoreRequest: request }),

  clearCheckoutRestore: () => set({ checkoutRestoreRequest: null }),

  failedRecords: () => get().records.filter((record) => record.status === "failed"),

  failedCount: () => get().failedRecords().length,
}));
