import type { StockDocKind } from "@/lib/stock-docs-api";

export type StockDocDefinition = {
  kind: StockDocKind;
  titleKey: string;
  titleFallback: string;
  subtitleKey: string;
  subtitleFallback: string;
  readPermission: string;
  writePermission: string;
  supportsCreate: boolean;
  supportsPartnerFilter: boolean;
  showCost: boolean;
  /** When false, cost is display-only (e.g. last purchase cost on inout lines). */
  editableCost: boolean;
  showPrice: boolean;
  showSenderReceiver: boolean;
  performedLabelKey: string;
  performedLabelFallback: string;
  draftLabelKey: string;
  draftLabelFallback: string;
};

export const STOCK_DOC_DEFINITIONS: Record<StockDocKind, StockDocDefinition> = {
  purchase: {
    kind: "purchase",
    titleKey: "stock.purchase.title",
    titleFallback: "Purchases",
    subtitleKey: "stock.purchase.subtitle",
    subtitleFallback: "{{count}} documents · {{period}} · {{warehouses}}",
    readPermission: "purchase.read",
    writePermission: "purchase.write",
    supportsCreate: true,
    supportsPartnerFilter: true,
    showCost: true,
    editableCost: true,
    showPrice: true,
    showSenderReceiver: false,
    performedLabelKey: "stock.status.performed",
    performedLabelFallback: "Performed",
    draftLabelKey: "stock.status.draft",
    draftLabelFallback: "Draft",
  },
  movement: {
    kind: "movement",
    titleKey: "stock.movement.title",
    titleFallback: "Movements",
    subtitleKey: "stock.movement.subtitle",
    subtitleFallback: "{{count}} documents · {{period}} · {{warehouses}}",
    readPermission: "movement.read",
    writePermission: "movement.write",
    supportsCreate: true,
    supportsPartnerFilter: false,
    showCost: false,
    editableCost: false,
    showPrice: false,
    showSenderReceiver: true,
    performedLabelKey: "stock.status.performed",
    performedLabelFallback: "Performed",
    draftLabelKey: "stock.status.draft",
    draftLabelFallback: "Draft",
  },
  inventory: {
    kind: "inventory",
    titleKey: "stock.inventory.title",
    titleFallback: "Inventories",
    subtitleKey: "stock.inventory.subtitle",
    subtitleFallback: "{{count}} documents · {{period}} · {{warehouses}}",
    readPermission: "inventory.read",
    writePermission: "inventory.write",
    supportsCreate: true,
    supportsPartnerFilter: false,
    showCost: false,
    editableCost: false,
    showPrice: false,
    showSenderReceiver: false,
    performedLabelKey: "stock.status.closed",
    performedLabelFallback: "Closed",
    draftLabelKey: "stock.status.open",
    draftLabelFallback: "Open",
  },
  wholesale: {
    kind: "wholesale",
    titleKey: "stock.wholesale.title",
    titleFallback: "Wholesale shipments",
    subtitleKey: "stock.wholesale.subtitle",
    subtitleFallback: "{{count}} documents · {{period}} · {{warehouses}}",
    readPermission: "sales.read",
    writePermission: "sales.write",
    supportsCreate: true,
    supportsPartnerFilter: true,
    showCost: false,
    editableCost: false,
    showPrice: true,
    showSenderReceiver: false,
    performedLabelKey: "stock.status.performed",
    performedLabelFallback: "Performed",
    draftLabelKey: "stock.status.draft",
    draftLabelFallback: "Draft",
  },
  inout: {
    kind: "inout",
    titleKey: "stock.inout.title",
    titleFallback: "In/Out",
    subtitleKey: "stock.inout.subtitle",
    subtitleFallback: "{{count}} documents · {{period}} · {{warehouses}}",
    readPermission: "inout.read",
    writePermission: "inout.write",
    supportsCreate: true,
    supportsPartnerFilter: false,
    showCost: true,
    editableCost: false,
    showPrice: false,
    showSenderReceiver: false,
    performedLabelKey: "stock.status.performed",
    performedLabelFallback: "Performed",
    draftLabelKey: "stock.status.draft",
    draftLabelFallback: "Draft",
  },
};

export function getStockDocDefinition(kind: StockDocKind): StockDocDefinition {
  return STOCK_DOC_DEFINITIONS[kind];
}

/** List path for a document kind (purchase → /purchases). */
export function stockDocListPath(
  kind: Exclude<StockDocKind, "wholesale">,
): "/purchases" | "/movements" | "/inventories" | "/inouts" {
  switch (kind) {
    case "purchase":
      return "/purchases";
    case "movement":
      return "/movements";
    case "inventory":
      return "/inventories";
    case "inout":
      return "/inouts";
  }
}

/** Detail path template for navigate({ to, params }). */
export function stockDocDetailTo(
  kind: Exclude<StockDocKind, "wholesale">,
): "/purchases/$id" | "/movements/$id" | "/inventories/$id" | "/inouts/$id" {
  switch (kind) {
    case "purchase":
      return "/purchases/$id";
    case "movement":
      return "/movements/$id";
    case "inventory":
      return "/inventories/$id";
    case "inout":
      return "/inouts/$id";
  }
}

export function formatInoutTypeLabel(
  inoutType: string | null | undefined,
  t: (key: string, fallback: string) => string,
): string {
  if (inoutType === "income") return t("stock.inout.income", "Receipt");
  if (inoutType === "outcome") return t("stock.inout.outcome", "Write-off");
  return "—";
}
