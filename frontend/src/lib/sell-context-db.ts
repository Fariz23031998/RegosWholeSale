import type { RegosReferenceOptionsResponse } from "@/types/settings";
import { openPulsePosDb, SELL_CONTEXT_STORE } from "@/lib/pulse-pos-db";

const STORE_NAME = SELL_CONTEXT_STORE;

export type SellContextRecord = {
  warehouseId: number | null;
  priceTypeId: number | null;
  partnerId: number | null;
};

function normalizeId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return null;
}

export function normalizeSellContextRecord(value: unknown): SellContextRecord | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Partial<SellContextRecord>;
  return {
    warehouseId: normalizeId(record.warehouseId),
    priceTypeId: normalizeId(record.priceTypeId),
    partnerId: normalizeId(record.partnerId),
  };
}

export function validateSellContextRecord(
  record: SellContextRecord,
  options: RegosReferenceOptionsResponse,
  canOverride: boolean,
): SellContextRecord {
  if (!canOverride) return record;

  const warehouseIds = new Set(options.warehouses.map((item) => item.id));
  const priceTypeIds = new Set(options.price_types.map((item) => item.id));
  const partnerIds = new Set(options.partners.map((item) => item.id));

  return {
    warehouseId:
      record.warehouseId != null && warehouseIds.has(record.warehouseId)
        ? record.warehouseId
        : null,
    priceTypeId:
      record.priceTypeId != null && priceTypeIds.has(record.priceTypeId)
        ? record.priceTypeId
        : null,
    partnerId:
      record.partnerId != null && partnerIds.has(record.partnerId)
        ? record.partnerId
        : null,
  };
}

export async function loadSellContext(
  scopeKey: string,
): Promise<SellContextRecord | null> {
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(scopeKey);
    request.onerror = () => reject(request.error ?? new Error("Failed to load sell context"));
    request.onsuccess = () => {
      resolve(normalizeSellContextRecord(request.result));
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load sell context"));
    };
  });
}

export async function saveSellContext(
  scopeKey: string,
  record: SellContextRecord,
): Promise<void> {
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record, scopeKey);
    request.onerror = () => reject(request.error ?? new Error("Failed to save sell context"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save sell context"));
    };
  });
}

export async function clearSellContext(scopeKey: string): Promise<void> {
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(scopeKey);
    request.onerror = () => reject(request.error ?? new Error("Failed to clear sell context"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to clear sell context"));
    };
  });
}
