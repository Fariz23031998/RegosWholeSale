import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { PendingSaleRecord } from "@/types/pending-sale";

const memory = new Map<string, PendingSaleRecord>();

function createMockDb(): IDBDatabase {
  return {
    transaction: () => {
      const tx = {
        objectStore: () => ({
          get: (key: string) => {
            const request = {
              result: memory.get(key),
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          put: (value: PendingSaleRecord) => {
            memory.set(value.localId, structuredClone(value));
            const request = {
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          delete: (key: string) => {
            memory.delete(key);
            const request = {
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          index: (indexName: string) => ({
            getAll: (key: string) => {
              const request = {
                result: [...memory.values()].filter((record) => {
                  if (indexName === "scopeKey") return record.scopeKey === key;
                  return true;
                }),
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
              };
              queueMicrotask(() => request.onsuccess?.());
              return request;
            },
          }),
        }),
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
    close: vi.fn(),
  } as unknown as IDBDatabase;
}

vi.mock("@/lib/pulse-pos-db", () => ({
  openPulsePosDb: vi.fn(async () => createMockDb()),
  PENDING_SALES_STORE: "pending-sales",
}));

vi.mock("@/lib/sales-api", () => ({
  checkoutSale: vi.fn(),
  postponeSale: vi.fn(),
}));

import { checkoutSale, postponeSale } from "@/lib/sales-api";
import { savePendingSale } from "@/lib/pending-sales-db";
import { useNotifications } from "@/store/notifications";
import { usePendingSales } from "@/store/pending-sales";
import {
  __configurePendingSaleSyncForTests,
  __processPendingSaleQueueForTests,
  __resetPendingSaleSyncForTests,
} from "@/lib/pending-sales-sync";

function sampleRecord(overrides: Partial<PendingSaleRecord> = {}): PendingSaleRecord {
  return {
    localId: overrides.localId ?? "sale-1",
    scopeKey: "1:2",
    kind: "checkout",
    status: "pending",
    companyId: 1,
    userId: 2,
    createdAt: 100,
    lastAttemptAt: null,
    attemptCount: 0,
    errorMessage: null,
    errorCode: null,
    request: {
      items: [{ regos_item_id: 1, qty: 1, price: 10 }],
      discount: 0,
      total: 10,
      payment_type_id: 1,
      amount_paid: 10,
    },
    cartItems: [],
    discountMode: "percent",
    discountValue: 0,
    totals: { subtotal: 10, discount: 0, total: 10 },
    sellContext: {
      warehouseId: null,
      priceTypeId: null,
      partnerId: null,
      saleCurrency: null,
    },
    cashier: { id: "c1", name: "Cashier" },
    description: "POS Cashier",
    ...overrides,
  };
}

describe("pending-sales-sync", () => {
  beforeEach(async () => {
    memory.clear();
    __resetPendingSaleSyncForTests();
    usePendingSales.getState().reset();
    useNotifications.getState().clear();
    await usePendingSales.getState().hydrate(2, 1);
  });

  afterEach(() => {
    vi.clearAllMocks();
    __resetPendingSaleSyncForTests();
    memory.clear();
  });

  it("deletes the record after a successful checkout sync", async () => {
    const record = sampleRecord();
    await savePendingSale(record);
    await usePendingSales.getState().hydrate(2, 1);

    vi.mocked(checkoutSale).mockResolvedValue({
      wholesale_doc_id: 99,
      wholesale_code: "W-99",
      payment_doc_id: 1,
      performed_at: "2026-01-01",
      lines: [],
      payment: {
        payment_type_id: 1,
        payment_doc_id: 1,
        amount: 10,
        amount_paid: 10,
        balance_due: 0,
        is_fully_paid: true,
      },
      subtotal: 10,
      discount: 0,
      total: 10,
      amount_paid: 10,
      balance_due: 0,
      is_fully_paid: true,
    });

    __configurePendingSaleSyncForTests("token", "1:2");
    await __processPendingSaleQueueForTests();

    expect(checkoutSale).toHaveBeenCalledWith("token", record.request);
    expect(usePendingSales.getState().records).toHaveLength(0);
  });

  it("marks failed sales and captures wholesale_doc_id from partial failures", async () => {
    const record = sampleRecord();
    await savePendingSale(record);
    await usePendingSales.getState().hydrate(2, 1);

    vi.mocked(checkoutSale).mockRejectedValue(
      new ApiError(500, "Checkout failed (wholesale_doc_id=55)"),
    );

    __configurePendingSaleSyncForTests("token", "1:2");
    await __processPendingSaleQueueForTests();

    const failed = usePendingSales.getState().records[0];
    expect(failed?.status).toBe("failed");
    expect(failed?.wholesaleDocId).toBe(55);
    expect(useNotifications.getState().unreadFailedIds.has("sale-1")).toBe(true);
  });

  it("processes syncable sales serially", async () => {
    const first = sampleRecord({ localId: "sale-1", createdAt: 100 });
    const second = sampleRecord({
      localId: "sale-2",
      createdAt: 200,
      kind: "postpone",
      request: {
        items: [{ regos_item_id: 2, qty: 1, price: 5 }],
        discount: 0,
        total: 5,
      },
    });
    await savePendingSale(first);
    await savePendingSale(second);
    await usePendingSales.getState().hydrate(2, 1);

    const order: string[] = [];
    vi.mocked(checkoutSale).mockImplementation(async () => {
      order.push("checkout");
      return {
        wholesale_doc_id: 1,
        wholesale_code: "W-1",
        payment_doc_id: 1,
        performed_at: "2026-01-01",
        lines: [],
        payment: {
          payment_type_id: 1,
          payment_doc_id: 1,
          amount: 10,
          amount_paid: 10,
          balance_due: 0,
          is_fully_paid: true,
        },
        subtotal: 10,
        discount: 0,
        total: 10,
        amount_paid: 10,
        balance_due: 0,
        is_fully_paid: true,
      };
    });
    vi.mocked(postponeSale).mockImplementation(async () => {
      order.push("postpone");
      return {
        wholesale_doc_id: 2,
        wholesale_code: "W-2",
        lines: [],
        subtotal: 5,
        discount: 0,
        total: 5,
      };
    });

    __configurePendingSaleSyncForTests("token", "1:2");
    await __processPendingSaleQueueForTests();

    expect(order).toEqual(["checkout", "postpone"]);
    expect(usePendingSales.getState().records).toHaveLength(0);
  });
});
