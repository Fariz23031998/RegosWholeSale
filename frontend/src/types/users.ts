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
  schedules: ScheduleItemResponse[];
};

export type UserCreateRequest = {
  login: string;
  password: string;
  display_name: string;
  role?: UserRole;
  permission_codes?: string[];
  schedules?: ScheduleItem[];
};

export type UserUpdateRequest = {
  display_name?: string;
  password?: string;
  role?: UserRole;
  is_active?: boolean;
  permission_codes?: string[];
  schedules?: ScheduleItem[];
};

export type Permission = {
  id: number;
  code: string;
  description: string;
};

export const ROLE_DEFAULTS: Record<UserRole, readonly string[]> = {
  owner: [
    "pos.access",
    "pos.override_regos",
    "sales.read",
    "sales.write",
    "returns.manage",
    "dashboard.read",
    "settings.manage",
    "users.manage",
  ],
  admin: [
    "pos.access",
    "pos.override_regos",
    "sales.read",
    "sales.write",
    "returns.manage",
    "dashboard.read",
    "settings.manage",
    "users.manage",
  ],
  employee: ["pos.access", "sales.read", "sales.write"],
};

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function extraPermissionCodes(role: UserRole, effective: string[]): string[] {
  const defaults = new Set(ROLE_DEFAULTS[role]);
  return effective.filter((code) => !defaults.has(code));
}

export function formatScheduleSummary(schedules: ScheduleItem[]): string {
  if (schedules.length === 0) return "Anytime";
  const days = new Set(schedules.map((s) => s.day_of_week));
  if (days.size === 7) return `${schedules.length} window${schedules.length === 1 ? "" : "s"}`;
  const labels = [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]);
  return labels.join(", ");
}
