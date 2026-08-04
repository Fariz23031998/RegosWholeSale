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
const inflightSyncs = new Map<string, Promise<MetaIncrementalSyncResult>>();

const ALL_REFERENCE_KINDS: ReferenceOptionKind[] = ["warehouse", "price_type", "partner"];

const FULL_SYNC_NAMESPACES: SettingsEventNamespace[] = [
  "pos",
  "regos_defaults",
  "receipt_templates",
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

/** Force-refresh partners, payment types, and settings caches from the server. */
export async function forceFullMetaRefresh(
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

export async function performMetaIncrementalSync(
  token: string,
  companyId: number,
  userId: number,
  options?: { canChangePosContext?: boolean; force?: boolean },
): Promise<MetaIncrementalSyncResult> {
  // Force resumes must not share a non-force inflight that may no-op as "fresh".
  const inflightKey = `${options?.force ? "force" : "normal"}:${companyId}`;
  let promise = inflightSyncs.get(inflightKey);
  if (!promise) {
    promise = (async () => {
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
          await forceFullMetaRefresh(token, cacheScope, canChangePosContext);
          await setLastSyncTime(metaSyncScopeKey(companyId), response.synced_at);
          lastFetchedAtByCompany.set(companyId, Date.now());
          return {
            synced: true,
            fullSyncRequired: true,
            referenceKinds: [...ALL_REFERENCE_KINDS],
            paymentTypesInvalidated: true,
            settingsCount: FULL_SYNC_NAMESPACES.length,
          };
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
        inflightSyncs.delete(inflightKey);
      }
    })();
    inflightSyncs.set(inflightKey, promise);
  }
  return promise;
}
