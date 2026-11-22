import {
  CONFIGURABLE_PERMISSION_CODES,
  ROLE_DEFAULTS,
  type PermissionEffect,
  type PermissionRule,
  type UserRole,
} from "./users";

export type PermissionRuleState = "inherit" | PermissionEffect;

export type PermissionTemplate = {
  id: string;
  labelKey: string;
  fallback: string;
  descriptionKey: string;
  descriptionFallback: string;
  desiredCodes: readonly string[];
};

const PURCHASE_CODES = [
  "purchase.read",
  "purchase.write",
  "purchase.perform",
  "purchase.perform_cancel",
  "purchase.lock",
  "purchase.unlock",
] as const;

const MOVEMENT_CODES = [
  "movement.read",
  "movement.write",
  "movement.perform",
  "movement.perform_cancel",
  "movement.lock",
  "movement.unlock",
] as const;

const INVENTORY_CODES = [
  "inventory.read",
  "inventory.write",
  "inventory.perform",
  "inventory.perform_cancel",
  "inventory.lock",
  "inventory.unlock",
] as const;

const INOUT_CODES = [
  "inout.read",
  "inout.write",
  "inout.perform",
  "inout.perform_cancel",
  "inout.lock",
  "inout.unlock",
] as const;

const RETURN_TO_PARTNER_CODES = [
  "return_to_partner.read",
  "return_to_partner.write",
  "return_to_partner.perform",
  "return_to_partner.perform_cancel",
  "return_to_partner.lock",
  "return_to_partner.unlock",
] as const;

const STOCK_DOC_CODES = [
  ...PURCHASE_CODES,
  ...MOVEMENT_CODES,
  ...INVENTORY_CODES,
  ...INOUT_CODES,
  ...RETURN_TO_PARTNER_CODES,
] as const;

const CASHIER_CODES = [
  "pos.access",
  "sales.read",
  "sales.write",
  "payments.read",
  "payments.create",
  "shifts.manage_own",
] as const;

const SENIOR_CASHIER_CODES = [
  ...CASHIER_CODES,
  "sales.postpone",
  "sales.continue",
  "pos.apply_discount",
  "pos.modify_price",
  "pos.change_partner",
  "returns.manage",
  "documents.print",
  "labels.print",
  "labels.manage_own_print_settings",
] as const;

const WAREHOUSE_CODES = [
  "stock.item_info",
  "stock.item_create",
  "stock.item_edit",
  "prices.read",
  ...STOCK_DOC_CODES,
] as const;

const BUYER_CODES = [
  "stock.item_info",
  "stock.item_create",
  "stock.item_edit",
  "prices.read",
  "prices.write",
  ...PURCHASE_CODES,
] as const;

export const PERMISSION_TEMPLATES: PermissionTemplate[] = [
  {
    id: "cashier",
    labelKey: "users.permissions.templates.cashier.name",
    fallback: "Cashier",
    descriptionKey: "users.permissions.templates.cashier.description",
    descriptionFallback: "POS selling and basic payments without stock or price changes.",
    desiredCodes: CASHIER_CODES,
  },
  {
    id: "senior_cashier",
    labelKey: "users.permissions.templates.seniorCashier.name",
    fallback: "Senior cashier",
    descriptionKey: "users.permissions.templates.seniorCashier.description",
    descriptionFallback:
      "Trusted POS: discounts, returns, print, postpone sales, and change partner.",
    desiredCodes: SENIOR_CASHIER_CODES,
  },
  {
    id: "warehouse",
    labelKey: "users.permissions.templates.warehouse.name",
    fallback: "Warehouse",
    descriptionKey: "users.permissions.templates.warehouse.description",
    descriptionFallback: "Stock documents and products without POS selling or payment changes.",
    desiredCodes: WAREHOUSE_CODES,
  },
  {
    id: "buyer",
    labelKey: "users.permissions.templates.buyer.name",
    fallback: "Buyer",
    descriptionKey: "users.permissions.templates.buyer.description",
    descriptionFallback: "Purchases, products, and prices without other stock ops or POS selling.",
    desiredCodes: BUYER_CODES,
  },
  {
    id: "product_viewer",
    labelKey: "users.permissions.templates.productViewer.name",
    fallback: "Product viewer",
    descriptionKey: "users.permissions.templates.productViewer.description",
    descriptionFallback: "Browse products only — no edit, price changes, or printing.",
    desiredCodes: ["stock.item_info"],
  },
  {
    id: "employee_defaults",
    labelKey: "users.permissions.templates.employeeDefaults.name",
    fallback: "Employee defaults",
    descriptionKey: "users.permissions.templates.employeeDefaults.description",
    descriptionFallback: "Clear overrides and use the standard employee role defaults.",
    desiredCodes: ROLE_DEFAULTS.employee,
  },
];

/**
 * Build inherit/allow/deny UI state so the effective set matches `desiredCodes`
 * relative to the role defaults.
 */
export function rulesFromDesiredCodes(
  desiredCodes: readonly string[],
  role: UserRole = "employee",
): Record<string, PermissionRuleState> {
  const desired = new Set(desiredCodes);
  const defaults = new Set(ROLE_DEFAULTS[role]);
  const state: Record<string, PermissionRuleState> = {};

  for (const code of CONFIGURABLE_PERMISSION_CODES) {
    const want = desired.has(code);
    const isDefault = defaults.has(code);
    if (want && !isDefault) {
      state[code] = "allow";
    } else if (!want && isDefault) {
      state[code] = "deny";
    }
    // want && isDefault → inherit (omit)
    // !want && !isDefault → inherit (omit)
  }

  return state;
}

export function rulesFromDesiredCodesAsRules(
  desiredCodes: readonly string[],
  role: UserRole = "employee",
): PermissionRule[] {
  return Object.entries(rulesFromDesiredCodes(desiredCodes, role))
    .filter(([, effect]) => effect !== "inherit")
    .map(([code, effect]) => ({ code, effect: effect as PermissionEffect }));
}
