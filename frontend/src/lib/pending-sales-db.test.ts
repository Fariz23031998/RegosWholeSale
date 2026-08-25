import { afterEach, describe, expect, it, vi } from "vitest";
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
                  if (indexName === "status") return record.status === key;
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

import {
  deletePendingSale,
  getPendingSale,
  listPendingSales,
  listSyncable,
  savePendingSale,
  updatePendingSale,
} from "@/lib/pending-sales-db";

function sampleRecord(overrides: Partial<PendingSaleRecord> = {}): PendingSaleRecord {
  return {
    localId: "sale-1",
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
    request: { items: [], discount: 0, total: 10 },
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

describe("pending-sales-db", () => {
  afterEach(() => {
    memory.clear();
  });

  it("round-trips save, get, update, and delete", async () => {
    const record = sampleRecord();
    await savePendingSale(record);

    await expect(getPendingSale("sale-1")).resolves.toEqual(record);

    const updated = await updatePendingSale("sale-1", { status: "failed", errorMessage: "Oops" });
    expect(updated?.status).toBe("failed");
    expect(updated?.errorMessage).toBe("Oops");

    const listed = await listPendingSales("1:2");
    expect(listed).toHaveLength(1);

    await deletePendingSale("sale-1");
    await expect(getPendingSale("sale-1")).resolves.toBeNull();
  });

  it("lists syncable pending records in createdAt order", async () => {
    await savePendingSale(sampleRecord({ localId: "b", createdAt: 200, status: "failed" }));
    await savePendingSale(sampleRecord({ localId: "a", createdAt: 100, status: "pending" }));
    await savePendingSale(sampleRecord({ localId: "c", createdAt: 300, status: "syncing" }));

    const syncable = await listSyncable("1:2");
    expect(syncable.map((record) => record.localId)).toEqual(["a"]);
  });
});
