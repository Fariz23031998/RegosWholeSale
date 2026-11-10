import * as XLSX from "xlsx-js-style";
import type { TranslateFn } from "@/lib/dashboard-api";
import { formatDateTime } from "@/lib/format";
import type { PartnerPayment } from "@/lib/partner-telegram-api";

const COL_COUNT = 6;
const TITLE_ROW = 0;
const SUBTITLE_ROW = 1;
const HEADER_ROW = 2;
const NUMERIC_COLS = new Set([5]);

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
    t("payments.table.code", "Code"),
    t("payments.table.date", "Date"),
    t("payments.paymentType", "Payment type"),
    t("payments.description", "Description"),
    t("payments.status", "Status"),
    t("payments.amount", "Amount"),
  ];
}

export function exportPartnerPaymentsToExcel(options: {
  title: string;
  subtitle: string;
  payments: PartnerPayment[];
  statusLabel: (payment: PartnerPayment) => string;
  t: TranslateFn;
}): void {
  const { title, subtitle, payments, statusLabel, t } = options;
  const sheetRows: (string | number)[][] = [[title], [subtitle], columnHeaders(t)];
  for (const payment of payments) {
    sheetRows.push([
      payment.code || String(payment.id),
      formatWhen(payment.date),
      payment.payment_type_name || "—",
      payment.description.trim() || "—",
      statusLabel(payment),
      payment.amount ?? 0,
    ]);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  const dataStartRow = HEADER_ROW + 1;

  worksheet["!merges"] = [
    { s: { r: TITLE_ROW, c: 0 }, e: { r: TITLE_ROW, c: COL_COUNT - 1 } },
    { s: { r: SUBTITLE_ROW, c: 0 }, e: { r: SUBTITLE_ROW, c: COL_COUNT - 1 } },
  ];
  worksheet["!cols"] = [
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 28 },
    { wch: 12 },
    { wch: 12 },
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

  for (let offset = 0; offset < payments.length; offset += 1) {
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
          wrapText: col === 3,
        },
        border: thinBorder(),
        numFmt: isNumeric ? "#,##0.00" : "@",
      });
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Payments");
  XLSX.writeFile(workbook, `partner-payments-${sanitizeFileName(subtitle)}.xlsx`);
}
