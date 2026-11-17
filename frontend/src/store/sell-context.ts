import { create } from "zustand";
import {
  currencyWithExchangeRate,
  sameCurrency,
} from "@/lib/currency-conversion";
import { loadCachedReferenceOptions } from "@/lib/reference-options-db";
import type { ReferenceOptionKind } from "@/lib/catalog-events";
import { buildEmployeeSettingsKey, loadCachedSettingsData } from "@/lib/settings-db";
import { fetchMyRegosDefaults, fetchRegosReferenceOptions } from "@/lib/settings-api";
import type {
  RegosCurrencyOption,
  RegosDefaultOption,
  RegosDefaults,
  RegosReferenceOptionsResponse,
} from "@/types/settings";

const EMPTY_OPTIONS: RegosReferenceOptionsResponse = {
  warehouses: [],
  price_types: [],
  partners: [],
  payment_categories: [],
  refund_payment_categories: [],
  attached_users: [],
  firms: [],
  currencies: [],
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

type TabSelection = {
  warehouseId: number | null;
  priceTypeId: number | null;
  partnerId: number | null;
  currencyId?: number | null;
};

type SellContextState = {
  scopeKey: string | null;
  warehouseId: number | null;
  priceTypeId: number | null;
  partnerId: number | null;
  /** Currency of catalog/cart prices (from selected price type). */
  priceCurrency: RegosCurrencyOption | null;
  /** Selected display / DocWholesale currency. */
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
  setSaleCurrencyId: (id: number | null) => void;
  applyTabSelection: (selection: TabSelection) => void;
  resetToDefaults: () => Promise<void>;
  refreshPartnerOptions: (token: string) => Promise<void>;
  refreshReferenceOptions: (token: string, kinds: ReferenceOptionKind[]) => Promise<void>;
  checkoutOverrides: () => {
    warehouse_id?: number;
    price_type_id?: number;
    partner_id?: number;
    currency_id?: number;
  };
  catalogQuery: () => {
    warehouseId?: number;
    priceTypeId?: number;
  };
};

function optionId(option: RegosDefaultOption | null | undefined): number | null {
  return option?.id ?? null;
}

function enrichCurrency(
  currency: RegosCurrencyOption | null | undefined,
  options: RegosReferenceOptionsResponse,
): RegosCurrencyOption | null {
  if (!currency) return null;
  return (
    currencyWithExchangeRate(currency, [
      ...options.currencies,
      ...options.price_types.map((item) => item.currency),
    ]) ?? currency
  );
}

function currencyForPriceType(
  priceTypeId: number | null,
  options: RegosReferenceOptionsResponse,
  fallback: RegosCurrencyOption | null = null,
): RegosCurrencyOption | null {
  if (!priceTypeId) return enrichCurrency(fallback, options);
  const priceType = options.price_types.find((item) => item.id === priceTypeId);
  return enrichCurrency(priceType?.currency ?? fallback, options);
}

function currencyById(
  currencyId: number | null | undefined,
  options: RegosReferenceOptionsResponse,
  fallback: RegosCurrencyOption | null = null,
): RegosCurrencyOption | null {
  if (currencyId == null || currencyId <= 0) return enrichCurrency(fallback, options);
  const fromList = options.currencies.find((item) => item.id === currencyId);
  if (fromList) return enrichCurrency(fromList, options);
  for (const priceType of options.price_types) {
    if (priceType.currency?.id === currencyId) {
      return enrichCurrency(priceType.currency, options);
    }
  }
  return enrichCurrency(fallback, options);
}

function scopeKeyForUser(userId: number | null | undefined, companyId: number | null | undefined) {
  if (userId == null) return null;
  return `${companyId ?? 0}:${userId}`;
}

function apiDefaultsFromRegosDefaults(defaults: RegosDefaults): ApiDefaults {
  return {
    warehouseId: optionId(defaults.warehouse),
    priceTypeId: optionId(defaults.price_type),
    partnerId: optionId(defaults.partner),
    saleCurrency: defaults.currency,
  };
}

function referenceOptionsFromIdb(
  cached: Awaited<ReturnType<typeof loadCachedReferenceOptions>>,
  existing: RegosReferenceOptionsResponse = EMPTY_OPTIONS,
): RegosReferenceOptionsResponse {
  if (!cached) return existing;
  return {
    ...existing,
    warehouses: cached.warehouses,
    price_types: cached.price_types,
    partners: cached.partners,
    payment_categories: cached.payment_categories ?? existing.payment_categories,
    refund_payment_categories:
      cached.refund_payment_categories ?? existing.refund_payment_categories,
    attached_users: cached.attached_users ?? existing.attached_users,
    firms: cached.firms ?? existing.firms,
    currencies: cached.currencies ?? existing.currencies,
  };
}

async function resolveSellContextState(
  token: string,
  canOverride: boolean,
  scopeKey: string | null,
  defaults: RegosDefaults,
  force: boolean,
  companyId: number | null | undefined,
) {
  const apiDefaults = apiDefaultsFromRegosDefaults(defaults);
  const cacheScope = companyId != null ? { companyId } : undefined;

  let referenceOptions = EMPTY_OPTIONS;
  if (canOverride) {
    if (!force && companyId != null) {
      const idb = await loadCachedReferenceOptions(companyId).catch(() => null);
      if (idb) {
        referenceOptions = referenceOptionsFromIdb(idb);
      }
    }
    const fetched = await fetchRegosReferenceOptions(token, { force, cacheScope });
    referenceOptions = {
      ...referenceOptions,
      warehouses: fetched.warehouses,
      price_types: fetched.price_types,
      partners: fetched.partners,
      payment_categories: fetched.payment_categories,
      refund_payment_categories: fetched.refund_payment_categories,
      attached_users: fetched.attached_users,
      firms: fetched.firms ?? [],
      currencies: fetched.currencies ?? [],
    };
  }

  const priceCurrency = currencyForPriceType(
    apiDefaults.priceTypeId,
    referenceOptions,
    apiDefaults.saleCurrency,
  );

  // Live selection starts at API defaults; checkout tabs own per-sale overrides.
  return {
    scopeKey,
    apiDefaults,
    warehouseId: apiDefaults.warehouseId,
    priceTypeId: apiDefaults.priceTypeId,
    partnerId: apiDefaults.partnerId,
    priceCurrency,
    saleCurrency: priceCurrency,
    options: canOverride ? referenceOptions : EMPTY_OPTIONS,
  };
}

let hydrateInflight: Promise<void> | null = null;
let hydrateInflightKey: string | null = null;
let lastHydratedKey: string | null = null;

export const useSellContext = create<SellContextState>((set, get) => ({
  scopeKey: null,
  warehouseId: null,
  priceTypeId: null,
  partnerId: null,
  priceCurrency: null,
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
    const cacheScope =
      companyId != null ? { companyId, ...(userId != null ? { userId } : {}) } : undefined;

    if (!token) {
      hydrateInflight = null;
      hydrateInflightKey = null;
      lastHydratedKey = null;
      set({
        scopeKey: null,
        warehouseId: null,
        priceTypeId: null,
        partnerId: null,
        priceCurrency: null,
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
      if (!force) {
        set({ hydrated: false, scopeKey });
      }

      const { suppressSellContextTabSync, useCheckoutTabs } = await import(
        "@/store/checkout-tabs"
      );

      const applyDefaultsWithoutWipingTabs = (
        nextState: Awaited<ReturnType<typeof resolveSellContextState>>,
        markHydrated: boolean,
      ) => {
        const tabsState = useCheckoutTabs.getState();
        const tabsOwnSelection = tabsState.hydrated && Boolean(tabsState.activeTabId);

        suppressSellContextTabSync(() => {
          if (tabsOwnSelection) {
            // Tabs already restored live selection — only refresh defaults/options.
            const current = get();
            const priceCurrency = currencyForPriceType(
              current.priceTypeId,
              nextState.options,
              nextState.apiDefaults.saleCurrency,
            );
            const saleCurrency =
              current.saleCurrency &&
              !sameCurrency(current.saleCurrency, priceCurrency)
                ? currencyById(current.saleCurrency.id, nextState.options, priceCurrency)
                : priceCurrency;
            set({
              scopeKey: nextState.scopeKey,
              apiDefaults: nextState.apiDefaults,
              options: nextState.options,
              warehouseId: current.warehouseId,
              priceTypeId: current.priceTypeId,
              partnerId: current.partnerId,
              priceCurrency,
              saleCurrency,
              ...(markHydrated ? { hydrated: true } : {}),
            });
            return;
          }

          set({
            ...nextState,
            ...(markHydrated ? { hydrated: true } : {}),
          });
        });
      };

      const restoreActiveTabSelection = () => {
        const tabsState = useCheckoutTabs.getState();
        if (!tabsState.hydrated || !tabsState.activeTabId) return;
        const active = tabsState.tabs.find((tab) => tab.id === tabsState.activeTabId);
        if (!active) return;
        const defaults = get().apiDefaults;
        suppressSellContextTabSync(() => {
          get().applyTabSelection({
            warehouseId:
              active.warehouseId !== undefined ? active.warehouseId : defaults.warehouseId,
            priceTypeId:
              active.priceTypeId !== undefined ? active.priceTypeId : defaults.priceTypeId,
            partnerId:
              active.partnerId !== undefined ? active.partnerId : defaults.partnerId,
            currencyId:
              active.currencyId !== undefined
                ? active.currencyId
                : defaults.saleCurrency?.id ?? null,
          });
        });
      };

      try {
        if (!force && cacheScope) {
          const idbKey = buildEmployeeSettingsKey(
            cacheScope.companyId,
            cacheScope.userId,
            "regos-defaults",
          );
          const cached = await loadCachedSettingsData<{ defaults: RegosDefaults }>(idbKey);
          if (cached?.defaults) {
            const nextState = await resolveSellContextState(
              token,
              canOverride,
              scopeKey,
              cached.defaults,
              false,
              companyId,
            );
            applyDefaultsWithoutWipingTabs(nextState, true);
          }
        }

        const defaultsRes = await fetchMyRegosDefaults(token, {
          force: true,
          cacheScope,
        });
        const nextState = await resolveSellContextState(
          token,
          canOverride,
          scopeKey,
          defaultsRes.defaults,
          force,
          companyId,
        );
        applyDefaultsWithoutWipingTabs(nextState, false);
      } catch {
        if (!get().hydrated) {
          suppressSellContextTabSync(() => {
            set({
              scopeKey,
              warehouseId: null,
              priceTypeId: null,
              partnerId: null,
              priceCurrency: null,
              saleCurrency: null,
              apiDefaults: {
                warehouseId: null,
                priceTypeId: null,
                partnerId: null,
                saleCurrency: null,
              },
              options: EMPTY_OPTIONS,
            });
          });
        }
      } finally {
        lastHydratedKey = key;
        set({ hydrated: true });
        hydrateInflight = null;
        hydrateInflightKey = null;

        // Tabs own live warehouse/price/partner; restore active tab after defaults reload.
        try {
          restoreActiveTabSelection();
        } catch {
          // Ignore; tabs may not be available yet.
        }
      }
    })();

    hydrateInflight = run;
    hydrateInflightKey = key;
    return run;
  },

  setWarehouseId: (id) => {
    set({ warehouseId: id });
  },

  setPriceTypeId: (id) => {
    set((state) => {
      const priceCurrency = currencyForPriceType(
        id,
        state.options,
        state.apiDefaults.saleCurrency,
      );
      return {
        priceTypeId: id,
        priceCurrency,
        // Price type change resets sale currency to the price-type currency.
        saleCurrency: priceCurrency,
      };
    });
  },

  setPartnerId: (id) => {
    set({ partnerId: id });
  },

  setSaleCurrencyId: (id) => {
    set((state) => ({
      saleCurrency: currencyById(id, state.options, state.priceCurrency),
    }));
  },

  applyTabSelection: (selection) => {
    const { options, apiDefaults } = get();
    const priceCurrency = currencyForPriceType(
      selection.priceTypeId,
      options,
      apiDefaults.saleCurrency,
    );
    const saleCurrency =
      selection.currencyId !== undefined
        ? currencyById(selection.currencyId, options, priceCurrency)
        : priceCurrency;
    set({
      warehouseId: selection.warehouseId,
      priceTypeId: selection.priceTypeId,
      partnerId: selection.partnerId,
      priceCurrency,
      saleCurrency,
    });
  },

  resetToDefaults: async () => {
    const { apiDefaults, options } = get();
    const priceCurrency = currencyForPriceType(
      apiDefaults.priceTypeId,
      options,
      apiDefaults.saleCurrency,
    );
    set({
      warehouseId: apiDefaults.warehouseId,
      priceTypeId: apiDefaults.priceTypeId,
      partnerId: apiDefaults.partnerId,
      priceCurrency,
      saleCurrency: priceCurrency,
    });
  },

  refreshPartnerOptions: async (token) => {
    await get().refreshReferenceOptions(token, ["partner"]);
  },

  refreshReferenceOptions: async (token, kinds) => {
    const companyId = get().scopeKey?.split(":")[0];
    const cacheScope =
      companyId != null && companyId !== "0" ? { companyId: Number(companyId) } : undefined;
    try {
      const options = await fetchRegosReferenceOptions(token, { force: true, cacheScope });
      set((state) => {
        const nextOptions = { ...state.options };
        if (kinds.includes("warehouse")) nextOptions.warehouses = options.warehouses;
        if (kinds.includes("price_type")) nextOptions.price_types = options.price_types;
        if (kinds.includes("partner")) nextOptions.partners = options.partners;
        if (options.currencies?.length) nextOptions.currencies = options.currencies;
        const priceCurrency = currencyForPriceType(
          state.priceTypeId,
          nextOptions,
          state.apiDefaults.saleCurrency,
        );
        return {
          options: nextOptions,
          priceCurrency,
          saleCurrency: kinds.includes("price_type")
            ? priceCurrency
            : currencyById(state.saleCurrency?.id ?? null, nextOptions, priceCurrency),
        };
      });
    } catch {
      // Keep existing options on refresh failure.
    }
  },

  checkoutOverrides: () => {
    const { warehouseId, priceTypeId, partnerId, saleCurrency } = get();
    const overrides: {
      warehouse_id?: number;
      price_type_id?: number;
      partner_id?: number;
      currency_id?: number;
    } = {};
    if (warehouseId) overrides.warehouse_id = warehouseId;
    if (priceTypeId) overrides.price_type_id = priceTypeId;
    if (partnerId) overrides.partner_id = partnerId;
    if (saleCurrency?.id) overrides.currency_id = saleCurrency.id;
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
