import * as XLSX from "xlsx-js-style";
import { formatDateTime } from "@/lib/format";
import type { DashboardOutOfStockRow, TranslateFn } from "@/lib/dashboard-api";

const COL_COUNT = 9;
const TITLE_ROW = 0;
const SUBTITLE_ROW = 1;
const HEADER_ROW = 2;

const NUMERIC_COLS = new Set([4, 5, 6, 7]);
const QTY_COLS = new Set([4, 5]);

const COLORS = {
  primary: "4F46E5",
  primaryLight: "EEF2FF",
  white: "FFFFFF",
  text: "1E293B",
  textMuted: "64748B",
  border: "CBD5E1",
  headerBg: "F8FAFC",
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

function columnHeaders(t: TranslateFn): string[] {
  return [
    t("dashboard.outOfStock.columns.product"),
    t("dashboard.outOfStock.columns.code"),
    t("dashboard.outOfStock.columns.barcode"),
    t("dashboard.outOfStock.columns.warehouse"),
    t("dashboard.outOfStock.columns.quantity"),
    t("dashboard.outOfStock.columns.minQuantity"),
    t("dashboard.outOfStock.columns.lastPurchaseCost"),
    t("dashboard.outOfStock.columns.price"),
    t("dashboard.outOfStock.columns.detectedAt"),
  ];
}

function rowValues(row: DashboardOutOfStockRow): (string | number)[] {
  return [
    row.product_name,
    row.code,
    row.barcode,
    row.stock_name,
    row.quantity,
    row.min_quantity,
    row.last_purchase_cost ?? "",
    row.price,
    formatDateTime(row.detected_at),
  ];
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

function numFmtForCol(col: number): string {
  if (QTY_COLS.has(col)) return "#,##0.##";
  if (NUMERIC_COLS.has(col)) return "#,##0.00";
  return "@";
}

function dataCellStyle(col: number, options?: { fill?: string }): CellStyle {
  const isNumeric = NUMERIC_COLS.has(col);
  return {
    font: { name: FONT, sz: 11, color: { rgb: COLORS.text } },
    fill: options?.fill ? { patternType: "solid", fgColor: { rgb: options.fill } } : undefined,
    alignment: {
      horizontal: isNumeric ? "right" : "left",
      vertical: "center",
      wrapText: col === 0 || col === 3,
    },
    border: thinBorder(),
    numFmt: numFmtForCol(col),
  };
}

export function exportDashboardOutOfStockToExcel(
  products: DashboardOutOfStockRow[],
  t: TranslateFn,
  warehouseLabel: string,
): void {
  const title = t("dashboard.outOfStock.title");
  const rows: (string | number)[][] = [[title], [warehouseLabel], columnHeaders(t)];

  for (const product of products) {
    rows.push(rowValues(product));
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const dataStartRow = HEADER_ROW + 1;

  worksheet["!merges"] = [
    { s: { r: TITLE_ROW, c: 0 }, e: { r: TITLE_ROW, c: COL_COUNT - 1 } },
    { s: { r: SUBTITLE_ROW, c: 0 }, e: { r: SUBTITLE_ROW, c: COL_COUNT - 1 } },
  ];
  worksheet["!cols"] = [
    { wch: 34 },
    { wch: 14 },
    { wch: 18 },
    { wch: 22 },
    { wch: 12 },
    { wch: 14 },
    { wch: 18 },
    { wch: 12 },
    { wch: 20 },
  ];
  worksheet["!rows"] = [{ hpt: 30 }, { hpt: 20 }, { hpt: 28 }];
  worksheet["!freeze"] = {
    xSplit: 0,
    ySplit: HEADER_ROW + 1,
    topLeftCell: "A4",
    activePane: "bottomLeft",
  };

  applyRowStyle(worksheet, TITLE_ROW, {
    font: { name: FONT, sz: 16, bold: true, color: { rgb: COLORS.white } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.primary } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(COLORS.primary),
  });
  applyRowStyle(worksheet, SUBTITLE_ROW, {
    font: { name: FONT, sz: 11, italic: true, color: { rgb: COLORS.textMuted } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.primaryLight } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(),
  });

  for (let col = 0; col < COL_COUNT; col += 1) {
    applyCellStyle(worksheet, HEADER_ROW, col, {
      font: { name: FONT, sz: 10, bold: true, color: { rgb: COLORS.textMuted } },
      fill: { patternType: "solid", fgColor: { rgb: COLORS.headerBg } },
      alignment: {
        horizontal: NUMERIC_COLS.has(col) ? "right" : "left",
        vertical: "center",
        wrapText: true,
      },
      border: thinBorder(),
      numFmt: "@",
    });
  }

  const dataRowCount = rows.length - dataStartRow;
  for (let offset = 0; offset < dataRowCount; offset += 1) {
    const row = dataStartRow + offset;
    const fill = offset % 2 === 1 ? COLORS.altRow : undefined;

    for (let col = 0; col < COL_COUNT; col += 1) {
      applyCellStyle(worksheet, row, col, dataCellStyle(col, { fill }));
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, title.slice(0, 31));
  const fileName = `dashboard-out-of-stock-${sanitizeFileName(warehouseLabel)}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
