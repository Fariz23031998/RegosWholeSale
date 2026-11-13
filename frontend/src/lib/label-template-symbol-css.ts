export const DEFAULT_BARCODE_HEIGHT_MM = 15;
export const DEFAULT_BARCODE_WIDTH_PERCENT = 100;
export const DEFAULT_QR_SIZE_MM = 12;

function clampMm(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(500, Math.max(1, value));
}

function formatMm(value: number): string {
  return `${clampMm(value)}mm`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BARCODE_WIDTH_PERCENT;
  return Math.min(100, Math.max(1, value));
}

function formatPercent(value: number): string {
  return `${clampPercent(value)}%`;
}

function findRule(css: string, selector: string): { index: number; full: string; body: string } | null {
  const escaped = selector.replace(/\./g, "\\.");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "i");
  const match = css.match(re);
  if (!match || match.index === undefined) return null;
  return { index: match.index, full: match[0], body: match[1] ?? "" };
}

/** Match a CSS property name without hitting suffixes (width vs max-width). */
function cssPropPattern(prop: string): string {
  const escaped = prop.replace(/-/g, "\\-");
  return `(^|[;{\\s])(${escaped}\\s*:\\s*)`;
}

function parseMmProp(body: string, prop: string): number | null {
  const re = new RegExp(`${cssPropPattern(prop)}([\\d.]+)\\s*mm`, "i");
  const match = body.match(re);
  if (!match) return null;
  const value = Number(match[3]);
  return Number.isFinite(value) ? value : null;
}

function parsePercentProp(body: string, prop: string): number | null {
  const re = new RegExp(`${cssPropPattern(prop)}([\\d.]+)\\s*%`, "i");
  const match = body.match(re);
  if (!match) return null;
  const value = Number(match[3]);
  return Number.isFinite(value) ? value : null;
}

function upsertCssProperty(body: string, prop: string, value: string): string {
  const propRe = new RegExp(`${cssPropPattern(prop)}[^;}]+`, "i");
  if (propRe.test(body)) {
    return body.replace(propRe, `$1$2${value}`);
  }
  const trimmed = body.trim();
  if (!trimmed) {
    return body.includes("\n") ? `\n  ${prop}: ${value};\n` : ` ${prop}: ${value}; `;
  }
  if (body.includes("\n")) {
    const base = body.replace(/\s*$/, "");
    const withSemi = /;\s*$/.test(base.trimEnd()) ? base : `${base};`;
    return `${withSemi}\n  ${prop}: ${value};\n`;
  }
  const base = trimmed.endsWith(";") ? trimmed : `${trimmed};`;
  return ` ${base} ${prop}: ${value}; `;
}

function removeCssProperty(body: string, prop: string): string {
  const re = new RegExp(`${cssPropPattern(prop)}[^;}]+;?`, "gi");
  return body
    .replace(re, "$1")
    .replace(/;;+/g, ";")
    .replace(/\n[ \t]*\n/g, "\n");
}

/**
 * 1D barcodes encode data horizontally — vertical stretch is safe.
 * Use explicit height + width with object-fit:fill so height is independent of PNG aspect ratio.
 * (object-fit:contain cannot grow bars when width is capped.)
 */
function ensureBarcodeSafeLayout(
  body: string,
  options?: { heightMm?: number; widthPercent?: number },
): string {
  const heightMm =
    options?.heightMm ??
    parseMmProp(body, "height") ??
    parseMmProp(body, "max-height") ??
    DEFAULT_BARCODE_HEIGHT_MM;
  const widthPercent =
    options?.widthPercent ??
    parsePercentProp(body, "width") ??
    parsePercentProp(body, "max-width") ??
    DEFAULT_BARCODE_WIDTH_PERCENT;

  let next = removeCssProperty(body, "max-height");
  next = upsertCssProperty(next, "height", formatMm(heightMm));
  next = upsertCssProperty(next, "width", formatPercent(widthPercent));
  next = upsertCssProperty(next, "max-width", "100%");
  next = upsertCssProperty(next, "object-fit", "fill");
  next = upsertCssProperty(next, "object-position", "center");
  return next;
}

function defaultBarcodeRule(heightMm: string, widthPercent: string): string {
  return (
    `img.barcode { height: ${heightMm}; width: ${widthPercent}; max-width: 100%; ` +
    `object-fit: fill; object-position: center; }`
  );
}

function replaceOrAppendRule(css: string, selector: string, nextFull: string): string {
  const existing = findRule(css, selector);
  if (!existing) {
    const trimmed = css.trimEnd();
    return trimmed ? `${trimmed}\n${nextFull}\n` : `${nextFull}\n`;
  }
  return css.slice(0, existing.index) + nextFull + css.slice(existing.index + existing.full.length);
}

function rebuildRule(selector: string, body: string, multiline: boolean): string {
  if (multiline) {
    const inner = body.startsWith("\n") ? body : `\n${body.trimEnd()}\n`;
    return `${selector} {${inner}}`;
  }
  const inner = body.trim() ? ` ${body.trim()} ` : " ";
  return `${selector} {${inner}}`;
}

export function parseBarcodeHeightMm(css: string): number {
  const rule = findRule(css, "img.barcode");
  if (!rule) return DEFAULT_BARCODE_HEIGHT_MM;
  return (
    parseMmProp(rule.body, "height") ??
    parseMmProp(rule.body, "max-height") ??
    DEFAULT_BARCODE_HEIGHT_MM
  );
}

export function parseBarcodeWidthPercent(css: string): number {
  const rule = findRule(css, "img.barcode");
  if (!rule) return DEFAULT_BARCODE_WIDTH_PERCENT;
  return (
    parsePercentProp(rule.body, "width") ??
    parsePercentProp(rule.body, "max-width") ??
    DEFAULT_BARCODE_WIDTH_PERCENT
  );
}

export function parseQrSizeMm(css: string): number {
  const rule = findRule(css, "img.qr");
  if (!rule) return DEFAULT_QR_SIZE_MM;
  return parseMmProp(rule.body, "height") ?? parseMmProp(rule.body, "width") ?? DEFAULT_QR_SIZE_MM;
}

export function setBarcodeHeightMm(css: string, heightMm: number): string {
  const existing = findRule(css, "img.barcode");
  if (!existing) {
    return replaceOrAppendRule(
      css,
      "img.barcode",
      defaultBarcodeRule(formatMm(heightMm), formatPercent(DEFAULT_BARCODE_WIDTH_PERCENT)),
    );
  }
  const multiline = existing.body.includes("\n");
  const nextBody = ensureBarcodeSafeLayout(existing.body, { heightMm });
  return replaceOrAppendRule(css, "img.barcode", rebuildRule("img.barcode", nextBody, multiline));
}

export function setBarcodeWidthPercent(css: string, widthPercent: number): string {
  const percent = clampPercent(widthPercent);
  const existing = findRule(css, "img.barcode");
  if (!existing) {
    return replaceOrAppendRule(
      css,
      "img.barcode",
      defaultBarcodeRule(formatMm(DEFAULT_BARCODE_HEIGHT_MM), formatPercent(percent)),
    );
  }
  const multiline = existing.body.includes("\n");
  const nextBody = ensureBarcodeSafeLayout(existing.body, { widthPercent: percent });
  return replaceOrAppendRule(css, "img.barcode", rebuildRule("img.barcode", nextBody, multiline));
}

export function setQrSizeMm(css: string, sizeMm: number): string {
  const value = formatMm(sizeMm);
  const existing = findRule(css, "img.qr");
  if (!existing) {
    return replaceOrAppendRule(css, "img.qr", `img.qr { height: ${value}; width: ${value}; }`);
  }
  const multiline = existing.body.includes("\n");
  let nextBody = upsertCssProperty(existing.body, "height", value);
  nextBody = upsertCssProperty(nextBody, "width", value);
  return replaceOrAppendRule(css, "img.qr", rebuildRule("img.qr", nextBody, multiline));
}
