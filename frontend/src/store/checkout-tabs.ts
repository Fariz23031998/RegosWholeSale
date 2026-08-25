import { create } from "zustand";
import {
  loadCheckoutTabs,
  saveCheckoutTabs,
  type CheckoutTabData,
} from "@/lib/checkout-tabs-db";
import { languageService } from "@/services/language";
import { useCart, type PostponedDocType } from "@/store/cart";
import { useSellContext } from "@/store/sell-context";

const PERSIST_DEBOUNCE_MS = 300;
const CHECKOUT_TABS_CHANNEL = "pulse-pos-checkout-tabs";

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let skipCartPersist = false;
let skipSellContextSync = false;
let cartUnsubscribe: (() => void) | null = null;
let sellContextUnsubscribe: (() => void) | null = null;
let crossWindowUnsubscribe: (() => void) | null = null;
const crossWindowSourceId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now());

function createTabId(): string {
  return crypto.randomUUID();
}

function defaultTabLabel(index: number): string {
  const template = languageService.t("cart.tabLabel", "Sale {{n}}");
  return template.replace(/\{\{n\}\}/g, String(index));
}

type TabSellContext = {
  warehouseId: number | null;
  priceTypeId: number | null;
  partnerId: number | null;
};

function defaultsSellContext(): TabSellContext {
  const { apiDefaults } = useSellContext.getState();
  return {
    warehouseId: apiDefaults.warehouseId,
    priceTypeId: apiDefaults.priceTypeId,
    partnerId: apiDefaults.partnerId,
  };
}

function withDefaultsSellContext(tab: CheckoutTabData): CheckoutTabData {
  const defaults = defaultsSellContext();
  return {
    ...tab,
    warehouseId: defaults.warehouseId,
    priceTypeId: defaults.priceTypeId,
    partnerId: defaults.partnerId,
    updatedAt: Date.now(),
  };
}

function resolveTabSellContext(tab: CheckoutTabData): TabSellContext {
  const defaults = defaultsSellContext();
  return {
    warehouseId: tab.warehouseId !== undefined ? tab.warehouseId : defaults.warehouseId,
    priceTypeId: tab.priceTypeId !== undefined ? tab.priceTypeId : defaults.priceTypeId,
    partnerId: tab.partnerId !== undefined ? tab.partnerId : defaults.partnerId,
  };
}

/**
 * Prevent sell-context updates (e.g. hydrate resetting to API defaults) from
 * overwriting the active tab's saved warehouse / price type / partner.
 * Zustand notifies subscribers synchronously inside set(), so the flag only
 * needs to stay true for the duration of `fn`.
 */
export function suppressSellContextTabSync(fn: () => void) {
  skipSellContextSync = true;
  try {
    fn();
  } finally {
    skipSellContextSync = false;
  }
}

function applyTabSellContext(tab: CheckoutTabData) {
  const resolved = resolveTabSellContext(tab);
  suppressSellContextTabSync(() => {
    useSellContext.getState().applyTabSelection(resolved);
  });
}

function createEmptyTab(index: number): CheckoutTabData {
  const id = createTabId();
  return withDefaultsSellContext({
    id,
    label: defaultTabLabel(index),
    items: [],
    discountMode: "percent",
    discountValue: 0,
    updatedAt: Date.now(),
  });
}

function resolvePostponedDocType(
  docId: number | null | undefined,
  docType: PostponedDocType | undefined,
): PostponedDocType {
  if (docId == null) return null;
  return docType ?? "wholesale";
}

function tabFromCartSnapshot(
  tab: CheckoutTabData,
  snapshot: ReturnType<ReturnType<typeof useCart.getState>["snapshot"]>,
): CheckoutTabData {
  return {
    ...tab,
    items: snapshot.items,
    discountMode: snapshot.discountMode,
    discountValue: snapshot.discountValue,
    postponedWholesaleDocId: snapshot.postponedWholesaleDocId,
    postponedDocType: resolvePostponedDocType(
      snapshot.postponedWholesaleDocId,
      snapshot.postponedDocType,
    ),
    updatedAt: Date.now(),
  };
}

function scopeKeyForUser(userId: number | null, companyId: number | null): string | null {
  if (userId == null) return null;
  return `${companyId ?? 0}:${userId}`;
}

function migrateTabSellContext(tab: CheckoutTabData): CheckoutTabData {
  if (
    tab.warehouseId !== undefined &&
    tab.priceTypeId !== undefined &&
    tab.partnerId !== undefined
  ) {
    return tab;
  }
  return withDefaultsSellContext(tab);
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
    postponedDocType: resolvePostponedDocType(
      tab.postponedWholesaleDocId,
      tab.postponedDocType,
    ),
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

export function getReservedQtyInOtherTabs(
  tabs: CheckoutTabData[],
  activeTabId: string,
  productId: string,
): number {
  return tabs.reduce((sum, tab) => {
    if (tab.id === activeTabId) return sum;
    const item = tab.items.find((entry) => entry.productId === productId);
    return sum + (item?.qty ?? 0);
  }, 0);
}

function broadcastCheckoutTabsUpdate(scopeKey: string) {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CHECKOUT_TABS_CHANNEL);
    channel.postMessage({ scopeKey, sourceId: crossWindowSourceId });
    channel.close();
  } catch {
    // Ignore broadcast failures; IndexedDB remains the source of truth.
  }
}

async function reloadCheckoutTabsFromStorage(get: () => CheckoutTabsState) {
  const { scopeKey, activeTabId, hydrated } = get();
  if (!hydrated || !scopeKey) return;

  try {
    const stored = await loadCheckoutTabs(scopeKey);
    if (!stored?.tabs.length) return;

    const tabs = stored.tabs.map(migrateTabSellContext);
    const activeTab =
      tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
    useCheckoutTabs.setState({ tabs });
    if (activeTab.id === activeTabId) {
      applyActiveTabToCart(activeTab);
      applyTabSellContext(activeTab);
    }
  } catch {
    // Ignore reload errors; in-memory state remains available.
  }
}

function ensureCrossWindowSync(get: () => CheckoutTabsState) {
  if (crossWindowUnsubscribe || typeof BroadcastChannel === "undefined") return;

  const channel = new BroadcastChannel(CHECKOUT_TABS_CHANNEL);
  channel.onmessage = (event) => {
    const { scopeKey, hydrated } = get();
    if (!hydrated || !scopeKey) return;
    if (event.data?.sourceId === crossWindowSourceId) return;
    if (event.data?.scopeKey !== scopeKey) return;
    void reloadCheckoutTabsFromStorage(get);
  };
  crossWindowUnsubscribe = () => {
    channel.close();
    crossWindowUnsubscribe = null;
  };
}

function ensureCartSubscription(get: () => CheckoutTabsState) {
  if (cartUnsubscribe) return;
  cartUnsubscribe = useCart.subscribe((state, prev) => {
    if (skipCartPersist) return;
    if (
      state.items === prev.items &&
      state.discountMode === prev.discountMode &&
      state.discountValue === prev.discountValue &&
      state.postponedWholesaleDocId === prev.postponedWholesaleDocId &&
      state.postponedDocType === prev.postponedDocType
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

function ensureSellContextSubscription(get: () => CheckoutTabsState) {
  if (sellContextUnsubscribe) return;
  sellContextUnsubscribe = useSellContext.subscribe((state, prev) => {
    if (skipSellContextSync) return;
    if (
      state.warehouseId === prev.warehouseId &&
      state.priceTypeId === prev.priceTypeId &&
      state.partnerId === prev.partnerId
    ) {
      return;
    }
    const { activeTabId, tabs, scopeKey, hydrated } = get();
    if (!hydrated || !scopeKey) return;

    const nextTabs = tabs.map((tab) =>
      tab.id === activeTabId
        ? {
            ...tab,
            warehouseId: state.warehouseId,
            priceTypeId: state.priceTypeId,
            partnerId: state.partnerId,
            updatedAt: Date.now(),
          }
        : tab,
    );
    useCheckoutTabs.setState({ tabs: nextTabs });
    // Persist immediately — context changes are rare and must survive refresh.
    void get().persistNow();
  });
}

function ensureSubscriptions(get: () => CheckoutTabsState) {
  ensureCartSubscription(get);
  ensureSellContextSubscription(get);
  ensureCrossWindowSync(get);
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
      applyTabSellContext(tab);
      ensureSubscriptions(get);
      return;
    }

    set({ hydrated: false, scopeKey });

    try {
      const stored = await loadCheckoutTabs(scopeKey);
      if (stored?.tabs.length) {
        const tabs = stored.tabs.map(migrateTabSellContext);
        const activeTab =
          tabs.find((tab) => tab.id === stored.activeTabId) ?? tabs[0];
        set({
          activeTabId: activeTab.id,
          tabs,
          hydrated: true,
        });
        applyActiveTabToCart(activeTab);
        applyTabSellContext(activeTab);
        // Persist migration of legacy tabs missing sell-context fields.
        if (tabs.some((tab, i) => tab !== stored.tabs[i])) {
          await saveCheckoutTabs(scopeKey, {
            activeTabId: activeTab.id,
            tabs,
          });
        }
      } else {
        const tab = createEmptyTab(1);
        set({
          activeTabId: tab.id,
          tabs: [tab],
          hydrated: true,
        });
        applyActiveTabToCart(tab);
        applyTabSellContext(tab);
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
      applyTabSellContext(tab);
    }

    ensureSubscriptions(get);
  },

  reset: () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    crossWindowUnsubscribe?.();
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
    applyTabSellContext(target);
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
    applyTabSellContext(tab);
    void get().persistNow();
  },

  closeTab: (tabId) => {
    const { activeTabId, tabs } = get();
    if (tabs.length <= 1) {
      const [onlyTab] = tabs;
      const clearedTab = withDefaultsSellContext({
        ...onlyTab,
        items: [],
        discountMode: "percent" as const,
        discountValue: 0,
        postponedWholesaleDocId: null,
        postponedDocType: null,
      });
      set({ tabs: [clearedTab] });
      applyActiveTabToCart(clearedTab);
      applyTabSellContext(clearedTab);
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
      applyTabSellContext(nextTab);
    }

    set({ tabs: nextTabs, activeTabId: nextActiveId });
    void get().persistNow();
  },

  clearActiveTabAfterCheckout: () => {
    const { activeTabId, tabs } = get();
    const nextTabs = tabs.map((tab) =>
      tab.id === activeTabId
        ? withDefaultsSellContext({
            ...tab,
            items: [],
            discountMode: "percent" as const,
            discountValue: 0,
            postponedWholesaleDocId: null,
            postponedDocType: null,
          })
        : tab,
    );
    const activeTab = nextTabs.find((tab) => tab.id === activeTabId) ?? nextTabs[0];
    set({ tabs: nextTabs });
    applyActiveTabToCart(activeTab);
    applyTabSellContext(activeTab);
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
      broadcastCheckoutTabsUpdate(scopeKey);
    } catch {
      // Ignore persistence errors; in-memory state remains available.
    }
  },
}));

export function checkoutTabItemCount(tab: CheckoutTabData): number {
  return tab.items.reduce((sum, item) => sum + item.qty, 0);
}
