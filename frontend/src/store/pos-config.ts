import { create } from "zustand";
import { DEFAULT_TENDERED_QUICK_AMOUNTS } from "@/lib/tendered-amounts";
import { fetchUserPosSettings } from "@/lib/settings-api";
import type { CrossCurrencyPaymentMode } from "@/types/settings";

type PosConfigState = {
  allowOutOfStock: boolean;
  tenderedQuickAmounts: number[];
  autoOpenQtyKeypad: boolean;
  crossCurrencyPaymentMode: CrossCurrencyPaymentMode;
  hydrated: boolean;
  hydrate: (token: string | null) => Promise<void>;
};

export const usePosConfig = create<PosConfigState>((set) => ({
  allowOutOfStock: false,
  tenderedQuickAmounts: DEFAULT_TENDERED_QUICK_AMOUNTS,
  autoOpenQtyKeypad: false,
  crossCurrencyPaymentMode: "payment_currency",
  hydrated: false,
  hydrate: async (token) => {
    if (!token) {
      set({
        allowOutOfStock: false,
        tenderedQuickAmounts: DEFAULT_TENDERED_QUICK_AMOUNTS,
        autoOpenQtyKeypad: false,
        crossCurrencyPaymentMode: "payment_currency",
        hydrated: true,
      });
      return;
    }

    set({ hydrated: false });

    try {
      const res = await fetchUserPosSettings(token);
      const amounts = res.settings.tendered_quick_amounts;
      set({
        allowOutOfStock: res.settings.allow_out_of_stock,
        tenderedQuickAmounts:
          amounts.length > 0 ? amounts : DEFAULT_TENDERED_QUICK_AMOUNTS,
        autoOpenQtyKeypad: res.settings.auto_open_qty_keypad,
        crossCurrencyPaymentMode: res.settings.cross_currency_payment_mode ?? "payment_currency",
      });
    } catch {
      set({
        allowOutOfStock: false,
        tenderedQuickAmounts: DEFAULT_TENDERED_QUICK_AMOUNTS,
        autoOpenQtyKeypad: false,
        crossCurrencyPaymentMode: "payment_currency",
      });
    } finally {
      set({ hydrated: true });
    }
  },
}));
