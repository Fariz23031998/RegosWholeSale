const TIME_24H = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Returns true if value is a valid 24-hour time (HH:MM). */
export function isValidScheduleTime(value: string): boolean {
  return TIME_24H.test(value.trim());
}

/** Normalizes a 24-hour time string to HH:MM, or null if invalid. */
export function normalizeScheduleTime(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
