import type { VatCalculationType } from "@/types/settings";

export type InventoryCompareType = "open_date" | "close_date" | "operation_date";

export const INVENTORY_COMPARE_TYPES: InventoryCompareType[] = [
  "open_date",
  "close_date",
  "operation_date",
];

/** Display/input format: dd.MM.yyyy HH:MM */
export const DATETIME_RU_PLACEHOLDER = "dd.MM.yyyy HH:MM";

const DATETIME_RU_RE =
  /^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2})(?::\d{2})?$/;

const pad2 = (value: number) => String(value).padStart(2, "0");

export function toDatetimeRuValue(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fromDatetimeRuValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = DATETIME_RU_RE.exec(trimmed);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hours > 23 ||
    minutes > 59
  ) {
    return null;
  }
  const d = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (
    Number.isNaN(d.getTime()) ||
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return Math.floor(d.getTime() / 1000);
}

export function nowDatetimeRuValue(): string {
  return toDatetimeRuValue(Math.floor(Date.now() / 1000));
}

/** Native `<input type="datetime-local">` value (yyyy-MM-ddTHH:mm). */
export function toNativeDatetimeLocalValue(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fromNativeDatetimeLocalValue(value: string): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const d = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

export function ruValueToNativeDatetimeLocal(ruValue: string): string {
  const unix = fromDatetimeRuValue(ruValue);
  if (unix == null) return toNativeDatetimeLocalValue(Math.floor(Date.now() / 1000));
  return toNativeDatetimeLocalValue(unix);
}

export function nativeDatetimeLocalToRuValue(nativeValue: string): string {
  const unix = fromNativeDatetimeLocalValue(nativeValue);
  if (unix == null) return "";
  return toDatetimeRuValue(unix);
}

export function isValidVatCalculationType(value: string): value is VatCalculationType {
  return value === "No" || value === "Exclude" || value === "Include";
}

export function isValidCompareType(value: string): value is InventoryCompareType {
  return INVENTORY_COMPARE_TYPES.includes(value as InventoryCompareType);
}
