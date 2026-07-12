import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/checkout-tabs-db", () => ({
  loadCheckoutTabs: vi.fn(() => Promise.resolve(null)),
  saveCheckoutTabs: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/language", () => ({
  languageService: {
    t: (_key: string, fallback: string) => fallback,
  },
}));

vi.mock("@/lib/settings-api", () => ({
  fetchMyRegosDefaults: vi.fn(),
  fetchRegosReferenceOptions: vi.fn(),
}));

vi.mock("@/lib/settings-db", () => ({
  buildEmployeeSettingsKey: vi.fn(
    (companyId: number, userId: number | undefined, kind: string) =>
      `${companyId}:${userId ?? 0}:${kind}`,
  ),
  loadCachedSettingsData: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/lib/reference-options-db", () => ({
  loadCachedReferenceOptions: vi.fn(() => Promise.resolve(null)),
}));

import { loadCheckoutTabs, saveCheckoutTabs } from "@/lib/checkout-tabs-db";
import { fetchMyRegosDefaults, fetchRegosReferenceOptions } from "@/lib/settings-api";
import { useCart } from "@/store/cart";
import { useCheckoutTabs } from "@/store/checkout-tabs";
import { useSellContext } from "@/store/sell-context";

describe("checkout tabs per-tab sell context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCheckoutTabs.getState().reset();
    useCart.getState().clear();
    useSellContext.setState({
      scopeKey: "1:1",
      hydrated: true,
      warehouseId: 10,
      priceTypeId: 20,
      partnerId: 30,
      saleCurrency: null,
      apiDefaults: {
        warehouseId: 10,
        priceTypeId: 20,
        partnerId: 30,
        saleCurrency: null,
      },
      options: {
        warehouses: [
          { id: 10, name: "Main" },
          { id: 11, name: "Secondary" },
        ],
        price_types: [
          { id: 20, name: "Retail" },
          { id: 21, name: "Wholesale" },
        ],
        partners: [
          { id: 30, name: "Walk-in" },
          { id: 31, name: "VIP" },
        ],
        payment_categories: [],
        refund_payment_categories: [],
        attached_users: [],
        firms: [],
      },
    });
  });

  it("seeds new tabs with API defaults", async () => {
    await useCheckoutTabs.getState().hydrate(1, 1);
    const first = useCheckoutTabs.getState().tabs[0];
    expect(first.warehouseId).toBe(10);
    expect(first.priceTypeId).toBe(20);
    expect(first.partnerId).toBe(30);

    useSellContext.getState().setWarehouseId(11);
    useSellContext.getState().setPriceTypeId(21);
    useSellContext.getState().setPartnerId(31);
    // Allow sell-context subscription to sync active tab.
    await Promise.resolve();
    await Promise.resolve();

    useCheckoutTabs.getState().addTab();
    const { tabs, activeTabId } = useCheckoutTabs.getState();
    const active = tabs.find((tab) => tab.id === activeTabId)!;
    expect(active.warehouseId).toBe(10);
    expect(active.priceTypeId).toBe(20);
    expect(active.partnerId).toBe(30);
    expect(useSellContext.getState().warehouseId).toBe(10);
    expect(useSellContext.getState().priceTypeId).toBe(20);
    expect(useSellContext.getState().partnerId).toBe(30);
  });

  it("restores sell context when switching tabs", async () => {
    await useCheckoutTabs.getState().hydrate(1, 1);
    useSellContext.getState().setWarehouseId(11);
    useSellContext.getState().setPartnerId(31);
    await Promise.resolve();
    await Promise.resolve();

    const firstTabId = useCheckoutTabs.getState().activeTabId;
    useCheckoutTabs.getState().addTab();
    const secondTabId = useCheckoutTabs.getState().activeTabId;
    expect(secondTabId).not.toBe(firstTabId);
    expect(useSellContext.getState().warehouseId).toBe(10);

    useCheckoutTabs.getState().switchTab(firstTabId);
    expect(useSellContext.getState().warehouseId).toBe(11);
    expect(useSellContext.getState().partnerId).toBe(31);
  });

  it("resets active tab to defaults after checkout clear without wiping other tabs", async () => {
    await useCheckoutTabs.getState().hydrate(1, 1);
    useSellContext.getState().setWarehouseId(11);
    await Promise.resolve();
    await Promise.resolve();

    const firstTabId = useCheckoutTabs.getState().activeTabId;
    useCheckoutTabs.getState().addTab();
    useSellContext.getState().setWarehouseId(11);
    await Promise.resolve();
    await Promise.resolve();

    useCheckoutTabs.getState().clearActiveTabAfterCheckout();

    const state = useCheckoutTabs.getState();
    const active = state.tabs.find((tab) => tab.id === state.activeTabId)!;
    const other = state.tabs.find((tab) => tab.id === firstTabId)!;

    expect(active.warehouseId).toBe(10);
    expect(active.priceTypeId).toBe(20);
    expect(active.partnerId).toBe(30);
    expect(useSellContext.getState().warehouseId).toBe(10);

    expect(other.warehouseId).toBe(11);
  });

  it("persists tab sell context fields", async () => {
    await useCheckoutTabs.getState().hydrate(1, 1);
    useSellContext.getState().setWarehouseId(11);
    await Promise.resolve();
    await Promise.resolve();
    await useCheckoutTabs.getState().persistNow();

    expect(saveCheckoutTabs).toHaveBeenCalled();
    const lastCall = vi.mocked(saveCheckoutTabs).mock.calls.at(-1);
    expect(lastCall?.[1].tabs[0].warehouseId).toBe(11);
  });

  it("keeps tab partner after sell-context rehydrate (page refresh race)", async () => {
    const storedTab = {
      id: "tab-1",
      label: "Sale 1",
      items: [],
      discountMode: "percent" as const,
      discountValue: 0,
      warehouseId: 11,
      priceTypeId: 21,
      partnerId: 31,
      updatedAt: Date.now(),
    };
    vi.mocked(loadCheckoutTabs).mockResolvedValue({
      activeTabId: "tab-1",
      tabs: [storedTab],
    });
    vi.mocked(fetchMyRegosDefaults).mockResolvedValue({
      defaults: {
        warehouse: { id: 10, name: "Main" },
        price_type: { id: 20, name: "Retail" },
        partner: { id: 30, name: "Walk-in" },
        currency: null,
        firm: null,
        payment_category: null,
        refund_payment_category: null,
        attached_user: null,
        vat_calculation_type: "No",
        zero_quantity: false,
        zero_price: false,
      },
    });
    vi.mocked(fetchRegosReferenceOptions).mockResolvedValue({
      warehouses: [
        { id: 10, name: "Main" },
        { id: 11, name: "Secondary" },
      ],
      price_types: [
        { id: 20, name: "Retail" },
        { id: 21, name: "Wholesale" },
      ],
      partners: [
        { id: 30, name: "Walk-in" },
        { id: 31, name: "VIP" },
      ],
      payment_categories: [],
      refund_payment_categories: [],
      attached_users: [],
      firms: [],
    });

    await useCheckoutTabs.getState().hydrate(1, 1);
    expect(useSellContext.getState().partnerId).toBe(31);
    expect(useCheckoutTabs.getState().tabs[0].partnerId).toBe(31);

    // Simulate late defaults reload after tabs already restored selection.
    await useSellContext.getState().hydrate("token", true, {
      force: true,
      userId: 1,
      companyId: 1,
    });

    expect(useSellContext.getState().partnerId).toBe(31);
    expect(useSellContext.getState().warehouseId).toBe(11);
    expect(useSellContext.getState().priceTypeId).toBe(21);
    expect(useCheckoutTabs.getState().tabs[0].partnerId).toBe(31);
    expect(useCheckoutTabs.getState().tabs[0].warehouseId).toBe(11);
    expect(useCheckoutTabs.getState().tabs[0].priceTypeId).toBe(21);
  });
});
