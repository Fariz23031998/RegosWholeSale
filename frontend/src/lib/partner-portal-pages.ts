export const PARTNER_PORTAL_PAGE_KEYS = [
  "catalog",
  "create_orders",
  "dashboard",
  "orders",
  "purchases",
  "purchase_returns",
  "shipments",
  "shipment_returns",
  "payments",
  "reconciliation",
] as const;

export type PartnerPortalPageKey = (typeof PARTNER_PORTAL_PAGE_KEYS)[number];

export type PartnerEnabledPages = Record<PartnerPortalPageKey, boolean>;

/** Keys that map to partner portal routes / nav destinations. */
export const PARTNER_PORTAL_ROUTE_KEYS = PARTNER_PORTAL_PAGE_KEYS.filter(
  (key): key is Exclude<PartnerPortalPageKey, "create_orders"> => key !== "create_orders",
);

export const PARTNER_PORTAL_PAGE_META: Record<
  PartnerPortalPageKey,
  { labelKey: string; fallback: string; pathSuffix: string }
> = {
  catalog: { labelKey: "partnerApp.catalog", fallback: "Catalog", pathSuffix: "" },
  create_orders: {
    labelKey: "partnerApp.createOrders",
    fallback: "Create orders",
    pathSuffix: "",
  },
  dashboard: { labelKey: "partnerApp.dashboard", fallback: "Reports", pathSuffix: "/dashboard" },
  orders: { labelKey: "partnerApp.orders", fallback: "My orders", pathSuffix: "/orders" },
  purchases: { labelKey: "partnerApp.purchase", fallback: "Purchases", pathSuffix: "/purchases" },
  purchase_returns: {
    labelKey: "partnerApp.purchaseReturn",
    fallback: "Purchase returns",
    pathSuffix: "/purchase-returns",
  },
  shipments: { labelKey: "partnerApp.wholesale", fallback: "Shipments", pathSuffix: "/shipments" },
  shipment_returns: {
    labelKey: "partnerApp.wholesaleReturn",
    fallback: "Shipment returns",
    pathSuffix: "/shipment-returns",
  },
  payments: { labelKey: "partnerApp.payments", fallback: "Payments", pathSuffix: "/payments" },
  reconciliation: {
    labelKey: "partnerApp.reconciliation",
    fallback: "Reconciliation",
    pathSuffix: "/reconciliation",
  },
};

export function defaultEnabledPages(): PartnerEnabledPages {
  return {
    catalog: true,
    create_orders: true,
    dashboard: true,
    orders: true,
    purchases: true,
    purchase_returns: true,
    shipments: true,
    shipment_returns: true,
    payments: true,
    reconciliation: true,
  };
}

export function normalizeEnabledPages(value: Partial<Record<string, boolean>> | null | undefined): PartnerEnabledPages {
  const pages = defaultEnabledPages();
  if (!value || typeof value !== "object") return pages;
  for (const key of PARTNER_PORTAL_PAGE_KEYS) {
    if (key in value) pages[key] = Boolean(value[key]);
  }
  return pages;
}

export function normalizePageOverrides(
  value: Partial<Record<string, boolean>> | null | undefined,
): Partial<Record<PartnerPortalPageKey, boolean>> {
  if (!value || typeof value !== "object") return {};
  const overrides: Partial<Record<PartnerPortalPageKey, boolean>> = {};
  for (const key of PARTNER_PORTAL_PAGE_KEYS) {
    if (key in value) overrides[key] = Boolean(value[key]);
  }
  return overrides;
}

export function pageKeyFromPartnerPath(pathname: string, publicKey: string): PartnerPortalPageKey | null {
  const base = `/partner/${publicKey}`;
  if (pathname === base || pathname === `${base}/`) return "catalog";
  for (const key of PARTNER_PORTAL_ROUTE_KEYS) {
    if (key === "catalog") continue;
    const suffix = PARTNER_PORTAL_PAGE_META[key].pathSuffix;
    const path = `${base}${suffix}`;
    if (pathname === path || pathname.startsWith(`${path}/`)) return key;
  }
  return null;
}

export function firstEnabledPartnerPath(
  publicKey: string,
  enabledPages: Partial<Record<string, boolean>> | null | undefined,
): string | null {
  const pages = normalizeEnabledPages(enabledPages);
  for (const key of PARTNER_PORTAL_ROUTE_KEYS) {
    if (!pages[key]) continue;
    return `/partner/${publicKey}${PARTNER_PORTAL_PAGE_META[key].pathSuffix}`;
  }
  return null;
}
