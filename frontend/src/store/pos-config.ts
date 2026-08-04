import { create } from "zustand";
import { DEFAULT_CATEGORY_ALL } from "@/lib/default-category";
import { DEFAULT_TENDERED_QUICK_AMOUNTS } from "@/lib/tendered-amounts";
import { buildEmployeeSettingsKey, loadCachedSettingsData } from "@/lib/settings-db";
import { fetchUserPosSettings } from "@/lib/settings-api";
import type {
  CrossCurrencyPaymentMode,
  DefaultCategorySetting,
  PostponeDocumentType,
  UserPosSettings,
} from "@/types/settings";

type HydrateOptions = {
  force?: boolean;
  userId?: number | null;
  companyId?: number | null;
};

type PosConfigState = {
  allowOutOfStock: boolean;
  tenderedQuickAmounts: number[];
  autoOpenQtyKeypad: boolean;
  crossCurrencyPaymentMode: CrossCurrencyPaymentMode;
  internalBarcodeWeightPrefix: string;
  internalBarcodePiecePrefix: string;
  postponeDocumentType: PostponeDocumentType;
  postponeOrderBooked: boolean;
  defaultCategory: DefaultCategorySetting;
  hydrated: boolean;
  hydrate: (token: string | null, options?: HydrateOptions) => Promise<void>;
};

let hydrateInflight: Promise<void> | null = null;
let hydrateInflightKey: string | null = null;
let lastHydratedKey: string | null = null;

function applyPosSettings(settings: UserPosSettings) {
  const amounts = settings.tendered_quick_amounts;
  return {
    allowOutOfStock: settings.allow_out_of_stock,
    tenderedQuickAmounts: amounts.length > 0 ? amounts : DEFAULT_TENDERED_QUICK_AMOUNTS,
    autoOpenQtyKeypad: settings.auto_open_qty_keypad,
    crossCurrencyPaymentMode: settings.cross_currency_payment_mode ?? "payment_currency",
    internalBarcodeWeightPrefix: settings.internal_barcode_weight_prefix ?? "22",
    internalBarcodePiecePrefix: settings.internal_barcode_piece_prefix ?? "23",
    postponeDocumentType: settings.postpone_document_type ?? "doc_wholesale",
    postponeOrderBooked: settings.postpone_order_booked ?? true,
    defaultCategory: settings.default_category,
  };
}

function defaultPosConfigState() {
  return {
    allowOutOfStock: false,
    tenderedQuickAmounts: DEFAULT_TENDERED_QUICK_AMOUNTS,
    autoOpenQtyKeypad: false,
    crossCurrencyPaymentMode: "payment_currency" as CrossCurrencyPaymentMode,
    internalBarcodeWeightPrefix: "22",
    internalBarcodePiecePrefix: "23",
    postponeDocumentType: "doc_wholesale" as PostponeDocumentType,
    postponeOrderBooked: true,
    defaultCategory: DEFAULT_CATEGORY_ALL,
  };
}

export const usePosConfig = create<PosConfigState>((set, get) => ({
  ...defaultPosConfigState(),
  hydrated: false,
  hydrate: async (token, options) => {
    const userId = options?.userId ?? null;
    const companyId = options?.companyId ?? null;
    const key = `${token ?? ""}:${companyId ?? ""}:${userId ?? ""}`;
    const force = options?.force ?? false;
    const cacheScope =
      companyId != null && userId != null ? { companyId, userId } : undefined;

    if (!token) {
      hydrateInflight = null;
      hydrateInflightKey = null;
      lastHydratedKey = null;
      set({
        ...defaultPosConfigState(),
        hydrated: true,
      });
      return;
    }

    if (!force && get().hydrated && lastHydratedKey === key) {
      return;
    }

    if (!force && hydrateInflight && hydrateInflightKey === key) {
      return hydrateInflight;
    }

    const run = (async () => {
      if (!force) {
        set({ hydrated: false });
      }

      // Applying a cached copy here (without flipping `hydrated`) lets other
      // consumers see optimistic values without letting ProductCatalog act on
      // a value that may still be overwritten by the authoritative fetch below —
      // that premature apply is what caused the default category to flash
      // (e.g. "All" then "Featured") on startup.
      let appliedFromCache = false;
      if (!force && cacheScope) {
        const idbKey = buildEmployeeSettingsKey(cacheScope.companyId, cacheScope.userId, "pos");
        const cached = await loadCachedSettingsData<{ settings: UserPosSettings }>(idbKey);
        if (cached?.settings) {
          set({
            ...applyPosSettings(cached.settings),
          });
          appliedFromCache = true;
        }
      }

      try {
        const res = await fetchUserPosSettings(token, { force: true, cacheScope });
        set({
          ...applyPosSettings(res.settings),
        });
      } catch {
        if (!appliedFromCache) {
          set(defaultPosConfigState());
        }
      } finally {
        lastHydratedKey = key;
        set({ hydrated: true });
        hydrateInflight = null;
        hydrateInflightKey = null;
      }
    })();

    hydrateInflight = run;
    hydrateInflightKey = key;
    return run;
  },
}));
