import { toast } from "sonner";
import { isCacheEnabled } from "@/lib/cache-policy";
import {
  applyIncrementalSyncToCatalog,
  getCatalogDownloadStatus,
  performIncrementalSync,
  removeCatalogDownloadStatus,
  setCatalogDownloadStatus,
  type CatalogSyncUiHandlers,
  type IncrementalSyncResult,
} from "@/lib/catalog-incremental-sync";
import { downloadCompleteCatalog } from "@/lib/catalog-service";
import { buildCatalogScopeKey } from "@/lib/pulse-pos-db";

export type EnsureCatalogReadyScope = {
  companyId: number;
  warehouseId?: number;
  priceTypeId?: number;
};

export type EnsureCatalogReadyTranslate = (
  key: string,
  fallback: string,
  vars?: Record<string, string | number>,
) => string;

export type EnsureCatalogReadyOptions = {
  force?: boolean;
  /** When true, skip if this scope already completed startup sync in this tab session. */
  skipIfDone?: boolean;
  /** Session marker: set to scopeKey after a successful catch-up/download. */
  doneForScopeRef?: { current: string | null };
  /** Return true if the caller unmounted / cancelled. */
  isCancelled?: () => boolean;
  /** Apply incremental deltas to live POS UI (optional on Products page). */
  uiHandlers?: CatalogSyncUiHandlers;
  onDownloaded?: () => void;
  t?: EnsureCatalogReadyTranslate;
};

export type EnsureCatalogReadyResult = {
  synced: boolean;
  downloaded: boolean;
  fullSyncRequired: boolean;
  incremental?: IncrementalSyncResult;
};

/**
 * Catch up the local catalog cache for a scope: incremental sync, then full
 * download only when download status is missing or full_sync_required.
 * No-ops when browser caching is disabled.
 */
export async function ensureCatalogReady(
  token: string,
  scope: EnsureCatalogReadyScope,
  options?: EnsureCatalogReadyOptions,
): Promise<EnsureCatalogReadyResult> {
  if (!isCacheEnabled()) {
    return { synced: false, downloaded: false, fullSyncRequired: false };
  }

  const scopeKey = buildCatalogScopeKey(
    scope.companyId,
    scope.warehouseId,
    scope.priceTypeId,
  );

  if (
    !options?.force &&
    options?.skipIfDone &&
    options.doneForScopeRef?.current === scopeKey
  ) {
    return { synced: true, downloaded: false, fullSyncRequired: false };
  }

  let fullSyncRequired = false;
  let incremental: IncrementalSyncResult | undefined;

  try {
    const syncResult = await performIncrementalSync(
      token,
      scopeKey,
      {
        companyId: scope.companyId,
        warehouseId: scope.warehouseId,
        priceTypeId: scope.priceTypeId,
      },
      { force: options?.force },
    );
    incremental = syncResult;

    if (options?.isCancelled?.()) {
      return { synced: false, downloaded: false, fullSyncRequired: false, incremental };
    }

    if (options?.uiHandlers) {
      fullSyncRequired = applyIncrementalSyncToCatalog(syncResult, options.uiHandlers);
    } else {
      fullSyncRequired = Boolean(syncResult.fullSyncRequired);
    }

    if (fullSyncRequired) {
      removeCatalogDownloadStatus(
        scope.companyId,
        scope.warehouseId,
        scope.priceTypeId,
      );
    }
  } catch {
    // Incremental sync failed (e.g. network error) — continue to full download check
  }

  if (options?.isCancelled?.()) {
    return { synced: false, downloaded: false, fullSyncRequired, incremental };
  }

  const status = getCatalogDownloadStatus(
    scope.companyId,
    scope.warehouseId,
    scope.priceTypeId,
  );
  if (status === "completed" && !fullSyncRequired) {
    if (options?.doneForScopeRef) {
      options.doneForScopeRef.current = scopeKey;
    }
    return { synced: true, downloaded: false, fullSyncRequired: false, incremental };
  }

  const t = options?.t;
  const toastId = t
    ? toast.loading(t("pos.catalog.downloading", "Downloading complete product catalog..."))
    : undefined;

  try {
    await downloadCompleteCatalog(token, {
      companyId: scope.companyId,
      warehouseId: scope.warehouseId,
      priceTypeId: scope.priceTypeId,
    });

    if (options?.isCancelled?.()) {
      return { synced: false, downloaded: false, fullSyncRequired, incremental };
    }

    setCatalogDownloadStatus(
      scope.companyId,
      scope.warehouseId ?? null,
      scope.priceTypeId ?? null,
      "completed",
    );

    if (t && toastId != null) {
      toast.success(t("pos.catalog.downloadSuccess", "Catalog downloaded successfully!"), {
        id: toastId,
      });
    }

    options?.onDownloaded?.();

    if (options?.doneForScopeRef) {
      options.doneForScopeRef.current = scopeKey;
    }

    return { synced: true, downloaded: true, fullSyncRequired, incremental };
  } catch {
    if (options?.isCancelled?.()) {
      return { synced: false, downloaded: false, fullSyncRequired, incremental };
    }
    if (t && toastId != null) {
      toast.error(t("pos.catalog.downloadFailure", "Failed to download catalog."), {
        id: toastId,
      });
    }
    return { synced: false, downloaded: false, fullSyncRequired, incremental };
  }
}
