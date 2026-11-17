import { printerNamesMatch } from "@/lib/label-templates-api";
import { printDocument } from "@/lib/documents-api";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import { applyTemplateLineSort } from "@/lib/receipt-line-sort";
import { renderReceiptHtmlTemplate } from "@/lib/receipt-template-engine";
import type {
  DocumentStation,
  ReceiptFormat,
  ReceiptTemplate,
} from "@/types/receipt-templates";

export class ChooseReceiptPrinterError extends Error {
  constructor() {
    super("choose-printer");
    this.name = "ChooseReceiptPrinterError";
  }
}

export class RenderReceiptError extends Error {
  constructor(message = "render") {
    super(message);
    this.name = "RenderReceiptError";
  }
}

export function stationsForReceiptPrinter(
  stations: DocumentStation[],
  printerName: string,
): DocumentStation[] {
  if (!printerName.trim()) return [];
  return stations.filter((station) =>
    station.printers.some(
      (printer) =>
        printer.enabled &&
        printer.kind === "receipt" &&
        printerNamesMatch(printer.name, printerName),
    ),
  );
}

export function receiptPrinterNames(stations: DocumentStation[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const station of stations) {
    for (const printer of station.printers) {
      if (!printer.enabled || printer.kind !== "receipt") continue;
      const name = printer.name.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

function pageCssForFormat(format: ReceiptFormat): string {
  if (format === "a4") {
    return "@page { size: A4; margin: 15mm; } body { margin: 0; }";
  }
  return "@page { size: 80mm auto; margin: 4mm; } body { margin: 0; }";
}

function collectDocumentStyles(): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        chunks.push(rule.cssText);
      }
    } catch {
      // Ignore cross-origin stylesheets.
    }
  }
  return chunks.join("\n");
}

function wrapPrintDocument(bodyHtml: string, format: ReceiptFormat, extraCss = ""): string {
  const styles = [pageCssForFormat(format), extraCss].filter(Boolean).join("\n");
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8" />` +
    `<style>${styles}</style></head><body>${bodyHtml}</body></html>`
  );
}

/** Build a full HTML document for the Print Service. */
export function buildReceiptServiceHtml(options: {
  template: ReceiptTemplate;
  context: DocumentPrintContext;
  printRoot?: HTMLElement | null;
}): string {
  const { template, context, printRoot } = options;
  const sorted = applyTemplateLineSort(context, template.line_sort);

  if (template.engine === "html") {
    try {
      const html = renderReceiptHtmlTemplate(template, sorted);
      return wrapPrintDocument(html, template.format, template.css || "");
    } catch (err: unknown) {
      throw new RenderReceiptError(err instanceof Error ? err.message : "render");
    }
  }

  if (!printRoot) {
    throw new RenderReceiptError("Print preview is not ready.");
  }
  const markup = printRoot.innerHTML.trim();
  if (!markup) {
    throw new RenderReceiptError("Print preview is empty.");
  }
  return wrapPrintDocument(markup, template.format, collectDocumentStyles());
}

export async function printReceiptWithService(options: {
  token: string;
  template: ReceiptTemplate;
  context: DocumentPrintContext;
  printRoot?: HTMLElement | null;
  printerName: string;
  stationId: string;
  printerOverride: string;
  stations: DocumentStation[];
  copies?: number;
}): Promise<void> {
  const matched = stationsForReceiptPrinter(options.stations, options.printerName).length > 0;
  const receiptNames = receiptPrinterNames(options.stations);
  if (!matched && receiptNames.length > 1 && !options.printerOverride) {
    throw new ChooseReceiptPrinterError();
  }
  const stationIsValid = stationsForReceiptPrinter(options.stations, options.printerName).some(
    (station) => station.station_id === options.stationId,
  );
  const html = buildReceiptServiceHtml({
    template: options.template,
    context: options.context,
    printRoot: options.printRoot,
  });
  await printDocument(options.token, {
    template_id: options.template.id,
    html,
    copies: options.copies ?? 1,
    station_id: stationIsValid ? options.stationId || null : null,
    printer_name:
      !matched && options.printerOverride
        ? options.printerOverride
        : options.printerName || null,
  });
}
