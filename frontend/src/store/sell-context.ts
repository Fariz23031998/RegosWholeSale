import { create } from "zustand";
import {
  clearSellContext,
  loadSellContext,
  saveSellContext,
  validateSellContextRecord,
} from "@/lib/sell-context-db";
import { fetchMyRegosDefaults, fetchRegosReferenceOptions } from "@/lib/settings-api";
import type {
  RegosCurrencyOption,
  RegosDefaultOption,
  RegosReferenceOptionsResponse,
} from "@/types/settings";

const EMPTY_OPTIONS: RegosReferenceOptionsResponse = {
  warehouses: [],
  price_types: [],
  partners: [],
  payment_categories: [],
  refund_payment_categories: [],
  attached_users: [],
};

type ApiDefaults = {
  warehouseId: number | null;
  priceTypeId: number | null;
  partnerId: number | null;
  saleCurrency: RegosCurrencyOption | null;
};

type HydrateOptions = {
  force?: boolean;
  userId?: number | null;
  companyId?: number | null;
};

type SellContextState = {
  scopeKey: string | null;
  warehouseId: number | null;
  priceTypeId: number | null;
  partnerId: number | null;
  saleCurrency: RegosCurrencyOption | null;
  apiDefaults: ApiDefaults;
  options: RegosReferenceOptionsResponse;
  hydrated: boolean;
  hydrate: (
    token: string | null,
    canOverride: boolean,
    options?: HydrateOptions,
  ) => Promise<void>;
  setWarehouseId: (id: number | null) => void;
  setPriceTypeId: (id: number | null) => void;
  setPartnerId: (id: number | null) => void;
  resetToDefaults: () => Promise<void>;
  refreshPartnerOptions: (token: string) => Promise<void>;
  checkoutOverrides: () => {
    warehouse_id?: number;
    price_type_id?: number;
    partner_id?: number;
  };
  catalogQuery: () => {
    warehouseId?: number;
    priceTypeId?: number;
  };
};

function optionId(option: RegosDefaultOption | null | undefined): number | null {
  return option?.id ?? null;
}

function saleCurrencyForPriceType(
  priceTypeId: number | null,
  options: RegosReferenceOptionsResponse,
): RegosCurrencyOption | null {
  if (!priceTypeId) return null;
  const priceType = options.price_types.find((item) => item.id === priceTypeId);
  return priceType?.currency ?? null;
}

function scopeKeyForUser(userId: number | null | undefined, companyId: number | null | undefined) {
  if (userId == null) return null;
  return `${companyId ?? 0}:${userId}`;
}

function mergeStoredSellContext(
  apiDefaults: ApiDefaults,
  stored: {
    warehouseId: number | null;
    priceTypeId: number | null;
    partnerId: number | null;
  },
  options: RegosReferenceOptionsResponse,
): Pick<SellContextState, "warehouseId" | "priceTypeId" | "partnerId" | "saleCurrency"> {
  const warehouseId = stored.warehouseId ?? apiDefaults.warehouseId;
  const priceTypeId = stored.priceTypeId ?? apiDefaults.priceTypeId;
  const partnerId = stored.partnerId ?? apiDefaults.partnerId;

  return {
    warehouseId,
    priceTypeId,
    partnerId,
    saleCurrency:
      saleCurrencyForPriceType(priceTypeId, options) ?? apiDefaults.saleCurrency,
  };
}

let hydrateInflight: Promise<void> | null = null;
let hydrateInflightKey: string | null = null;
let lastHydratedKey: string | null = null;

function persistCurrentSellContext(get: () => SellContextState) {
  const { scopeKey, warehouseId, priceTypeId, partnerId } = get();
  if (!scopeKey) return;

  void saveSellContext(scopeKey, {
    warehouseId,
    priceTypeId,
    partnerId,
  }).catch(() => {
    // Ignore persistence errors; in-memory state remains available.
  });
}

export const useSellContext = create<SellContextState>((set, get) => ({
  scopeKey: null,
  warehouseId: null,
  priceTypeId: null,
  partnerId: null,
  saleCurrency: null,
  apiDefaults: {
    warehouseId: null,
    priceTypeId: null,
    partnerId: null,
    saleCurrency: null,
  },
  options: EMPTY_OPTIONS,
  hydrated: false,

  hydrate: async (token, canOverride, options) => {
    const userId = options?.userId ?? null;
    const companyId = options?.companyId ?? null;
    const scopeKey = scopeKeyForUser(userId, companyId);
    const key = `${token ?? ""}:${canOverride}:${scopeKey ?? ""}`;
    const force = options?.force ?? false;

    if (!token) {
      hydrateInflight = null;
      hydrateInflightKey = null;
      lastHydratedKey = null;
      set({
        scopeKey: null,
        warehouseId: null,
        priceTypeId: null,
        partnerId: null,
        saleCurrency: null,
        apiDefaults: {
          warehouseId: null,
          priceTypeId: null,
          partnerId: null,
          saleCurrency: null,
        },
        options: EMPTY_OPTIONS,
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
      set({ hydrated: false, scopeKey });

      try {
        const defaultsRes = await fetchMyRegosDefaults(token, { force });
        const defaults = defaultsRes.defaults;
        const apiDefaults: ApiDefaults = {
          warehouseId: optionId(defaults.warehouse),
          priceTypeId: optionId(defaults.price_type),
          partnerId: optionId(defaults.partner),
          saleCurrency: defaults.currency,
        };

        let referenceOptions = EMPTY_OPTIONS;
        if (canOverride) {
          referenceOptions = await fetchRegosReferenceOptions(token, { force });
        }

        let nextContext = {
          warehouseId: apiDefaults.warehouseId,
          priceTypeId: apiDefaults.priceTypeId,
          partnerId: apiDefaults.partnerId,
          saleCurrency:
            saleCurrencyForPriceType(apiDefaults.priceTypeId, referenceOptions) ??
            apiDefaults.saleCurrency,
        };

        if (scopeKey) {
          const stored = await loadSellContext(scopeKey);
          if (stored) {
            const validated = validateSellContextRecord(
              stored,
              referenceOptions,
              canOverride,
            );
            nextContext = mergeStoredSellContext(
              apiDefaults,
              validated,
              referenceOptions,
            );
          }
        }

        set({
          scopeKey,
          apiDefaults,
          warehouseId: nextContext.warehouseId,
          priceTypeId: nextContext.priceTypeId,
          partnerId: nextContext.partnerId,
          saleCurrency: nextContext.saleCurrency,
          options: canOverride ? referenceOptions : EMPTY_OPTIONS,
        });
      } catch {
        set({
          scopeKey,
          warehouseId: null,
          priceTypeId: null,
          partnerId: null,
          saleCurrency: null,
          apiDefaults: {
            warehouseId: null,
            priceTypeId: null,
            partnerId: null,
            saleCurrency: null,
          },
          options: EMPTY_OPTIONS,
        });
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

  setWarehouseId: (id) => {
    set({ warehouseId: id });
    persistCurrentSellContext(get);
  },

  setPriceTypeId: (id) => {
    set((state) => {
      const resolved = saleCurrencyForPriceType(id, state.options);
      return {
        priceTypeId: id,
        saleCurrency: resolved ?? (id ? state.saleCurrency : null),
      };
    });
    persistCurrentSellContext(get);
  },

  setPartnerId: (id) => {
    set({ partnerId: id });
    persistCurrentSellContext(get);
  },

  resetToDefaults: async () => {
    const { scopeKey, apiDefaults, options } = get();
    if (scopeKey) {
      try {
        await clearSellContext(scopeKey);
      } catch {
        // Ignore clear errors; defaults still apply in memory.
      }
    }

    set({
      warehouseId: apiDefaults.warehouseId,
      priceTypeId: apiDefaults.priceTypeId,
      partnerId: apiDefaults.partnerId,
      saleCurrency:
        saleCurrencyForPriceType(apiDefaults.priceTypeId, options) ??
        apiDefaults.saleCurrency,
    });
  },

  refreshPartnerOptions: async (token) => {
    try {
      const options = await fetchRegosReferenceOptions(token, { force: true });
      set((state) => ({
        options: {
          ...state.options,
          partners: options.partners,
        },
      }));
    } catch {
      // Keep existing partner options on refresh failure.
    }
  },

  checkoutOverrides: () => {
    const { warehouseId, priceTypeId, partnerId } = get();
    const overrides: {
      warehouse_id?: number;
      price_type_id?: number;
      partner_id?: number;
    } = {};
    if (warehouseId) overrides.warehouse_id = warehouseId;
    if (priceTypeId) overrides.price_type_id = priceTypeId;
    if (partnerId) overrides.partner_id = partnerId;
    return overrides;
  },

  catalogQuery: () => {
    const { warehouseId, priceTypeId } = get();
    const query: { warehouseId?: number; priceTypeId?: number } = {};
    if (warehouseId) query.warehouseId = warehouseId;
    if (priceTypeId) query.priceTypeId = priceTypeId;
    return query;
  },
}));
