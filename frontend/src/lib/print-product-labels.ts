import { renderLabelPage, renderLabelSheets } from "@/lib/label-template-engine";
import { printerNamesMatch } from "@/lib/label-templates-api";
import { fetchLabelRows, printProductLabels } from "@/lib/labels-api";
import type { LabelStation } from "@/types/label-templates";

export class ChooseLabelPrinterError extends Error {
  constructor() {
    super("choose-printer");
    this.name = "ChooseLabelPrinterError";
  }
}

export class RenderLabelError extends Error {
  constructor() {
    super("render");
    this.name = "RenderLabelError";
  }
}

export type LabelPrintTarget = {
  templateId: string;
  productIds: number[];
  copies: number;
  warehouseId?: number;
  priceTypeId?: number;
  useWarehouseQuantity?: boolean;
  /** When set (and not using warehouse quantity), expands each product by its copy count. */
  copiesByProductId?: Record<number, number>;
};

function clampLabelCopies(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(99, Math.max(1, Math.round(value)));
}

export function uniqueLabelProductIds(productIds: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of productIds) {
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function copiesForProduct(target: LabelPrintTarget, productId: number): number {
  if (target.copiesByProductId && productId in target.copiesByProductId) {
    return clampLabelCopies(target.copiesByProductId[productId] ?? 1);
  }
  return clampLabelCopies(target.copies);
}

export class NoLabelQuantityError extends Error {
  constructor() {
    super("no-quantity");
    this.name = "NoLabelQuantityError";
  }
}

export function stationsForPrinter(stations: LabelStation[], printerName: string): LabelStation[] {
  if (!printerName.trim()) return [];
  return stations.filter((station) =>
    station.printers.some(
      (printer) =>
        printer.enabled &&
        printer.kind === "label" &&
        printerNamesMatch(printer.name, printerName),
    ),
  );
}

export function labelPrinterNames(stations: LabelStation[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const station of stations) {
    for (const printer of station.printers) {
      if (!printer.enabled || printer.kind !== "label") continue;
      const name = printer.name.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

function labelJobBody(target: LabelPrintTarget) {
  return {
    template_id: target.templateId || null,
    product_ids: target.productIds,
    copies: target.copies,
    warehouse_id: target.warehouseId,
    price_type_id: target.priceTypeId,
    use_warehouse_quantity: Boolean(target.useWarehouseQuantity),
  };
}

export async function printLabelsWithService(
  token: string,
  target: LabelPrintTarget & {
    printerName: string;
    stationId: string;
    printerOverride: string;
    stations: LabelStation[];
  },
): Promise<void> {
  const productIds = uniqueLabelProductIds(target.productIds);
  if (
    target.copiesByProductId &&
    !target.useWarehouseQuantity &&
    productIds.length > 0
  ) {
    const byCopies = new Map<number, number[]>();
    for (const id of productIds) {
      const copies = copiesForProduct(target, id);
      const group = byCopies.get(copies);
      if (group) group.push(id);
      else byCopies.set(copies, [id]);
    }
    if (byCopies.size > 1) {
      for (const [copies, ids] of byCopies) {
        await printLabelsWithService(token, {
          ...target,
          productIds: ids,
          copies,
          copiesByProductId: undefined,
        });
      }
      return;
    }
    const onlyCopies = byCopies.keys().next().value;
    if (typeof onlyCopies === "number") {
      target = { ...target, productIds, copies: onlyCopies, copiesByProductId: undefined };
    }
  }

  const labelNames = labelPrinterNames(target.stations);
  const matched = stationsForPrinter(target.stations, target.printerName).length > 0;
  if (!matched && labelNames.length > 1 && !target.printerOverride) {
    throw new ChooseLabelPrinterError();
  }
  const stationIsValid = stationsForPrinter(target.stations, target.printerName).some(
    (station) => station.station_id === target.stationId,
  );
  const jobTarget = { ...target, productIds: uniqueLabelProductIds(target.productIds) };
  const response = await fetchLabelRows(token, labelJobBody(jobTarget));
  const source = {
    html: response.html,
    css: response.css,
    paper: { width_mm: response.width_mm, height_mm: response.height_mm },
    logos: response.logos ?? [],
  };
  let htmlPages: string[];
  try {
    htmlPages = response.rows.map((row) => renderLabelPage(source, row));
  } catch {
    throw new RenderLabelError();
  }
  await printProductLabels(token, {
    ...labelJobBody(jobTarget),
    station_id: stationIsValid ? target.stationId : null,
    printer_name: !matched && target.printerOverride ? target.printerOverride : target.printerName || null,
    html_pages: htmlPages,
  });
}

export async function renderLabelsInBrowser(token: string, target: LabelPrintTarget): Promise<string> {
  const productIds = uniqueLabelProductIds(target.productIds);
  const response = await fetchLabelRows(token, labelJobBody({ ...target, productIds }));
  const rows = response.rows.flatMap((row, index) => {
    const productId = productIds[index];
    const count = target.useWarehouseQuantity
      ? Math.min(99, Math.max(0, response.quantities?.[index] ?? 0))
      : productId != null && target.copiesByProductId
        ? copiesForProduct(target, productId)
        : Math.min(99, Math.max(1, target.copies));
    return Array.from({ length: count }, () => row);
  });
  if (rows.length === 0) {
    throw new NoLabelQuantityError();
  }
  try {
    return renderLabelSheets(
      {
        html: response.html,
        css: response.css,
        paper: { width_mm: response.width_mm, height_mm: response.height_mm },
        logos: response.logos ?? [],
      },
      rows,
    );
  } catch {
    throw new RenderLabelError();
  }
}
