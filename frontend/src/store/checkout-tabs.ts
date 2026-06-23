import { create } from "zustand";
import {
  loadCheckoutTabs,
  saveCheckoutTabs,
  type CheckoutTabData,
} from "@/lib/checkout-tabs-db";
import { useCart } from "@/store/cart";

const PERSIST_DEBOUNCE_MS = 300;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let skipCartPersist = false;
let cartUnsubscribe: (() => void) | null = null;

function createTabId(): string {
  return crypto.randomUUID();
}

function defaultTabLabel(index: number): string {
  return `Sale ${index}`;
}

function createEmptyTab(index: number): CheckoutTabData {
  const id = createTabId();
  return {
    id,
    label: defaultTabLabel(index),
    items: [],
    discountMode: "percent",
    discountValue: 0,
    updatedAt: Date.now(),
  };
}

function tabFromCartSnapshot(
  tab: CheckoutTabData,
  snapshot: ReturnType<typeof useCart.getState>["snapshot"],
): CheckoutTabData {
  return {
    ...tab,
    items: snapshot.items,
    discountMode: snapshot.discountMode,
    discountValue: snapshot.discountValue,
    postponedWholesaleDocId: snapshot.postponedWholesaleDocId,
    updatedAt: Date.now(),
  };
}

function scopeKeyForUser(userId: number | null, companyId: number | null): string | null {
  if (userId == null) return null;
  return `${companyId ?? 0}:${userId}`;
}

type CheckoutTabsState = {
  scopeKey: string | null;
  hydrated: boolean;
  activeTabId: string;
  tabs: CheckoutTabData[];
  hydrate: (userId: number | null, companyId: number | null) => Promise<void>;
  reset: () => void;
  switchTab: (tabId: string) => void;
  addTab: () => void;
  closeTab: (tabId: string) => void;
  clearActiveTabAfterCheckout: () => void;
  persistNow: () => Promise<void>;
};

function applyActiveTabToCart(tab: CheckoutTabData) {
  skipCartPersist = true;
  useCart.getState().restore({
    items: tab.items,
    discountMode: tab.discountMode,
    discountValue: tab.discountValue,
    postponedWholesaleDocId: tab.postponedWholesaleDocId ?? null,
  });
  queueMicrotask(() => {
    skipCartPersist = false;
  });
}

function syncActiveTabFromCart(
  tabs: CheckoutTabData[],
  activeTabId: string,
): CheckoutTabData[] {
  const snapshot = useCart.getState().snapshot();
  return tabs.map((tab) =>
    tab.id === activeTabId ? tabFromCartSnapshot(tab, snapshot) : tab,
  );
}

function schedulePersist(get: () => CheckoutTabsState) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void get().persistNow();
  }, PERSIST_DEBOUNCE_MS);
}

function ensureCartSubscription(get: () => CheckoutTabsState) {
  if (cartUnsubscribe) return;
  cartUnsubscribe = useCart.subscribe((state, prev) => {
    if (skipCartPersist) return;
    if (
      state.items === prev.items &&
      state.discountMode === prev.discountMode &&
      state.discountValue === prev.discountValue &&
      state.postponedWholesaleDocId === prev.postponedWholesaleDocId
    ) {
      return;
    }
    const { activeTabId, tabs, scopeKey, hydrated } = get();
    if (!hydrated || !scopeKey) return;

    const nextTabs = syncActiveTabFromCart(tabs, activeTabId);
    useCheckoutTabs.setState({ tabs: nextTabs });
    schedulePersist(get);
  });
}

export const useCheckoutTabs = create<CheckoutTabsState>((set, get) => ({
  scopeKey: null,
  hydrated: false,
  activeTabId: "",
  tabs: [],

  hydrate: async (userId, companyId) => {
    const scopeKey = scopeKeyForUser(userId, companyId);
    if (!scopeKey) {
      const tab = createEmptyTab(1);
      set({
        scopeKey: null,
        hydrated: true,
        activeTabId: tab.id,
        tabs: [tab],
      });
      applyActiveTabToCart(tab);
      ensureCartSubscription(get);
      return;
    }

    set({ hydrated: false, scopeKey });

    try {
      const stored = await loadCheckoutTabs(scopeKey);
      if (stored?.tabs.length) {
        const activeTab =
          stored.tabs.find((tab) => tab.id === stored.activeTabId) ??
          stored.tabs[0];
        set({
          activeTabId: activeTab.id,
          tabs: stored.tabs,
          hydrated: true,
        });
        applyActiveTabToCart(activeTab);
      } else {
        const tab = createEmptyTab(1);
        set({
          activeTabId: tab.id,
          tabs: [tab],
          hydrated: true,
        });
        applyActiveTabToCart(tab);
        await saveCheckoutTabs(scopeKey, {
          activeTabId: tab.id,
          tabs: [tab],
        });
      }
    } catch {
      const tab = createEmptyTab(1);
      set({
        activeTabId: tab.id,
        tabs: [tab],
        hydrated: true,
      });
      applyActiveTabToCart(tab);
    }

    ensureCartSubscription(get);
  },

  reset: () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    set({
      scopeKey: null,
      hydrated: false,
      activeTabId: "",
      tabs: [],
    });
  },

  switchTab: (tabId) => {
    const { activeTabId, tabs } = get();
    if (tabId === activeTabId) return;
    const target = tabs.find((tab) => tab.id === tabId);
    if (!target) return;

    const nextTabs = syncActiveTabFromCart(tabs, activeTabId);
    set({ tabs: nextTabs, activeTabId: tabId });
    applyActiveTabToCart(target);
    void get().persistNow();
  },

  addTab: () => {
    const { activeTabId, tabs } = get();
    const nextTabs = syncActiveTabFromCart(tabs, activeTabId);
    const tab = createEmptyTab(nextTabs.length + 1);
    set({
      tabs: [...nextTabs, tab],
      activeTabId: tab.id,
    });
    applyActiveTabToCart(tab);
    void get().persistNow();
  },

  closeTab: (tabId) => {
    const { activeTabId, tabs } = get();
    if (tabs.length <= 1) {
      const [onlyTab] = tabs;
      const clearedTab = {
        ...onlyTab,
        items: [],
        discountMode: "percent" as const,
        discountValue: 0,
        postponedWholesaleDocId: null,
        updatedAt: Date.now(),
      };
      set({ tabs: [clearedTab] });
      applyActiveTabToCart(clearedTab);
      void get().persistNow();
      return;
    }

    let nextTabs = syncActiveTabFromCart(tabs, activeTabId).filter(
      (tab) => tab.id !== tabId,
    );
    nextTabs = nextTabs.map((tab, index) => ({
      ...tab,
      label: defaultTabLabel(index + 1),
    }));

    let nextActiveId = activeTabId;
    if (tabId === activeTabId) {
      const closedIndex = tabs.findIndex((tab) => tab.id === tabId);
      const nextTab = nextTabs[Math.min(closedIndex, nextTabs.length - 1)];
      nextActiveId = nextTab.id;
      applyActiveTabToCart(nextTab);
    }

    set({ tabs: nextTabs, activeTabId: nextActiveId });
    void get().persistNow();
  },

  clearActiveTabAfterCheckout: () => {
    const { activeTabId, tabs } = get();
    const nextTabs = tabs.map((tab) =>
      tab.id === activeTabId
        ? {
            ...tab,
            items: [],
            discountMode: "percent" as const,
            discountValue: 0,
            postponedWholesaleDocId: null,
            updatedAt: Date.now(),
          }
        : tab,
    );
    set({ tabs: nextTabs });
    void get().persistNow();
  },

  persistNow: async () => {
    const { scopeKey, activeTabId, tabs, hydrated } = get();
    if (!hydrated || !scopeKey) return;

    const nextTabs = syncActiveTabFromCart(tabs, activeTabId);
    set({ tabs: nextTabs });

    try {
      await saveCheckoutTabs(scopeKey, {
        activeTabId,
        tabs: nextTabs,
      });
    } catch {
      // Ignore persistence errors; in-memory state remains available.
    }
  },
}));

export function checkoutTabItemCount(tab: CheckoutTabData): number {
  return tab.items.reduce((sum, item) => sum + item.qty, 0);
}
