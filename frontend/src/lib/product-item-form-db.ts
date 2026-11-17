import { CATALOG_UI_STORE, openPulsePosDb } from "@/lib/pulse-pos-db";

const PRODUCT_ITEM_FORM_KEY = "product-item-form";

export const PRODUCT_ITEM_OPTIONAL_FIELD_KEYS = [
  "vat",
  "secondary_unit",
  "image",
  "articul",
  "barcodes",
  "icps",
  "package_code",
  "is_labeled",
  "description",
] as const;

export type ProductItemOptionalFieldKey = (typeof PRODUCT_ITEM_OPTIONAL_FIELD_KEYS)[number];

export type ProductItemFormPrefs = {
  visibleOptionalFields: Record<ProductItemOptionalFieldKey, boolean>;
};

const DEFAULT_VISIBLE: Record<ProductItemOptionalFieldKey, boolean> = {
  vat: true,
  secondary_unit: true,
  image: true,
  articul: true,
  barcodes: true,
  icps: true,
  package_code: true,
  is_labeled: true,
  description: true,
};

export const DEFAULT_PRODUCT_ITEM_FORM_PREFS: ProductItemFormPrefs = {
  visibleOptionalFields: { ...DEFAULT_VISIBLE },
};

function normalizeVisibleOptionalFields(
  value: unknown,
): Record<ProductItemOptionalFieldKey, boolean> {
  const record =
    value && typeof value === "object"
      ? (value as Partial<Record<ProductItemOptionalFieldKey, unknown>>)
      : {};
  const next = { ...DEFAULT_VISIBLE };
  for (const key of PRODUCT_ITEM_OPTIONAL_FIELD_KEYS) {
    if (typeof record[key] === "boolean") {
      next[key] = record[key];
    }
  }
  return next;
}

function normalizePrefs(value: unknown): ProductItemFormPrefs {
  if (!value || typeof value !== "object") {
    return {
      visibleOptionalFields: { ...DEFAULT_VISIBLE },
    };
  }
  const record = value as Partial<ProductItemFormPrefs>;
  return {
    visibleOptionalFields: normalizeVisibleOptionalFields(record.visibleOptionalFields),
  };
}

export async function loadProductItemFormPrefs(): Promise<ProductItemFormPrefs> {
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_UI_STORE, "readonly");
    const store = tx.objectStore(CATALOG_UI_STORE);
    const request = store.get(PRODUCT_ITEM_FORM_KEY);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to load product item form prefs"));
    request.onsuccess = () => {
      resolve(normalizePrefs(request.result));
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load product item form prefs"));
    };
  });
}

export async function saveProductItemFormPrefs(
  prefs: ProductItemFormPrefs,
): Promise<void> {
  const payload = normalizePrefs(prefs);
  const db = await openPulsePosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_UI_STORE, "readwrite");
    const store = tx.objectStore(CATALOG_UI_STORE);
    const request = store.put(payload, PRODUCT_ITEM_FORM_KEY);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to save product item form prefs"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save product item form prefs"));
    };
  });
}
