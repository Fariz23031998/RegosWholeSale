import Handlebars from "handlebars";
import {
  amountToWordsText,
  formatAmountWithWordsText,
  normalizeAmountInWordsLanguage,
} from "@/lib/amount-in-words";
import { currencyLabel } from "@/lib/currency-conversion";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import type { ReceiptTemplate } from "@/types/receipt-templates";
import type { RegosCurrencyOption } from "@/types/settings";

const compiledCache = new Map<string, HandlebarsTemplateDelegate>();

function registerHelpers(): void {
  if ((Handlebars as typeof Handlebars & { __receiptHelpers?: boolean }).__receiptHelpers) {
    return;
  }

  Handlebars.registerHelper("formatCurrency", (value: unknown) => {
    const amount = typeof value === "number" ? value : Number(value);
    return Number.isFinite(amount) ? formatCurrency(amount) : "";
  });

  Handlebars.registerHelper("formatDate", (value: unknown) => {
    if (typeof value !== "string" || !value) return "";
    return formatDate(value);
  });

  Handlebars.registerHelper("formatDateTime", (value: unknown) => {
    if (typeof value !== "string" || !value) return "";
    return formatDateTime(value);
  });

  Handlebars.registerHelper(
    "formatAmountWithCurrency",
    (amount: unknown, currency: unknown) => {
      const numeric = typeof amount === "number" ? amount : Number(amount);
      if (!Number.isFinite(numeric)) return "";
      const label = currencyLabel(currency as RegosCurrencyOption | null | undefined);
      return label ? `${formatCurrency(numeric)} ${label}` : formatCurrency(numeric);
    },
  );

  Handlebars.registerHelper("eq", (left: unknown, right: unknown) => left === right);
  Handlebars.registerHelper("gt", (left: unknown, right: unknown) => Number(left) > Number(right));
  Handlebars.registerHelper("add", (left: unknown, right: unknown) => Number(left) + Number(right));

  Handlebars.registerHelper("formatRegosDate", (value: unknown) => {
    const timestamp = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
    const date = new Date(timestamp * 1000);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  });

  Handlebars.registerHelper("formatAmountInWords", function (amount: unknown, currency: unknown) {
    const options = arguments[arguments.length - 1] as Handlebars.HelperOptions;
    const language = normalizeAmountInWordsLanguage(options.data.root.amount_in_words_language);
    if (!language) return "";
    const numeric = typeof amount === "number" ? amount : Number(amount);
    if (!Number.isFinite(numeric)) return "";
    return amountToWordsText(numeric, currency as RegosCurrencyOption | null | undefined, language);
  });

  Handlebars.registerHelper(
    "formatAmountWithWords",
    function (amount: unknown, currency: unknown) {
      const options = arguments[arguments.length - 1] as Handlebars.HelperOptions;
      const language = normalizeAmountInWordsLanguage(options.data.root.amount_in_words_language);
      if (!language) return "";
      const numeric = typeof amount === "number" ? amount : Number(amount);
      if (!Number.isFinite(numeric)) return "";
      return formatAmountWithWordsText(
        numeric,
        currency as RegosCurrencyOption | null | undefined,
        language,
      );
    },
  );

  (Handlebars as typeof Handlebars & { __receiptHelpers?: boolean }).__receiptHelpers = true;
}

function compileTemplate(templateId: string, source: string): HandlebarsTemplateDelegate {
  const cached = compiledCache.get(templateId);
  if (cached) return cached;

  registerHelpers();
  const compiled = Handlebars.compile(source, { noEscape: false });
  compiledCache.set(templateId, compiled);
  return compiled;
}

export function invalidateReceiptTemplateCache(templateId?: string): void {
  if (templateId) {
    compiledCache.delete(templateId);
    return;
  }
  compiledCache.clear();
}

export function renderReceiptHtmlTemplate(
  template: ReceiptTemplate,
  context: DocumentPrintContext,
): string {
  const compiled = compileTemplate(template.id, template.html);
  const amountInWordsLanguage = normalizeAmountInWordsLanguage(template.amount_in_words_language);
  const documentCurrency = context.document.currency ?? context.sale.saleCurrency;
  const totalsAmount = context.totals.amount;

  const totalInWords = amountInWordsLanguage
    ? amountToWordsText(totalsAmount, documentCurrency, amountInWordsLanguage)
    : "";
  const totalWithWords = amountInWordsLanguage
    ? formatAmountWithWordsText(totalsAmount, documentCurrency, amountInWordsLanguage)
    : "";

  const sale = {
    ...context.sale,
    total_in_words: amountInWordsLanguage
      ? amountToWordsText(context.sale.total, context.sale.saleCurrency, amountInWordsLanguage)
      : "",
    total_with_words: amountInWordsLanguage
      ? formatAmountWithWordsText(
          context.sale.total,
          context.sale.saleCurrency,
          amountInWordsLanguage,
        )
      : "",
  };

  const totals = {
    ...context.totals,
    total_in_words: totalInWords,
    total_with_words: totalWithWords,
  };

  return compiled({
    ...context,
    sale,
    totals,
    total_in_words: totalInWords,
    total_with_words: totalWithWords,
    amount_in_words_language: amountInWordsLanguage,
    header: template.header,
    invoice_title: template.invoice_title,
    footer_text: template.footer_text,
  });
}

export function renderReceiptTemplate(
  template: ReceiptTemplate,
  context: DocumentPrintContext,
): { html: string; css: string } {
  if (template.engine !== "html") {
    return { html: "", css: "" };
  }

  return {
    html: renderReceiptHtmlTemplate(template, context),
    css: template.css,
  };
}
