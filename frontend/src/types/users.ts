export type PermissionEffect = "allow" | "deny";

export type PermissionRule = {
  code: string;
  effect: PermissionEffect;
};

export type UserRole = "owner" | "admin" | "employee";

export type ScheduleItem = {
  day_of_week: number;
  start_time: string;
  end_time: string;
};

export type ScheduleItemResponse = ScheduleItem & {
  id: number;
};

export type UserDetail = {
  id: number;
  company_id: number;
  email: string | null;
  login: string | null;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  permissions: string[];
  permission_rules: PermissionRule[];
  schedules: ScheduleItemResponse[];
};

export type UserCreateRequest = {
  login: string;
  password: string;
  display_name: string;
  role?: UserRole;
  permission_rules?: PermissionRule[];
  schedules?: ScheduleItem[];
};

export type UserUpdateRequest = {
  display_name?: string;
  login?: string;
  password?: string;
  role?: UserRole;
  is_active?: boolean;
  permission_rules?: PermissionRule[];
  schedules?: ScheduleItem[];
};

export type Permission = {
  id: number;
  code: string;
  description: string;
};

const ALL_PERMISSION_CODES = [
  "pos.access",
  "pos.change_warehouse",
  "pos.change_price_type",
  "pos.change_partner",
  "pos.apply_discount",
  "pos.modify_price",
  "sales.read",
  "sales.write",
  "sales.postpone",
  "sales.continue",
  "payments.read",
  "payments.create",
  "payments.edit",
  "payments.delete",
  "returns.manage",
  "documents.print",
  "dashboard.read",
  "settings.manage",
  "users.manage",
  "stock.item_info",
  "stock.item_create",
  "stock.item_edit",
  "purchase.read",
  "purchase.write",
  "purchase.perform",
  "purchase.perform_cancel",
  "purchase.lock",
  "purchase.unlock",
  "movement.read",
  "movement.write",
  "movement.perform",
  "movement.perform_cancel",
  "movement.lock",
  "movement.unlock",
  "inventory.read",
  "inventory.write",
  "inventory.perform",
  "inventory.perform_cancel",
  "inventory.lock",
  "inventory.unlock",
  "inout.read",
  "inout.write",
  "inout.perform",
  "inout.perform_cancel",
  "inout.lock",
  "inout.unlock",
  "return_to_partner.read",
  "return_to_partner.write",
  "return_to_partner.perform",
  "return_to_partner.perform_cancel",
  "return_to_partner.lock",
  "return_to_partner.unlock",
] as const;

export const ROLE_DEFAULTS: Record<UserRole, readonly string[]> = {
  owner: ALL_PERMISSION_CODES,
  admin: ALL_PERMISSION_CODES,
  employee: [
    "pos.access",
    "sales.read",
    "sales.write",
    "payments.read",
    "payments.create",
    "payments.edit",
    "payments.delete",
    "stock.item_info",
    "stock.item_create",
    "stock.item_edit",
    "purchase.read",
    "purchase.write",
    "purchase.perform",
    "purchase.perform_cancel",
    "purchase.lock",
    "purchase.unlock",
    "movement.read",
    "movement.write",
    "movement.perform",
    "movement.perform_cancel",
    "movement.lock",
    "movement.unlock",
    "inventory.read",
    "inventory.write",
    "inventory.perform",
    "inventory.perform_cancel",
    "inventory.lock",
    "inventory.unlock",
    "inout.read",
    "inout.write",
    "inout.perform",
    "inout.perform_cancel",
    "inout.lock",
    "inout.unlock",
    "return_to_partner.read",
    "return_to_partner.write",
    "return_to_partner.perform",
    "return_to_partner.perform_cancel",
    "return_to_partner.lock",
    "return_to_partner.unlock",
  ],
};

export type PermissionGroup = {
  id: string;
  labelKey: string;
  fallback: string;
  codes: readonly string[];
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "pos",
    labelKey: "users.permissions.groups.pos",
    fallback: "POS access",
    codes: ["pos.access"],
  },
  {
    id: "posContext",
    labelKey: "users.permissions.groups.posContext",
    fallback: "Sell context",
    codes: ["pos.change_warehouse", "pos.change_price_type", "pos.change_partner"],
  },
  {
    id: "salesActions",
    labelKey: "users.permissions.groups.salesActions",
    fallback: "Sales actions",
    codes: [
      "sales.read",
      "sales.write",
      "sales.postpone",
      "sales.continue",
      "pos.apply_discount",
      "pos.modify_price",
    ],
  },
  {
    id: "documents",
    labelKey: "users.permissions.groups.documents",
    fallback: "Documents",
    codes: ["documents.print"],
  },
  {
    id: "returns",
    labelKey: "users.permissions.groups.returns",
    fallback: "Returns",
    codes: ["returns.manage"],
  },
  {
    id: "stock",
    labelKey: "users.permissions.groups.stock",
    fallback: "Stock",
    codes: [
      "stock.item_info",
      "stock.item_create",
      "stock.item_edit",
      "purchase.read",
      "purchase.write",
      "purchase.perform",
      "purchase.perform_cancel",
      "purchase.lock",
      "purchase.unlock",
      "return_to_partner.read",
      "return_to_partner.write",
      "return_to_partner.perform",
      "return_to_partner.perform_cancel",
      "return_to_partner.lock",
      "return_to_partner.unlock",
      "movement.read",
      "movement.write",
      "movement.perform",
      "movement.perform_cancel",
      "movement.lock",
      "movement.unlock",
      "inventory.read",
      "inventory.write",
      "inventory.perform",
      "inventory.perform_cancel",
      "inventory.lock",
      "inventory.unlock",
      "inout.read",
      "inout.write",
      "inout.perform",
      "inout.perform_cancel",
      "inout.lock",
      "inout.unlock",
    ],
  },
  {
    id: "payments",
    labelKey: "users.permissions.groups.payments",
    fallback: "Payments",
    codes: ["payments.read", "payments.create", "payments.edit", "payments.delete"],
  },
  {
    id: "administration",
    labelKey: "users.permissions.groups.administration",
    fallback: "Administration",
    codes: ["dashboard.read", "settings.manage", "users.manage"],
  },
];

export const CONFIGURABLE_PERMISSION_CODES = PERMISSION_GROUPS.flatMap((group) => group.codes);

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const DAY_LABEL_KEYS = [
  "users.days.mon",
  "users.days.tue",
  "users.days.wed",
  "users.days.thu",
  "users.days.fri",
  "users.days.sat",
  "users.days.sun",
] as const;

type TranslateFn = (
  key: string,
  fallback?: string,
  params?: Record<string, string | number>,
) => string;

export function getDayLabels(t: TranslateFn): string[] {
  return DAY_LABEL_KEYS.map((key, index) => t(key, DAY_LABELS[index]));
}

export function explicitPermissionRules(user: Pick<UserDetail, "permission_rules">): PermissionRule[] {
  return user.permission_rules ?? [];
}

export function permissionRuleMap(rules: PermissionRule[]): Map<string, PermissionEffect> {
  return new Map(rules.map((rule) => [rule.code, rule.effect]));
}

export function isRoleDefaultPermission(role: UserRole, code: string): boolean {
  return ROLE_DEFAULTS[role].includes(code);
}

export function formatScheduleSummary(schedules: ScheduleItem[], t: TranslateFn): string {
  if (schedules.length === 0) return t("users.schedule.anytime", "Anytime");
  const dayLabels = getDayLabels(t);
  const days = new Set(schedules.map((s) => s.day_of_week));
  if (days.size === 7) {
    return schedules.length === 1
      ? t("users.schedule.windowCount", "{{n}} window", { n: schedules.length })
      : t("users.schedule.windowCountPlural", "{{n}} windows", { n: schedules.length });
  }
  const labels = [...days].sort((a, b) => a - b).map((d) => dayLabels[d]);
  return labels.join(", ");
}

export type CheckoutOverridePermissions = {
  canChangeWarehouse: boolean;
  canChangePriceType: boolean;
  canChangePartner: boolean;
};

export function filterCheckoutOverrides(
  overrides: { warehouse_id?: number; price_type_id?: number; partner_id?: number },
  perms: CheckoutOverridePermissions,
): { warehouse_id?: number; price_type_id?: number; partner_id?: number } {
  const result: { warehouse_id?: number; price_type_id?: number; partner_id?: number } = {};
  if (perms.canChangeWarehouse && overrides.warehouse_id !== undefined) {
    result.warehouse_id = overrides.warehouse_id;
  }
  if (perms.canChangePriceType && overrides.price_type_id !== undefined) {
    result.price_type_id = overrides.price_type_id;
  }
  if (perms.canChangePartner && overrides.partner_id !== undefined) {
    result.partner_id = overrides.partner_id;
  }
  return result;
}
