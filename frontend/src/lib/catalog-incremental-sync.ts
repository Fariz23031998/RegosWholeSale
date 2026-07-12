import { fetchProductSync } from "@/lib/catalog-api";
import {
  upsertProducts,
  removeProducts,
  invalidateGroups,
  clearCachedPagesForScope,
} from "@/lib/catalog-products-db";
import { loadCachedProductIdsByScope } from "@/lib/catalog-products-db/loadCachedProductIdsByScope/loadCachedProductIdsByScope";
import { getLastSyncTime, setLastSyncTime } from "@/lib/sync-meta-db";
import type { Product } from "@/types/catalog";

export type IncrementalSyncResult = {
  synced: boolean;
  fullSyncRequired: boolean;
  updatedCount: number;
  removedCount: number;
  groupsInvalidated: boolean;
  updatedProducts?: Product[];
  removedProductIds?: string[];
};

/** Stay inside the backend events_log retention window (30 days). */
const FALLBACK_SYNC_LOOKBACK_MS = 29 * 24 * 60 * 60 * 1000;

/**
 * Skip network sync when the watermark is still fresh.
 * Treats server-ahead clocks as fresh (ageMs can be negative).
 */
export const RECENT_SYNC_SKIP_MS = 60_000;

/** In-memory last successful sync per scope — survives within the tab session. */
const lastFetchedAtByScope = new Map<string, number>();

const inflightSyncs = new Map<string, Promise<IncrementalSyncResult>>();

function downloadStatusKey(
  companyId: number,
  warehouseId?: number,
  priceTypeId?: number,
): string {
  return `catalog_download_status:${companyId}:${warehouseId ?? 0}:${priceTypeId ?? 0}`;
}

function hasCompletedCatalogDownload(
  companyId: number,
  warehouseId?: number,
  priceTypeId?: number,
): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(downloadStatusKey(companyId, warehouseId, priceTypeId)) === "completed";
}

function isWatermarkFresh(since: string, scopeKey: string): boolean {
  const now = Date.now();
  const memoryFetchedAt = lastFetchedAtByScope.get(scopeKey);
  if (memoryFetchedAt != null && now - memoryFetchedAt < RECENT_SYNC_SKIP_MS) {
    return true;
  }

  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) return false;

  // Fresh if watermark is within the skip window, including slightly in the future
  // (server clock ahead of the client).
  return sinceMs > now - RECENT_SYNC_SKIP_MS;
}

/**
 * Resolve the `since` cursor for incremental sync.
 * - Prefer the stored watermark.
 * - If missing but the scope already has a local catalog cache, fall back to a
 *   lookback within the server retention window so cold-start clients still catch up.
 * - If there is no cache yet, return null (automatic full download handles first setup).
 */
export async function resolveSyncSince(
  scopeKey: string,
  scope: {
    companyId: number;
    warehouseId?: number;
    priceTypeId?: number;
  },
): Promise<string | null> {
  const lastSyncTime = await getLastSyncTime(scopeKey).catch(() => null);
  if (lastSyncTime) return lastSyncTime;

  const cachedIds = await loadCachedProductIdsByScope(scopeKey).catch(() => []);
  const hasCache =
    cachedIds.length > 0 ||
    hasCompletedCatalogDownload(scope.companyId, scope.warehouseId, scope.priceTypeId);

  if (!hasCache) return null;

  return new Date(Date.now() - FALLBACK_SYNC_LOOKBACK_MS).toISOString();
}

export async function performIncrementalSync(
  token: string,
  scopeKey: string,
  scope: {
    companyId: number;
    warehouseId?: number;
    priceTypeId?: number;
  },
  options?: { force?: boolean },
): Promise<IncrementalSyncResult> {
  let promise = inflightSyncs.get(scopeKey);
  if (!promise || options?.force) {
    const runKey = options?.force ? `force:${scopeKey}` : scopeKey;
    // If forcing, don't reuse a possibly "fresh" no-op inflight for the same scope.
    const existingForce = options?.force ? inflightSyncs.get(runKey) : undefined;
    if (options?.force && existingForce) {
      return existingForce;
    }
    promise = (async () => {
      try {
        const since = await resolveSyncSince(scopeKey, scope);

        if (!since) {
          return {
            synced: false,
            fullSyncRequired: false,
            updatedCount: 0,
            removedCount: 0,
            groupsInvalidated: false,
          };
        }

        if (!options?.force && isWatermarkFresh(since, scopeKey)) {
          return {
            synced: true,
            fullSyncRequired: false,
            updatedCount: 0,
            removedCount: 0,
            groupsInvalidated: false,
          };
        }

        const response = await fetchProductSync(token, since, {
          warehouseId: scope.warehouseId,
          priceTypeId: scope.priceTypeId,
        });

        if (response.full_sync_required) {
          return {
            synced: false,
            fullSyncRequired: true,
            updatedCount: 0,
            removedCount: 0,
            groupsInvalidated: false,
          };
        }

        const hasChanges =
          response.updated_products.length > 0 ||
          response.removed_product_ids.length > 0 ||
          response.groups_invalidated;

        if (response.updated_products.length > 0) {
          await upsertProducts(scopeKey, response.updated_products).catch(() => undefined);
        }

        if (response.removed_product_ids.length > 0) {
          const productIds = response.removed_product_ids.map((id) => String(id));
          await removeProducts(scopeKey, productIds).catch(() => undefined);
        }

        if (response.groups_invalidated) {
          await invalidateGroups(scope.companyId).catch(() => undefined);
        }

        if (hasChanges) {
          await clearCachedPagesForScope(scopeKey).catch(() => undefined);
        }

        // Mark sync time only after a successful fetch so the next call won't re-pull.
        await setLastSyncTime(scopeKey, response.synced_at);
        lastFetchedAtByScope.set(scopeKey, Date.now());

        return {
          synced: true,
          fullSyncRequired: false,
          updatedCount: response.updated_products.length,
          removedCount: response.removed_product_ids.length,
          groupsInvalidated: response.groups_invalidated,
          updatedProducts: response.updated_products,
          removedProductIds: response.removed_product_ids.map((id) => String(id)),
        };
      } finally {
        inflightSyncs.delete(runKey);
      }
    })();
    inflightSyncs.set(runKey, promise);
  }
  return promise;
}
