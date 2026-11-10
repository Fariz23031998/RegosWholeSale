import Handlebars from "handlebars";
import { formatCurrency } from "@/lib/format";
import { createReceiptLogoImgMarkup } from "@/lib/receipt-template-logos";
import type { LabelTemplateLogo } from "@/types/label-templates";

export type LabelTemplateSource = {
  html: string;
  css?: string;
  paper?: {
    width_mm: number;
    height_mm: number;
  };
  logos?: LabelTemplateLogo[];
};

export type LabelRow = Record<string, unknown>;

const BODY_RE = /<body[^>]*>([\s\S]*?)<\/body>/i;
const HEAD_CLOSE_RE = /<\/head>/i;

let helpersRegistered = false;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) ? amount : null;
}

function wholeDigits(value: unknown): string {
  const amount = toFiniteNumber(value);
  if (amount === null) return "";
  return String(Math.trunc(Math.abs(amount)));
}

function toIndex(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const index = Number(value);
  return Number.isFinite(index) ? Math.trunc(index) : null;
}

function isHelperOptions(value: unknown): boolean {
  return typeof value === "object" && value !== null && "hash" in value && "data" in value;
}

function registerHelpers(): void {
  if (helpersRegistered) return;
  helpersRegistered = true;

  Handlebars.registerHelper("formatNumber", (value: unknown) => {
    const amount = toFiniteNumber(value);
    return amount === null ? "" : formatCurrency(amount);
  });

  Handlebars.registerHelper("numberPart", (value: unknown, start: unknown, end: unknown) => {
    const digits = wholeDigits(value);
    if (!digits) return "";
    const startIndex = toIndex(start);
    if (startIndex === null) return "";
    if (isHelperOptions(end)) return digits.slice(startIndex);
    const endIndex = toIndex(end);
    if (endIndex === null) return "";
    return digits.slice(startIndex, endIndex);
  });

  Handlebars.registerHelper("logoImg", function (name: unknown, maxWidth: unknown) {
    const options = arguments[arguments.length - 1] as Handlebars.HelperOptions;
    const logos = options.data.root.logos as LabelTemplateLogo[] | undefined;
    if (!logos?.length) return new Handlebars.SafeString("");

    const key = typeof name === "string" ? name.trim().toLowerCase() : "";
    const logo =
      logos.find((entry) => entry.name.trim().toLowerCase() === key) ??
      logos.find((entry) => entry.id === name);
    if (!logo) return new Handlebars.SafeString("");

    const widthOverride =
      typeof maxWidth === "number" && Number.isFinite(maxWidth) && maxWidth > 0
        ? Math.round(maxWidth)
        : logo.max_width;
    const markup = createReceiptLogoImgMarkup({
      ...logo,
      max_width: widthOverride ?? null,
    });
    return new Handlebars.SafeString(markup);
  });
}

function compile(source: string): HandlebarsTemplateDelegate {
  registerHelpers();
  // Keep every value escaped. Triple-stash and {{& }} would insert product text as HTML.
  const safeSource = source.replace(/\{\{\{/g, "{{").replace(/\{\{&/g, "{{").replace(/\}\}\}/g, "}}");
  return Handlebars.compile(safeSource, { noEscape: false });
}

function templateFragment(html: string): { styles: string; body: string } {
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n");
  const bodyMatch = html.match(BODY_RE);
  return { styles, body: bodyMatch ? bodyMatch[1] : html };
}

function insertCss(html: string, css: string): string {
  const sheet = css.trim();
  if (!sheet) return html;
  const style = `<style>\n${sheet}\n</style>`;
  if (HEAD_CLOSE_RE.test(html)) {
    return html.replace(HEAD_CLOSE_RE, `${style}\n</head>`);
  }
  return `${style}\n${html}`;
}

function labelContext(row: LabelRow, logos: LabelTemplateLogo[] | undefined): LabelRow {
  return { ...row, logos: logos ?? [] };
}

export function renderLabelSnippet(html: string, row: LabelRow, logos?: LabelTemplateLogo[]): string {
  return compile(html)(labelContext(row, logos));
}

/** One finished label document for the print service. */
export function renderLabelPage(template: LabelTemplateSource, row: LabelRow): string {
  return insertCss(
    compile(template.html || "")(labelContext(row, template.logos)),
    template.css ?? "",
  );
}

/** Browser print fragment: one .label-sheet per row, with page size from the template. */
export function renderLabelSheets(template: LabelTemplateSource, rows: LabelRow[]): string {
  const width = template.paper?.width_mm || 58;
  const height = template.paper?.height_mm || 40;
  const { styles: embedded, body } = templateFragment(template.html || "");
  const extra = (template.css ?? "").trim();
  const styles = extra && embedded ? `${extra}\n${embedded}` : extra || embedded;
  const compiled = compile(body);
  const pages = rows
    .map((row) => `<section class="label-sheet">${compiled(labelContext(row, template.logos))}</section>`)
    .join("");
  const pageCss =
    `@page productlabel { size: ${width}mm ${height}mm; margin: 0; }` +
    `.label-sheet { page: productlabel; width: ${width}mm; height: ${height}mm; overflow: hidden; break-after: page; }` +
    `.label-sheet:last-child { break-after: auto; }`;
  // After template CSS so it wins. A black-only printer drops gray and near-white text.
  const printInkCss =
    `.label-sheet { color-scheme: light; -webkit-font-smoothing: none; -moz-osx-font-smoothing: auto; }` +
    `.label-sheet, .label-sheet * { color: #000 !important; -webkit-text-fill-color: #000 !important; }`;
  return `<style>${pageCss}\n${styles}\n${printInkCss}</style>${pages}`;
}

export function renderLabelPreviewDocument(template: LabelTemplateSource, row: LabelRow): string {
  const fragment = renderLabelSheets(template, [row]);
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8" />` +
    `<style>html,body{margin:0;background:#fff}.label-sheet{overflow:visible!important}</style>` +
    `</head><body>${fragment}</body></html>`
  );
}
