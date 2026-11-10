import * as XLSX from "xlsx-js-style";
import type { TranslateFn } from "@/lib/dashboard-api";
import { formatDateTime } from "@/lib/format";
import type { PartnerDocumentLine, PartnerDocumentSummary } from "@/lib/partner-telegram-api";

const COL_COUNT = 5;
const TITLE_ROW = 0;
const META_START = 1;
const META_ROWS = 6;
const HEADER_ROW = META_START + META_ROWS;
const NUMERIC_COLS = new Set([2, 3, 4]);
const QTY_COLS = new Set([2]);

const COLORS = {
  primary: "4F46E5",
  primaryLight: "EEF2FF",
  white: "FFFFFF",
  text: "1E293B",
  textMuted: "64748B",
  border: "CBD5E1",
  headerBg: "F8FAFC",
  altRow: "F8FAFC",
  metaBg: "F8FAFC",
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

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-");
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

function formatWhen(date: number | null): string {
  if (!date || date <= 0) return "—";
  return formatDateTime(new Date(date * 1000).toISOString());
}

function columnHeaders(t: TranslateFn): string[] {
  return [
    t("stock.detail.table.code", "Code"),
    t("stock.detail.table.product", "Product"),
    t("stock.detail.table.qty", "Qty"),
    t("stock.detail.table.price", "Price"),
    t("common.amount", "Amount"),
  ];
}

export function exportPartnerDocumentToExcel(options: {
  title: string;
  document: PartnerDocumentSummary;
  lines: PartnerDocumentLine[];
  statusLabel: string;
  t: TranslateFn;
}): void {
  const { title, document, lines, statusLabel, t } = options;
  const meta: [string, string][] = [
    [t("common.date", "Date"), formatWhen(document.date)],
    [t("stock.table.warehouse", "Warehouse"), document.stock_name || "—"],
    [t("common.description", "Description"), document.description.trim() || "—"],
    [t("stock.table.status", "Status"), statusLabel],
    [t("common.total", "Total"), document.amount ?? "—"],
  ];

  const rows: (string | number)[][] = [[title]];
  for (const [label, value] of meta) {
    rows.push([label, value, "", "", ""]);
  }
  rows.push(columnHeaders(t));
  for (const line of lines) {
    rows.push([
      line.item_code || "",
      line.item_name,
      line.quantity,
      line.price,
      line.total,
    ]);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const dataStartRow = HEADER_ROW + 1;

  worksheet["!merges"] = [{ s: { r: TITLE_ROW, c: 0 }, e: { r: TITLE_ROW, c: COL_COUNT - 1 } }];
  worksheet["!cols"] = [{ wch: 14 }, { wch: 36 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];
  worksheet["!rows"] = [{ hpt: 30 }, ...Array.from({ length: META_ROWS }, () => ({ hpt: 18 })), { hpt: 28 }];
  worksheet["!freeze"] = {
    xSplit: 0,
    ySplit: HEADER_ROW + 1,
    topLeftCell: encodeCell(HEADER_ROW + 1, 0),
    activePane: "bottomLeft",
  };

  applyRowStyle(worksheet, TITLE_ROW, {
    font: { name: FONT, sz: 16, bold: true, color: { rgb: COLORS.white } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.primary } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(COLORS.primary),
  });

  for (let offset = 0; offset < META_ROWS; offset += 1) {
    const row = META_START + offset;
    applyCellStyle(worksheet, row, 0, {
      font: { name: FONT, sz: 10, bold: true, color: { rgb: COLORS.textMuted } },
      fill: { patternType: "solid", fgColor: { rgb: COLORS.metaBg } },
      alignment: { horizontal: "left", vertical: "center" },
      border: thinBorder(),
    });
    applyCellStyle(worksheet, row, 1, {
      font: { name: FONT, sz: 11, color: { rgb: COLORS.text } },
      fill: { patternType: "solid", fgColor: { rgb: COLORS.metaBg } },
      alignment: { horizontal: "left", vertical: "center", wrapText: true },
      border: thinBorder(),
      numFmt: offset === META_ROWS - 1 ? "#,##0.00" : "@",
    });
    for (let col = 2; col < COL_COUNT; col += 1) {
      applyCellStyle(worksheet, row, col, {
        fill: { patternType: "solid", fgColor: { rgb: COLORS.metaBg } },
        border: thinBorder(),
      });
    }
  }

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

  for (let offset = 0; offset < lines.length; offset += 1) {
    const row = dataStartRow + offset;
    const fill = offset % 2 === 1 ? COLORS.altRow : undefined;
    for (let col = 0; col < COL_COUNT; col += 1) {
      const isNumeric = NUMERIC_COLS.has(col);
      applyCellStyle(worksheet, row, col, {
        font: { name: FONT, sz: 11, color: { rgb: COLORS.text } },
        fill: fill ? { patternType: "solid", fgColor: { rgb: fill } } : undefined,
        alignment: {
          horizontal: isNumeric ? "right" : "left",
          vertical: "center",
          wrapText: col === 1,
        },
        border: thinBorder(),
        numFmt: QTY_COLS.has(col) ? "#,##0.##" : isNumeric ? "#,##0.00" : "@",
      });
    }
  }

  const workbook = XLSX.utils.book_new();
  const sheetName = sanitizeFileName(title).slice(0, 31) || "Document";
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const code = document.code?.trim() || String(document.id);
  XLSX.writeFile(workbook, `partner-document-${sanitizeFileName(code)}.xlsx`);
}
