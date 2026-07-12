import { PARTNERS_STORE, openPulsePosDb } from "@/lib/pulse-pos-db";
import type { Partner, PartnerGroup } from "@/types/partners";

export type CachedPartnersRecord = {
  partners: Partner[];
  fetchedAt: number;
};

export type CachedPartnerGroupsRecord = {
  groups: PartnerGroup[];
  fetchedAt: number;
};

export type PartnerPickerPreferences = {
  groupId: number | null;
};

function partnerGroupFilterKey(companyId: number): string {
  return `group-filter:${companyId}`;
}

function partnerGroupsKey(companyId: number): string {
  return `groups:${companyId}`;
}

async function openDb(): Promise<IDBDatabase> {
  return openPulsePosDb();
}

export async function loadPartnerGroupFilter(
  companyId: number,
): Promise<number | null> {
  const db = await openDb();
  const key = partnerGroupFilterKey(companyId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PARTNERS_STORE, "readonly");
    const store = tx.objectStore(PARTNERS_STORE);
    const request = store.get(key);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to load partner group filter"));
    request.onsuccess = () => {
      const value = request.result as PartnerPickerPreferences | number | null | undefined;
      if (value == null) {
        resolve(null);
        return;
      }
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        resolve(value);
        return;
      }
      if (typeof value === "object" && typeof value.groupId === "number" && value.groupId > 0) {
        resolve(value.groupId);
        return;
      }
      resolve(null);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load partner group filter"));
    };
  });
}

export async function savePartnerGroupFilter(
  companyId: number,
  groupId: number | null,
): Promise<void> {
  const db = await openDb();
  const key = partnerGroupFilterKey(companyId);
  const record: PartnerPickerPreferences = { groupId };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PARTNERS_STORE, "readwrite");
    const store = tx.objectStore(PARTNERS_STORE);
    const request = store.put(record, key);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to save partner group filter"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save partner group filter"));
    };
  });
}

export async function loadCachedPartners(
  companyId: number,
): Promise<CachedPartnersRecord | null> {
  const db = await openDb();
  const key = String(companyId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PARTNERS_STORE, "readonly");
    const store = tx.objectStore(PARTNERS_STORE);
    const request = store.get(key);
    request.onerror = () => reject(request.error ?? new Error("Failed to load cached partners"));
    request.onsuccess = () => {
      resolve((request.result as CachedPartnersRecord | undefined) ?? null);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load cached partners"));
    };
  });
}

export async function saveCachedPartners(
  companyId: number,
  partners: Partner[],
): Promise<void> {
  const db = await openDb();
  const key = String(companyId);
  const record: CachedPartnersRecord = {
    partners,
    fetchedAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PARTNERS_STORE, "readwrite");
    const store = tx.objectStore(PARTNERS_STORE);
    const request = store.put(record, key);
    request.onerror = () => reject(request.error ?? new Error("Failed to save cached partners"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save cached partners"));
    };
  });
}

export async function invalidateCachedPartners(companyId: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PARTNERS_STORE, "readwrite");
    const store = tx.objectStore(PARTNERS_STORE);
    const request = store.delete(String(companyId));
    request.onerror = () => reject(request.error ?? new Error("Failed to invalidate cached partners"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to invalidate cached partners"));
    };
  });
}

export async function loadCachedPartnerGroups(
  companyId: number,
): Promise<CachedPartnerGroupsRecord | null> {
  const db = await openDb();
  const key = partnerGroupsKey(companyId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PARTNERS_STORE, "readonly");
    const store = tx.objectStore(PARTNERS_STORE);
    const request = store.get(key);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to load cached partner groups"));
    request.onsuccess = () => {
      resolve((request.result as CachedPartnerGroupsRecord | undefined) ?? null);
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load cached partner groups"));
    };
  });
}

export async function saveCachedPartnerGroups(
  companyId: number,
  groups: PartnerGroup[],
): Promise<void> {
  const db = await openDb();
  const key = partnerGroupsKey(companyId);
  const record: CachedPartnerGroupsRecord = {
    groups,
    fetchedAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PARTNERS_STORE, "readwrite");
    const store = tx.objectStore(PARTNERS_STORE);
    const request = store.put(record, key);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to save cached partner groups"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save cached partner groups"));
    };
  });
}

export async function invalidateCachedPartnerGroups(companyId: number): Promise<void> {
  const db = await openDb();
  const key = partnerGroupsKey(companyId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PARTNERS_STORE, "readwrite");
    const store = tx.objectStore(PARTNERS_STORE);
    const request = store.delete(key);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to invalidate cached partner groups"));
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to invalidate cached partner groups"));
    };
  });
}
