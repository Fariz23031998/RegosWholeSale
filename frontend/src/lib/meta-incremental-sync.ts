import { fetchMetaSync, type SyncMetaSettingsChange } from "@/lib/catalog-api";
import type { ReferenceOptionKind } from "@/lib/catalog-events";
import { clearPartnersCache } from "@/lib/cache-service";
import { loadPaymentTypes } from "@/lib/payment-service";
import {
  refreshSettingsNamespace,
  type SettingsCacheScope,
} from "@/lib/settings-api";
import type { SettingsEventNamespace } from "@/lib/settings-events";
import { getLastSyncTime, setLastSyncTime } from "@/lib/sync-meta-db";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";

/** Stay inside the backend events_log retention window (30 days). */
const FALLBACK_SYNC_LOOKBACK_MS = 29 * 24 * 60 * 60 * 1000;

/** Skip network sync when the watermark is still fresh. */
export const META_RECENT_SYNC_SKIP_MS = 60_000;

const lastFetchedAtByCompany = new Map<number, number>();
/** Shared across incremental + full refresh so Update Cache cannot overlap app-shell meta sync. */
const inflightMetaByCompany = new Map<number, Promise<MetaIncrementalSyncResult>>();

const ALL_REFERENCE_KINDS: ReferenceOptionKind[] = ["warehouse", "price_type", "partner"];

const FULL_SYNC_NAMESPACES: SettingsEventNamespace[] = [
  "pos",
  "regos_defaults",
  "receipt_templates",
  "label_templates",
  "label_print",
  "exchange_rate_sync",
  "regos_token",
  "payment_linking",
  "doc_payment_sale_id",
];

export type MetaIncrementalSyncResult = {
  synced: boolean;
  fullSyncRequired: boolean;
  referenceKinds: string[];
  paymentTypesInvalidated: boolean;
  settingsCount: number;
};

export function metaSyncScopeKey(companyId: number): string {
  return `meta:${companyId}`;
}

function isWatermarkFresh(since: string, companyId: number): boolean {
  const now = Date.now();
  const memoryFetchedAt = lastFetchedAtByCompany.get(companyId);
  if (memoryFetchedAt != null && now - memoryFetchedAt < META_RECENT_SYNC_SKIP_MS) {
    return true;
  }

  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) return false;
  return sinceMs > now - META_RECENT_SYNC_SKIP_MS;
}

export async function resolveMetaSyncSince(companyId: number): Promise<string> {
  const key = metaSyncScopeKey(companyId);
  const lastSyncTime = await getLastSyncTime(key).catch(() => null);
  if (lastSyncTime) return lastSyncTime;
  return new Date(Date.now() - FALLBACK_SYNC_LOOKBACK_MS).toISOString();
}

function asReferenceKinds(kinds: string[]): ReferenceOptionKind[] {
  const allowed = new Set(ALL_REFERENCE_KINDS);
  return kinds.filter((kind): kind is ReferenceOptionKind =>
    allowed.has(kind as ReferenceOptionKind),
  );
}

function asSettingsNamespace(value: string): SettingsEventNamespace | null {
  return FULL_SYNC_NAMESPACES.includes(value as SettingsEventNamespace)
    ? (value as SettingsEventNamespace)
    : null;
}

async function applySettingsChange(
  token: string,
  change: SyncMetaSettingsChange,
  cacheScope: SettingsCacheScope,
  canChangePosContext: boolean,
): Promise<void> {
  const namespace = asSettingsNamespace(change.namespace);
  if (!namespace) return;

  const scope: SettingsCacheScope = {
    ...cacheScope,
    ...(change.scope === "employee" && change.user_id
      ? { userId: change.user_id }
      : {}),
  };

  await refreshSettingsNamespace(token, namespace, scope).catch(() => undefined);

  if (namespace === "pos") {
    await usePosConfig.getState().hydrate(token, {
      force: true,
      userId: scope.userId ?? cacheScope.userId,
      companyId: cacheScope.companyId,
    });
  }
  if (namespace === "regos_defaults") {
    await useSellContext.getState().hydrate(token, canChangePosContext, {
      force: true,
      userId: scope.userId ?? cacheScope.userId,
      companyId: cacheScope.companyId,
    });
  }
}

function fullMetaRefreshResult(): MetaIncrementalSyncResult {
  return {
    synced: true,
    fullSyncRequired: true,
    referenceKinds: [...ALL_REFERENCE_KINDS],
    paymentTypesInvalidated: true,
    settingsCount: FULL_SYNC_NAMESPACES.length,
  };
}

/** Internal full refresh without taking the company inflight slot (caller already holds it). */
async function runForceFullMetaRefresh(
  token: string,
  cacheScope: SettingsCacheScope,
  canChangePosContext: boolean,
): Promise<void> {
  await useSellContext
    .getState()
    .refreshReferenceOptions(token, ALL_REFERENCE_KINDS)
    .catch(() => undefined);
  await clearPartnersCache().catch(() => undefined);
  if (cacheScope.companyId != null) {
    await loadPaymentTypes(token, cacheScope.companyId, { force: true }).catch(() => undefined);
  }
  for (const namespace of FULL_SYNC_NAMESPACES) {
    await refreshSettingsNamespace(token, namespace, cacheScope).catch(() => undefined);
  }
  await usePosConfig.getState().hydrate(token, {
    force: true,
    userId: cacheScope.userId,
    companyId: cacheScope.companyId,
  });
  await useSellContext.getState().hydrate(token, canChangePosContext, {
    force: true,
    userId: cacheScope.userId,
    companyId: cacheScope.companyId,
  });
}

/** Force-refresh partners, payment types, and settings caches from the server. */
export async function forceFullMetaRefresh(
  token: string,
  cacheScope: SettingsCacheScope,
  canChangePosContext: boolean,
): Promise<void> {
  const companyId = cacheScope.companyId;
  if (companyId == null) {
    await runForceFullMetaRefresh(token, cacheScope, canChangePosContext);
    return;
  }

  const existing = inflightMetaByCompany.get(companyId);
  if (existing) {
    await existing;
    return;
  }

  const promise = (async () => {
    try {
      await runForceFullMetaRefresh(token, cacheScope, canChangePosContext);
      lastFetchedAtByCompany.set(companyId, Date.now());
      return fullMetaRefreshResult();
    } finally {
      inflightMetaByCompany.delete(companyId);
    }
  })();
  inflightMetaByCompany.set(companyId, promise);
  await promise;
}

export async function performMetaIncrementalSync(
  token: string,
  companyId: number,
  userId: number,
  options?: { canChangePosContext?: boolean; force?: boolean },
): Promise<MetaIncrementalSyncResult> {
  // Force joins an in-progress meta sync for the company instead of starting another.
  const existing = inflightMetaByCompany.get(companyId);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      const since = await resolveMetaSyncSince(companyId);
      if (!options?.force && isWatermarkFresh(since, companyId)) {
        return {
          synced: true,
          fullSyncRequired: false,
          referenceKinds: [],
          paymentTypesInvalidated: false,
          settingsCount: 0,
        };
      }

      const response = await fetchMetaSync(token, since);
      const canChangePosContext = options?.canChangePosContext ?? false;
      const cacheScope: SettingsCacheScope = { companyId, userId };

      if (response.full_sync_required) {
        // Already hold the company slot — call the unlocked implementation.
        await runForceFullMetaRefresh(token, cacheScope, canChangePosContext);
        await setLastSyncTime(metaSyncScopeKey(companyId), response.synced_at);
        lastFetchedAtByCompany.set(companyId, Date.now());
        return fullMetaRefreshResult();
      }

      const referenceKinds = asReferenceKinds(response.reference_kinds);
      if (referenceKinds.length > 0) {
        await useSellContext
          .getState()
          .refreshReferenceOptions(token, referenceKinds)
          .catch(() => undefined);
        if (referenceKinds.includes("partner")) {
          await clearPartnersCache().catch(() => undefined);
        }
      }

      if (response.payment_types_invalidated) {
        await loadPaymentTypes(token, companyId, { force: true }).catch(() => undefined);
      }

      for (const change of response.settings) {
        // Only apply employee settings for the current user (or company-wide).
        if (
          change.scope === "employee" &&
          change.user_id != null &&
          change.user_id !== userId
        ) {
          continue;
        }
        await applySettingsChange(token, change, cacheScope, canChangePosContext);
      }

      await setLastSyncTime(metaSyncScopeKey(companyId), response.synced_at);
      lastFetchedAtByCompany.set(companyId, Date.now());

      return {
        synced: true,
        fullSyncRequired: false,
        referenceKinds,
        paymentTypesInvalidated: response.payment_types_invalidated,
        settingsCount: response.settings.length,
      };
    } finally {
      inflightMetaByCompany.delete(companyId);
    }
  })();
  inflightMetaByCompany.set(companyId, promise);
  return promise;
}
