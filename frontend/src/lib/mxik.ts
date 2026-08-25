import { MxikClient } from "mxik";

export type MxikLookupResult = {
  icps: string;
  package_code: string | null;
  is_labeled: boolean;
  name: string | null;
};

export type MxikPackageOption = {
  code: string;
  name: string;
};

/** Regos item `name` max length (backend ItemCreate/Update). */
export const ITEM_NAME_MAX_LENGTH = 150;

function pickName(item: Record<string, unknown>): string | null {
  for (const key of ["mxikName", "attributeName", "brandName"] as const) {
    const value = item[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed.slice(0, ITEM_NAME_MAX_LENGTH);
    }
  }
  return null;
}

const GTIN_RE = /^\d{8,14}$/;
const IKPU_RE = /^\d{15,}$/;

function asDigitString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || !/^\d+$/.test(text)) return null;
  return text;
}

function coercePackageCode(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const nested = obj.code ?? obj.packageCode ?? obj.package_code;
    if (nested != null && nested !== "") return String(nested).trim() || null;
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function pickPackageDisplayName(item: Record<string, unknown>): string | null {
  for (const key of ["nameRu", "nameUz", "nameLat", "name", "packageName", "package_name"] as const) {
    const value = item[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function parsePackageOption(raw: unknown): MxikPackageOption | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string" || typeof raw === "number") {
    const code = coercePackageCode(raw);
    return code ? { code, name: code } : null;
  }
  if (typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const code = coercePackageCode(obj);
  if (!code) return null;
  const name = pickPackageDisplayName(obj) ?? code;
  return { code, name };
}

function parsePackagesField(raw: unknown): string | null {
  const options = parsePackageOptions(raw);
  return options[0]?.code ?? null;
}

function parsePackageOptions(raw: unknown): MxikPackageOption[] {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) {
    const seen = new Set<string>();
    const options: MxikPackageOption[] = [];
    for (const item of raw) {
      const option = parsePackageOption(item);
      if (!option || seen.has(option.code)) continue;
      seen.add(option.code);
      options.push(option);
    }
    return options;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      return parsePackageOptions(JSON.parse(trimmed) as unknown);
    } catch {
      const code = coercePackageCode(trimmed);
      return code ? [{ code, name: code }] : [];
    }
  }
  const single = parsePackageOption(raw);
  return single ? [single] : [];
}

function isLabeledFromLabel(label: unknown): boolean {
  return label === 1 || label === "1" || label === true;
}

function extractContentItems(response: unknown): Record<string, unknown>[] {
  if (!response || typeof response !== "object") return [];
  const data = (response as { data?: unknown }).data;
  if (!data) return [];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === "object") {
    const content = (data as { content?: unknown }).content;
    if (Array.isArray(content)) return content as Record<string, unknown>[];
  }
  return [];
}

function extractPackageNames(response: unknown): unknown {
  if (!response || typeof response !== "object") return null;
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  return (data as { packageNames?: unknown }).packageNames ?? null;
}

/**
 * Lookup IKPU / package / labeling from Tasnif by GTIN barcode (browser, via mxik).
 * Returns null when the barcode is not GTIN-shaped or no hit is found.
 */
export async function lookupByBarcode(barcode: string): Promise<MxikLookupResult | null> {
  const gtin = barcode.trim();
  if (!GTIN_RE.test(gtin)) return null;

  const mxik = new MxikClient();
  const response = await mxik.barcode(gtin);
  const first = extractContentItems(response)[0];
  if (!first) return null;

  const icps = asDigitString(first.mxikCode);
  if (!icps) return null;

  let package_code = parsePackagesField(first.packages);
  if (!package_code) {
    const packages = await listPackagesByIcps(icps);
    package_code = packages[0]?.code ?? null;
  }

  return {
    icps,
    package_code,
    is_labeled: isLabeledFromLabel(first.label),
    name: pickName(first),
  };
}

/**
 * Load package code options for an IKPU via mxik.code (packageNames).
 */
export async function listPackagesByIcps(icps: string): Promise<MxikPackageOption[]> {
  const code = icps.trim();
  if (!IKPU_RE.test(code) && !/^\d{8,}$/.test(code)) return [];

  const mxik = new MxikClient();
  const details = await mxik.code(code);
  return parsePackageOptions(extractPackageNames(details));
}

export function isGtinBarcode(barcode: string): boolean {
  return GTIN_RE.test(barcode.trim());
}
