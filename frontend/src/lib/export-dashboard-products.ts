import * as XLSX from "xlsx-js-style";
import type {
  DashboardProductRow,
  DashboardProductTotals,
  TranslateFn,
} from "@/lib/dashboard-api";

const COL_COUNT = 15;
const NUMERIC_COLS = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
const QTY_COLS = new Set([5, 8, 11]);

const TITLE_ROW = 0;
const PERIOD_ROW = 1;
const GROUP_ROW = 2;
const HEADER_ROW = 3;

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

function productRowValues(product: DashboardProductRow): (string | number)[] {
  return [
    product.code,
    product.name,
    product.category,
    product.purchase_cost ?? "",
    product.average_price,
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

function totalsRowValues(totals: DashboardProductTotals): (string | number)[] {
  return [
    "",
    "",
    "",
    "",
    "",
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

function productColumnHeaders(t: TranslateFn): string[] {
  return [
    t("dashboard.products.col.code"),
    t("dashboard.products.col.name"),
    t("dashboard.products.col.category"),
    t("dashboard.products.col.purchaseCost"),
    t("dashboard.products.col.avgPrice"),
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

function groupHeaderRow(t: TranslateFn): string[] {
  const row = Array<string>(COL_COUNT).fill("");
  row[0] = t("dashboard.products.title");
  row[5] = t("dashboard.products.group.sell");
  row[8] = t("dashboard.products.group.refund");
  row[11] = t("dashboard.products.group.net");
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
  toCol = COL_COUNT - 1,
): void {
  for (let col = fromCol; col <= toCol; col += 1) {
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

function numFmtForCol(col: number): string {
  if (QTY_COLS.has(col)) return "#,##0.##";
  if (NUMERIC_COLS.has(col)) return "#,##0.00";
  return "@";
}

function dataCellStyle(col: number, options?: { bold?: boolean; fill?: string }): CellStyle {
  const isNumeric = NUMERIC_COLS.has(col);
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
      numFmt: numFmtForCol(col),
    },
  );
}

function styleWorksheet(
  worksheet: XLSX.WorkSheet,
  dataStartRow: number,
  dataRowCount: number,
  hasTotalsRow: boolean,
): void {
  worksheet["!merges"] = [
    { s: { r: TITLE_ROW, c: 0 }, e: { r: TITLE_ROW, c: COL_COUNT - 1 } },
    { s: { r: PERIOD_ROW, c: 0 }, e: { r: PERIOD_ROW, c: COL_COUNT - 1 } },
    { s: { r: GROUP_ROW, c: 0 }, e: { r: GROUP_ROW, c: 4 } },
    { s: { r: GROUP_ROW, c: 5 }, e: { r: GROUP_ROW, c: 7 } },
    { s: { r: GROUP_ROW, c: 8 }, e: { r: GROUP_ROW, c: 10 } },
    { s: { r: GROUP_ROW, c: 11 }, e: { r: GROUP_ROW, c: COL_COUNT - 1 } },
  ];

  worksheet["!cols"] = [
    { wch: 14 },
    { wch: 34 },
    { wch: 18 },
    { wch: 14 },
    { wch: 12 },
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

  applyRowStyle(worksheet, TITLE_ROW, {
    font: { name: FONT, sz: 16, bold: true, color: { rgb: COLORS.white } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.primary } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(COLORS.primary),
  });

  applyRowStyle(worksheet, PERIOD_ROW, {
    font: { name: FONT, sz: 11, italic: true, color: { rgb: COLORS.textMuted } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.primaryLight } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(),
  });

  applySectionStyle(worksheet, GROUP_ROW, 0, 4, {
    font: { name: FONT, sz: 11, bold: true, color: { rgb: COLORS.text } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.groupNeutral } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(),
  });
  applySectionStyle(worksheet, GROUP_ROW, 5, 7, {
    font: { name: FONT, sz: 11, bold: true, color: { rgb: COLORS.groupSellAccent } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.groupSell } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(COLORS.groupSellAccent),
  });
  applySectionStyle(worksheet, GROUP_ROW, 8, 10, {
    font: { name: FONT, sz: 11, bold: true, color: { rgb: COLORS.groupRefundAccent } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.groupRefund } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(COLORS.groupRefundAccent),
  });
  applySectionStyle(worksheet, GROUP_ROW, 11, COL_COUNT - 1, {
    font: { name: FONT, sz: 11, bold: true, color: { rgb: COLORS.groupNetAccent } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.groupNet } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(COLORS.groupNetAccent),
  });

  for (let col = 0; col < COL_COUNT; col += 1) {
    const isSell = col >= 5 && col <= 7;
    const isRefund = col >= 8 && col <= 10;
    const isNet = col >= 11;
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
        horizontal: NUMERIC_COLS.has(col) ? "right" : "left",
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

    for (let col = 0; col < COL_COUNT; col += 1) {
      applyCellStyle(
        worksheet,
        row,
        col,
        dataCellStyle(col, { bold: isTotals, fill }),
      );
    }
  }
}

export function exportDashboardProductsToExcel(
  products: DashboardProductRow[],
  totals: DashboardProductTotals | null,
  t: TranslateFn,
  periodLabel: string,
): void {
  const headers = productColumnHeaders(t);
  const totalLabel = t("dashboard.products.totalRow", "Total");
  const title = t("dashboard.products.title", "Products");
  const subtitle = `${periodLabel} · ${t("dashboard.products.subtitle")}`;

  const rows: (string | number)[][] = [
    [title],
    [subtitle],
    groupHeaderRow(t),
    headers,
  ];

  const hasTotalsRow = totals !== null;
  if (totals) {
    rows.push([totalLabel, ...totalsRowValues(totals).slice(1)]);
  }

  for (const product of products) {
    rows.push(productRowValues(product));
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const dataStartRow = HEADER_ROW + 1;
  styleWorksheet(worksheet, dataStartRow, rows.length - dataStartRow, hasTotalsRow);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, t("dashboard.products.title", "Products"));
  const fileName = `dashboard-products-${sanitizeFileName(periodLabel)}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
