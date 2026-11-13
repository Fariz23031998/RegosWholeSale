import { CATALOG_UI_STORE, openPulsePosDb } from "@/lib/pulse-pos-db";

const PURCHASE_LINE_MARKUP_KEY = "purchase-line-markup";

export type PurchaseLineMarkupState = {
  markupPercent: number | null;
};

function normalizeMarkupPercent(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeState(value: unknown): PurchaseLineMarkupState {
  if (!value || typeof value !== "object") {
    return { markupPercent: null };
  }
  const record = value as Partial<PurchaseLineMarkupState>;
  return { markupPercent: normalizeMarkupPercent(record.markupPercent) };
}

export async function loadPurchaseLineMarkup(): Promise<number | null> {
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_UI_STORE, "readonly");
    const store = tx.objectStore(CATALOG_UI_STORE);
    const request = store.get(PURCHASE_LINE_MARKUP_KEY);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to load purchase line markup"));
    request.onsuccess = () => {
      resolve(normalizeState(request.result).markupPercent);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load purchase line markup"));
    };
  });
}

export async function savePurchaseLineMarkup(
  markupPercent: number | null,
): Promise<void> {
  const payload: PurchaseLineMarkupState = {
    markupPercent: normalizeMarkupPercent(markupPercent),
  };
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_UI_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_UI_STORE);
    const request = store.put(payload, PURCHASE_LINE_MARKUP_KEY);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to save purchase line markup"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save purchase line markup"));
    };
  });
}
