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

export function extraPermissionCodes(role: UserRole, effective: string[]): string[] {
  const defaults = new Set(ROLE_DEFAULTS[role]);
  return effective.filter((code) => !defaults.has(code));
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
