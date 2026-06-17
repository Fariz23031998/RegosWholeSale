import { create } from "zustand";
import { persist } from "zustand/middleware";

type SettingsState = {
  autoOpenQtyKeypad: boolean;
  setAutoOpenQtyKeypad: (v: boolean) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      autoOpenQtyKeypad: false,
      setAutoOpenQtyKeypad: (v) => set({ autoOpenQtyKeypad: v }),
    }),
    { name: "pos-settings" },
  ),
);
