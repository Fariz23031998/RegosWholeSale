import type { Product } from "@/types/catalog";
import { normalizeProductCode } from "@/lib/barcode";
import { isShortNumericCodeSearch } from "@/lib/catalog-search";

/** Multi-character Latin → Cyrillic digraphs (longest first). */
const LAT_TO_CYR_DIGRAPHS: Array<[string, string]> = [
  ["shch", "щ"],
  ["yo", "ё"],
  ["zh", "ж"],
  ["kh", "х"],
  ["ts", "ц"],
  ["ch", "ч"],
  ["sh", "ш"],
  ["yu", "ю"],
  ["ya", "я"],
  ["ye", "е"],
  ["yi", "и"],
  ["iy", "ий"],
  ["yy", "ый"],
  ["ay", "ай"],
  ["ey", "ей"],
  ["oy", "ой"],
  ["uy", "уй"],
];

const LAT_TO_CYR_SINGLE: Record<string, string> = {
  a: "а",
  b: "б",
  v: "в",
  w: "в",
  g: "г",
  d: "д",
  e: "е",
  z: "з",
  i: "и",
  j: "й",
  k: "к",
  l: "л",
  m: "м",
  n: "н",
  o: "о",
  p: "п",
  r: "р",
  s: "с",
  t: "т",
  u: "у",
  f: "ф",
  h: "х",
  c: "к",
  y: "ы",
  x: "кс",
  q: "к",
};

const CYR_TO_LAT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

const SCORE_EXACT_CODE = 1000;
const SCORE_EXACT_FIELD = 900;
const SCORE_CODE_PREFIX = 800;
const SCORE_PREFIX = 700;
const SCORE_SUBSTRING = 500;
const SCORE_TOKEN = 400;
const SCORE_FUZZY = 200;

export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function transliterateLatToCyr(text: string): string {
  const input = text.toLowerCase();
  let result = "";
  let i = 0;
  while (i < input.length) {
    let matched = false;
    for (const [latin, cyr] of LAT_TO_CYR_DIGRAPHS) {
      if (input.startsWith(latin, i)) {
        result += cyr;
        i += latin.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const ch = input[i];
    result += LAT_TO_CYR_SINGLE[ch] ?? ch;
    i += 1;
  }
  return result;
}

export function transliterateCyrToLat(text: string): string {
  let result = "";
  for (const ch of text.toLowerCase()) {
    result += CYR_TO_LAT[ch] ?? ch;
  }
  return result;
}

export function expandSearchVariants(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);
  const toCyr = normalizeSearchText(transliterateLatToCyr(normalized));
  const toLat = normalizeSearchText(transliterateCyrToLat(normalized));
  if (toCyr) variants.add(toCyr);
  if (toLat) variants.add(toLat);

  // Round-trip helps mixed-script queries and alternate spellings.
  const roundTripCyr = normalizeSearchText(transliterateLatToCyr(toLat));
  const roundTripLat = normalizeSearchText(transliterateCyrToLat(toCyr));
  if (roundTripCyr) variants.add(roundTripCyr);
  if (roundTripLat) variants.add(roundTripLat);

  return [...variants];
}

function fieldParts(product: Product): string[] {
  return [
    product.name,
    product.articul,
    product.sku,
    product.code,
    product.barcode,
    product.barcode_list,
  ]
    .filter((value): value is string => value != null && String(value).trim() !== "")
    .map((value) => String(value));
}

/**
 * Precomputed searchable blob: original + Latin + Cyrillic forms of all text fields.
 * Tokens are space-separated for prefix/token matching.
 */
export function buildProductSearchIndex(product: Product): string {
  const parts: string[] = [];
  for (const raw of fieldParts(product)) {
    const normalized = normalizeSearchText(raw);
    if (!normalized) continue;
    parts.push(normalized);
    const lat = normalizeSearchText(transliterateCyrToLat(normalized));
    const cyr = normalizeSearchText(transliterateLatToCyr(normalized));
    if (lat && lat !== normalized) parts.push(lat);
    if (cyr && cyr !== normalized) parts.push(cyr);
  }
  return parts.join(" ");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function maxEditDistance(tokenLength: number): number {
  if (tokenLength >= 6) return 2;
  if (tokenLength >= 4) return 1;
  return 0;
}

function scoreVariantAgainstIndex(variant: string, index: string, product: Product): number {
  if (!variant) return 0;

  const shortNumeric = isShortNumericCodeSearch(variant);
  const code = product.code != null ? normalizeSearchText(String(product.code)) : "";
  const barcode = product.barcode != null ? normalizeSearchText(String(product.barcode)) : "";
  const barcodeList =
    product.barcode_list != null ? normalizeSearchText(String(product.barcode_list)) : "";
  const name = product.name != null ? normalizeSearchText(String(product.name)) : "";
  const nameLat = normalizeSearchText(transliterateCyrToLat(name));
  const nameCyr = normalizeSearchText(transliterateLatToCyr(name));

  if (shortNumeric) {
    if (product.code != null && String(product.code).trim() !== "") {
      const normalizedCode = normalizeProductCode(product.code);
      const normalizedVariant = normalizeProductCode(variant);
      if (normalizedCode === normalizedVariant) return SCORE_EXACT_CODE;
    }
  } else if (code && code === variant) {
    return SCORE_EXACT_CODE;
  }

  if (barcode && barcode === variant) return SCORE_EXACT_CODE;
  if (barcodeList) {
    const barcodes = barcodeList.split(/\s+/).filter(Boolean);
    // Exact barcode tokens only for short numeric queries — substring includes("1")
    // falsely tops almost every product and buries real short codes after pagination.
    if (barcodes.includes(variant)) return SCORE_EXACT_CODE;
    if (!shortNumeric && barcodeList.includes(variant)) return SCORE_EXACT_CODE;
  }

  for (const field of [name, nameLat, nameCyr]) {
    if (field && field === variant) return SCORE_EXACT_FIELD;
  }

  let best = 0;

  if (shortNumeric && product.code != null && String(product.code).trim() !== "") {
    const normalizedCode = normalizeProductCode(product.code);
    const normalizedVariant = normalizeProductCode(variant);
    if (normalizedCode.startsWith(normalizedVariant)) {
      best = Math.max(best, SCORE_CODE_PREFIX);
    }
  }

  const indexTokens = index.split(/\s+/).filter(Boolean);

  for (const field of [name, nameLat, nameCyr, index]) {
    if (!field) continue;
    if (field.startsWith(variant)) {
      best = Math.max(best, SCORE_PREFIX);
    } else if (field.includes(variant)) {
      best = Math.max(best, SCORE_SUBSTRING);
    }
  }

  for (const token of indexTokens) {
    if (token.startsWith(variant)) {
      best = Math.max(best, SCORE_TOKEN + 50);
    } else if (token.includes(variant)) {
      best = Math.max(best, SCORE_TOKEN);
    } else {
      const maxDist = maxEditDistance(variant.length);
      if (maxDist > 0 && Math.abs(token.length - variant.length) <= maxDist) {
        const dist = levenshtein(variant, token);
        if (dist > 0 && dist <= maxDist) {
          best = Math.max(best, SCORE_FUZZY - dist * 10);
        }
      }
    }
  }

  return best;
}

/**
 * Returns a match score, or null when the product does not match the query.
 */
export function scoreCatalogMatch(
  query: string,
  index: string,
  product: Product,
): number | null {
  const variants = expandSearchVariants(query);
  if (variants.length === 0) return null;

  let best = 0;
  for (const variant of variants) {
    best = Math.max(best, scoreVariantAgainstIndex(variant, index, product));
  }
  return best > 0 ? best : null;
}
