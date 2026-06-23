const DB_NAME = "regos-language";
const STORE_NAME = "settings";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Failed to open language IndexedDB"));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = fn(store);
    let result: T | undefined;

    request.onerror = () => reject(request.error ?? new Error("Language IndexedDB request failed"));
    request.onsuccess = () => {
      result = request.result as T;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result as T);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Language IndexedDB transaction failed"));
    };
  });
}

export async function getLanguageSetting<T>(key: string): Promise<T | null> {
  const row = await withStore("readonly", (store) => store.get(key));
  return (row as { key: string; value: T } | undefined)?.value ?? null;
}

export async function saveLanguageSetting<T>(key: string, value: T): Promise<void> {
  await withStore("readwrite", (store) => store.put({ key, value }));
}

export async function saveLanguage(
  langCode: string,
  version: string,
  translations: Record<string, string>,
): Promise<void> {
  await saveLanguageSetting(`lang_${langCode}`, translations);
  await saveLanguageSetting(`lang_${langCode}_version`, version);
}

export async function getLanguage(langCode: string): Promise<Record<string, string> | null> {
  return getLanguageSetting<Record<string, string>>(`lang_${langCode}`);
}

export async function getLanguageVersion(langCode: string): Promise<string | null> {
  return getLanguageSetting<string>(`lang_${langCode}_version`);
}

export async function clearLanguageData(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAllKeys();
    request.onerror = () => reject(request.error ?? new Error("Failed to read language keys"));
    request.onsuccess = () => {
      const keys = request.result as string[];
      keys
        .filter((key) => key === "current_language" || key.startsWith("lang_"))
        .forEach((key) => store.delete(key));
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to clear language data"));
    };
  });
}
