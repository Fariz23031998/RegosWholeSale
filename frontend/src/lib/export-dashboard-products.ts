import * as XLSX from "xlsx-js-style";
import type {
  DashboardProductRow,
  DashboardProductTotals,
  TranslateFn,
} from "@/lib/dashboard-api";

const TITLE_ROW = 0;
const PERIOD_ROW = 1;
const GROUP_ROW = 2;
const HEADER_ROW = 3;

function columnLayout(includeWithoutDiscount: boolean) {
  const extra = includeWithoutDiscount ? 2 : 0;
  const colCount = 15 + extra;
  const productEnd = 4 + extra;
  const sellStart = productEnd + 1;
  const sellEnd = sellStart + 2;
  const refundStart = sellEnd + 1;
  const refundEnd = refundStart + 2;
  const netStart = refundEnd + 1;
  const qtyCols = new Set([sellStart, refundStart, netStart]);
  const numericCols = new Set<number>();
  for (let col = 3; col < colCount; col += 1) numericCols.add(col);
  return {
    colCount,
    productEnd,
    sellStart,
    sellEnd,
    refundStart,
    refundEnd,
    netStart,
    qtyCols,
    numericCols,
  };
}

type ColumnLayout = ReturnType<typeof columnLayout>;

const COLORS = {
  primary: "4F46E5",
  primaryLight: "EEF2FF",
  white: "FFFFFF",
  text: "1E293B",
  textMuted: "64748B",
  border: "CBD5E1",
  headerBg: "F8FAFC",
  groupNeutral: "E2E8F0",
  groupSell: "E0F2FE",
  groupSellAccent: "0EA5E9",
  groupRefund: "FEF3C7",
  groupRefundAccent: "F59E0B",
  groupNet: "D1FAE5",
  groupNetAccent: "10B981",
  totalBg: "EEF2FF",
  altRow: "F8FAFC",
} as const;

type CellStyle = {
  font?: {
    name?: string;
    sz?: number;
    bold?: boolean;
    italic?: boolean;
    color?: { rgb: string };
  };
  fill?: { patternType: "solid"; fgColor: { rgb: string } };
  alignment?: {
    horizontal?: "left" | "center" | "right";
    vertical?: "top" | "center" | "bottom";
    wrapText?: boolean;
  };
  border?: Partial<
    Record<"top" | "bottom" | "left" | "right", { style: string; color: { rgb: string } }>
  >;
  numFmt?: string;
};

const FONT = "Calibri";

function thinBorder(color = COLORS.border): CellStyle["border"] {
  const side = { style: "thin", color: { rgb: color } };
  return { top: side, bottom: side, left: side, right: side };
}

function mergeStyle(...parts: Partial<CellStyle>[]): CellStyle {
  return Object.assign({}, ...parts);
}

function productRowValues(
  product: DashboardProductRow,
  includeWithoutDiscount: boolean,
): (string | number)[] {
  return [
    product.code,
    product.name,
    product.category,
    product.purchase_cost ?? "",
    product.average_price,
    ...(includeWithoutDiscount
      ? [product.price_without_discount ?? 0, product.total_without_discount ?? 0]
      : []),
    product.sold_quantity,
    product.sold_purchase_cost,
    product.sold_total,
    product.refund_quantity,
    product.refund_purchase_cost,
    product.refund_total,
    product.net_sold_quantity,
    product.net_purchase_cost,
    product.net_total_sells,
    product.net_gross_profit,
  ];
}

function totalsRowValues(
  totals: DashboardProductTotals,
  includeWithoutDiscount: boolean,
): (string | number)[] {
  return [
    "",
    "",
    "",
    "",
    "",
    ...(includeWithoutDiscount ? ["", totals.total_without_discount ?? 0] : []),
    totals.sold_quantity,
    totals.sold_purchase_cost,
    totals.sold_total,
    totals.refund_quantity,
    totals.refund_purchase_cost,
    totals.refund_total,
    totals.net_sold_quantity,
    totals.net_purchase_cost,
    totals.net_total_sells,
    totals.net_gross_profit,
  ];
}

function productColumnHeaders(t: TranslateFn, includeWithoutDiscount: boolean): string[] {
  return [
    t("dashboard.products.col.code"),
    t("dashboard.products.col.name"),
    t("dashboard.products.col.category"),
    t("dashboard.products.col.purchaseCost"),
    t("dashboard.products.col.avgPrice"),
    ...(includeWithoutDiscount
      ? [
          t("dashboard.products.col.priceWithoutDiscount"),
          t("dashboard.products.col.totalWithoutDiscount"),
        ]
      : []),
    t("dashboard.products.col.qty"),
    t("dashboard.products.col.purchaseCost"),
    t("dashboard.products.col.totalSells"),
    t("dashboard.products.col.qty"),
    t("dashboard.products.col.purchaseCost"),
    t("dashboard.products.col.totalRefunds"),
    t("dashboard.products.col.qty"),
    t("dashboard.products.col.purchaseCost"),
    t("dashboard.products.col.totalSells"),
    t("dashboard.products.col.grossProfit"),
  ];
}

function groupHeaderRow(
  t: TranslateFn,
  productGroupTitle: string,
  layout: ColumnLayout,
): string[] {
  const row = Array<string>(layout.colCount).fill("");
  row[0] = productGroupTitle;
  row[layout.sellStart] = t("dashboard.products.group.sell");
  row[layout.refundStart] = t("dashboard.products.group.refund");
  row[layout.netStart] = t("dashboard.products.group.net");
  return row;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, "-");
}

function encodeCell(row: number, col: number): string {
  return XLSX.utils.encode_cell({ r: row, c: col });
}

function applyCellStyle(worksheet: XLSX.WorkSheet, row: number, col: number, style: CellStyle): void {
  const address = encodeCell(row, col);
  const cell = worksheet[address];
  if (!cell) return;
  cell.s = style;
}

function applyRowStyle(
  worksheet: XLSX.WorkSheet,
  row: number,
  style: CellStyle,
  fromCol = 0,
  toCol?: number,
  layout?: ColumnLayout,
): void {
  const lastCol = toCol ?? (layout?.colCount ?? 15) - 1;
  for (let col = fromCol; col <= lastCol; col += 1) {
    applyCellStyle(worksheet, row, col, style);
  }
}

function applySectionStyle(
  worksheet: XLSX.WorkSheet,
  row: number,
  fromCol: number,
  toCol: number,
  style: CellStyle,
): void {
  applyRowStyle(worksheet, row, style, fromCol, toCol);
}

function numFmtForCol(col: number, layout: ColumnLayout): string {
  if (layout.qtyCols.has(col)) return "#,##0.##";
  if (layout.numericCols.has(col)) return "#,##0.00";
  return "@";
}

function dataCellStyle(
  col: number,
  layout: ColumnLayout,
  options?: { bold?: boolean; fill?: string },
): CellStyle {
  const isNumeric = layout.numericCols.has(col);
  return mergeStyle(
    {
      font: {
        name: FONT,
        sz: 11,
        bold: options?.bold,
        color: { rgb: COLORS.text },
      },
      fill: options?.fill
        ? { patternType: "solid", fgColor: { rgb: options.fill } }
        : undefined,
      alignment: {
        horizontal: isNumeric ? "right" : "left",
        vertical: "center",
        wrapText: col === 1,
      },
      border: thinBorder(),
      numFmt: numFmtForCol(col, layout),
    },
  );
}

function styleWorksheet(
  worksheet: XLSX.WorkSheet,
  dataStartRow: number,
  dataRowCount: number,
  hasTotalsRow: boolean,
  layout: ColumnLayout,
): void {
  worksheet["!merges"] = [
    { s: { r: TITLE_ROW, c: 0 }, e: { r: TITLE_ROW, c: layout.colCount - 1 } },
    { s: { r: PERIOD_ROW, c: 0 }, e: { r: PERIOD_ROW, c: layout.colCount - 1 } },
    { s: { r: GROUP_ROW, c: 0 }, e: { r: GROUP_ROW, c: layout.productEnd } },
    { s: { r: GROUP_ROW, c: layout.sellStart }, e: { r: GROUP_ROW, c: layout.sellEnd } },
    { s: { r: GROUP_ROW, c: layout.refundStart }, e: { r: GROUP_ROW, c: layout.refundEnd } },
    { s: { r: GROUP_ROW, c: layout.netStart }, e: { r: GROUP_ROW, c: layout.colCount - 1 } },
  ];

  const extraCols = layout.colCount === 17 ? [{ wch: 20 }, { wch: 22 }] : [];
  worksheet["!cols"] = [
    { wch: 14 },
    { wch: 34 },
    { wch: 18 },
    { wch: 14 },
    { wch: 12 },
    ...extraCols,
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
  ];

  worksheet["!rows"] = [
    { hpt: 30 },
    { hpt: 20 },
    { hpt: 24 },
    { hpt: 28 },
  ];

  worksheet["!freeze"] = { xSplit: 0, ySplit: HEADER_ROW + 1, topLeftCell: "A5", activePane: "bottomLeft" };

  applyRowStyle(
    worksheet,
    TITLE_ROW,
    {
      font: { name: FONT, sz: 16, bold: true, color: { rgb: COLORS.white } },
      fill: { patternType: "solid", fgColor: { rgb: COLORS.primary } },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder(COLORS.primary),
    },
    0,
    layout.colCount - 1,
  );

  applyRowStyle(
    worksheet,
    PERIOD_ROW,
    {
      font: { name: FONT, sz: 11, italic: true, color: { rgb: COLORS.textMuted } },
      fill: { patternType: "solid", fgColor: { rgb: COLORS.primaryLight } },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder(),
    },
    0,
    layout.colCount - 1,
  );

  applySectionStyle(worksheet, GROUP_ROW, 0, layout.productEnd, {
    font: { name: FONT, sz: 11, bold: true, color: { rgb: COLORS.text } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.groupNeutral } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(),
  });
  applySectionStyle(worksheet, GROUP_ROW, layout.sellStart, layout.sellEnd, {
    font: { name: FONT, sz: 11, bold: true, color: { rgb: COLORS.groupSellAccent } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.groupSell } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(COLORS.groupSellAccent),
  });
  applySectionStyle(worksheet, GROUP_ROW, layout.refundStart, layout.refundEnd, {
    font: { name: FONT, sz: 11, bold: true, color: { rgb: COLORS.groupRefundAccent } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.groupRefund } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(COLORS.groupRefundAccent),
  });
  applySectionStyle(worksheet, GROUP_ROW, layout.netStart, layout.colCount - 1, {
    font: { name: FONT, sz: 11, bold: true, color: { rgb: COLORS.groupNetAccent } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.groupNet } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(COLORS.groupNetAccent),
  });

  for (let col = 0; col < layout.colCount; col += 1) {
    const isSell = col >= layout.sellStart && col <= layout.sellEnd;
    const isRefund = col >= layout.refundStart && col <= layout.refundEnd;
    const isNet = col >= layout.netStart;
    const accent = isSell
      ? COLORS.groupSell
      : isRefund
        ? COLORS.groupRefund
        : isNet
          ? COLORS.groupNet
          : COLORS.headerBg;

    applyCellStyle(worksheet, HEADER_ROW, col, {
      font: {
        name: FONT,
        sz: 10,
        bold: true,
        color: { rgb: isSell || isRefund || isNet ? COLORS.text : COLORS.textMuted },
      },
      fill: { patternType: "solid", fgColor: { rgb: accent } },
      alignment: {
        horizontal: layout.numericCols.has(col) ? "right" : "left",
        vertical: "center",
        wrapText: true,
      },
      border: thinBorder(),
      numFmt: "@",
    });
  }

  for (let offset = 0; offset < dataRowCount; offset += 1) {
    const row = dataStartRow + offset;
    const isTotals = hasTotalsRow && offset === 0;
    const isAlt = !isTotals && offset % 2 === (hasTotalsRow ? 1 : 0);
    const fill = isTotals ? COLORS.totalBg : isAlt ? COLORS.altRow : undefined;

    for (let col = 0; col < layout.colCount; col += 1) {
      applyCellStyle(
        worksheet,
        row,
        col,
        dataCellStyle(col, layout, { bold: isTotals, fill }),
      );
    }
  }
}

export type ExportDashboardProductsOptions = {
  title?: string;
  subtitle?: string;
  sheetName?: string;
  filePrefix?: string;
  includeWithoutDiscount?: boolean;
};

export function exportDashboardProductsToExcel(
  products: DashboardProductRow[],
  totals: DashboardProductTotals | null,
  t: TranslateFn,
  periodLabel: string,
  options?: ExportDashboardProductsOptions,
): void {
  const includeWithoutDiscount = Boolean(options?.includeWithoutDiscount);
  const layout = columnLayout(includeWithoutDiscount);
  const headers = productColumnHeaders(t, includeWithoutDiscount);
  const totalLabel = t("dashboard.products.totalRow", "Total");
  const title = options?.title ?? t("dashboard.products.title", "Products");
  const subtitle =
    options?.subtitle ?? `${periodLabel} · ${t("dashboard.products.subtitle")}`;
  const sheetName = (options?.sheetName ?? title).replace(/[\\/?*[\]]+/g, "-").slice(0, 31);
  const filePrefix = options?.filePrefix ?? "dashboard-products";

  const rows: (string | number)[][] = [
    [title],
    [subtitle],
    groupHeaderRow(t, title, layout),
    headers,
  ];

  const hasTotalsRow = totals !== null;
  if (totals) {
    rows.push([totalLabel, ...totalsRowValues(totals, includeWithoutDiscount).slice(1)]);
  }

  for (const product of products) {
    rows.push(productRowValues(product, includeWithoutDiscount));
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const dataStartRow = HEADER_ROW + 1;
  styleWorksheet(worksheet, dataStartRow, rows.length - dataStartRow, hasTotalsRow, layout);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName || "Products");
  const fileName = `${filePrefix}-${sanitizeFileName(periodLabel)}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
