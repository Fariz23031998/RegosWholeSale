import { create } from "zustand";
import { DEFAULT_CATEGORY_ALL } from "@/lib/default-category";
import { DEFAULT_TENDERED_QUICK_AMOUNTS } from "@/lib/tendered-amounts";
import { fetchUserPosSettings } from "@/lib/settings-api";
import type { CrossCurrencyPaymentMode, DefaultCategorySetting, PostponeDocumentType } from "@/types/settings";

type HydrateOptions = {
  force?: boolean;
};

type PosConfigState = {
  allowOutOfStock: boolean;
  tenderedQuickAmounts: number[];
  autoOpenQtyKeypad: boolean;
  crossCurrencyPaymentMode: CrossCurrencyPaymentMode;
  internalBarcodeWeightPrefix: string;
  internalBarcodePiecePrefix: string;
  postponeDocumentType: PostponeDocumentType;
  defaultCategory: DefaultCategorySetting;
  hydrated: boolean;
  hydrate: (token: string | null, options?: HydrateOptions) => Promise<void>;
};

let hydrateInflight: Promise<void> | null = null;
let hydrateInflightKey: string | null = null;
let lastHydratedKey: string | null = null;

export const usePosConfig = create<PosConfigState>((set, get) => ({
  allowOutOfStock: false,
  tenderedQuickAmounts: DEFAULT_TENDERED_QUICK_AMOUNTS,
  autoOpenQtyKeypad: false,
  crossCurrencyPaymentMode: "payment_currency",
  internalBarcodeWeightPrefix: "22",
  internalBarcodePiecePrefix: "23",
  postponeDocumentType: "doc_wholesale",
  defaultCategory: DEFAULT_CATEGORY_ALL,
  hydrated: false,
  hydrate: async (token, options) => {
    const key = token ?? "";
    const force = options?.force ?? false;

    if (!token) {
      hydrateInflight = null;
      hydrateInflightKey = null;
      lastHydratedKey = null;
      set({
        allowOutOfStock: false,
        tenderedQuickAmounts: DEFAULT_TENDERED_QUICK_AMOUNTS,
        autoOpenQtyKeypad: false,
        crossCurrencyPaymentMode: "payment_currency",
        internalBarcodeWeightPrefix: "22",
        internalBarcodePiecePrefix: "23",
        postponeDocumentType: "doc_wholesale",
        defaultCategory: DEFAULT_CATEGORY_ALL,
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
      set({ hydrated: false });

      try {
        const res = await fetchUserPosSettings(token, { force });
        const amounts = res.settings.tendered_quick_amounts;
        set({
          allowOutOfStock: res.settings.allow_out_of_stock,
          tenderedQuickAmounts:
            amounts.length > 0 ? amounts : DEFAULT_TENDERED_QUICK_AMOUNTS,
          autoOpenQtyKeypad: res.settings.auto_open_qty_keypad,
          crossCurrencyPaymentMode:
            res.settings.cross_currency_payment_mode ?? "payment_currency",
          internalBarcodeWeightPrefix:
            res.settings.internal_barcode_weight_prefix ?? "22",
          internalBarcodePiecePrefix:
            res.settings.internal_barcode_piece_prefix ?? "23",
          postponeDocumentType:
            res.settings.postpone_document_type ?? "doc_wholesale",
          defaultCategory: res.settings.default_category,
        });
      } catch {
        set({
          allowOutOfStock: false,
          tenderedQuickAmounts: DEFAULT_TENDERED_QUICK_AMOUNTS,
          autoOpenQtyKeypad: false,
          crossCurrencyPaymentMode: "payment_currency",
          internalBarcodeWeightPrefix: "22",
          internalBarcodePiecePrefix: "23",
          postponeDocumentType: "doc_wholesale",
          defaultCategory: DEFAULT_CATEGORY_ALL,
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
}));
