import { create } from "zustand";
import { fetchMyRegosDefaults, fetchRegosReferenceOptions } from "@/lib/settings-api";
import type { RegosDefaultOption, RegosReferenceOptionsResponse } from "@/types/settings";

const EMPTY_OPTIONS: RegosReferenceOptionsResponse = {
  warehouses: [],
  price_types: [],
  partners: [],
  payment_categories: [],
  attached_users: [],
};

type SellContextState = {
  warehouseId: number | null;
  priceTypeId: number | null;
  partnerId: number | null;
  options: RegosReferenceOptionsResponse;
  hydrated: boolean;
  hydrate: (token: string | null, canOverride: boolean) => Promise<void>;
  setWarehouseId: (id: number | null) => void;
  setPriceTypeId: (id: number | null) => void;
  setPartnerId: (id: number | null) => void;
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

export const useSellContext = create<SellContextState>((set, get) => ({
  warehouseId: null,
  priceTypeId: null,
  partnerId: null,
  options: EMPTY_OPTIONS,
  hydrated: false,

  hydrate: async (token, canOverride) => {
    if (!token) {
      set({
        warehouseId: null,
        priceTypeId: null,
        partnerId: null,
        options: EMPTY_OPTIONS,
        hydrated: true,
      });
      return;
    }

    try {
      const defaultsRes = await fetchMyRegosDefaults(token);
      const defaults = defaultsRes.defaults;
      const next = {
        warehouseId: optionId(defaults.warehouse),
        priceTypeId: optionId(defaults.price_type),
        partnerId: optionId(defaults.partner),
        hydrated: true,
      };

      if (canOverride) {
        const options = await fetchRegosReferenceOptions(token);
        set({ ...next, options });
      } else {
        set({ ...next, options: EMPTY_OPTIONS });
      }
    } catch {
      set({
        warehouseId: null,
        priceTypeId: null,
        partnerId: null,
        options: EMPTY_OPTIONS,
        hydrated: true,
      });
    }
  },

  setWarehouseId: (id) => set({ warehouseId: id }),
  setPriceTypeId: (id) => set({ priceTypeId: id }),
  setPartnerId: (id) => set({ partnerId: id }),

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
