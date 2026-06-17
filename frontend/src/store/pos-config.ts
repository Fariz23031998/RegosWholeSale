import { create } from "zustand";
import { DEFAULT_TENDERED_QUICK_AMOUNTS } from "@/lib/tendered-amounts";
import { fetchPosSettings } from "@/lib/settings-api";

type PosConfigState = {
  allowOutOfStock: boolean;
  tenderedQuickAmounts: number[];
  hydrated: boolean;
  hydrate: (token: string | null) => Promise<void>;
};

export const usePosConfig = create<PosConfigState>((set) => ({
  allowOutOfStock: false,
  tenderedQuickAmounts: DEFAULT_TENDERED_QUICK_AMOUNTS,
  hydrated: false,
  hydrate: async (token) => {
    if (!token) {
      set({
        allowOutOfStock: false,
        tenderedQuickAmounts: DEFAULT_TENDERED_QUICK_AMOUNTS,
        hydrated: true,
      });
      return;
    }
    try {
      const res = await fetchPosSettings(token);
      const amounts = res.settings.tendered_quick_amounts;
      set({
        allowOutOfStock: res.settings.allow_out_of_stock,
        tenderedQuickAmounts:
          amounts.length > 0 ? amounts : DEFAULT_TENDERED_QUICK_AMOUNTS,
        hydrated: true,
      });
    } catch {
      set({
        allowOutOfStock: false,
        tenderedQuickAmounts: DEFAULT_TENDERED_QUICK_AMOUNTS,
        hydrated: true,
      });
    }
  },
}));
