import * as XLSX from "xlsx-js-style";
import type { TranslateFn } from "@/lib/dashboard-api";
import { currencyLabel } from "@/lib/currency-conversion";
import { formatDateTime } from "@/lib/format";
import type { PartnerBalanceRow } from "@/types/partners";

const COL_COUNT = 8;
const TITLE_ROW = 0;
const PERIOD_ROW = 1;
const HEADER_ROW = 2;
const NUMERIC_COLS = new Set([4, 5, 6, 7]);

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
    t("partners.balance.colCurrency", "Currency"),
    t("partners.balance.colDocumentType", "Document type"),
    t("partners.balance.colDocumentCode", "Document code"),
    t("partners.balance.colDate", "Date"),
    t("partners.balance.colOpening", "Opening balance"),
    t("partners.balance.colDebit", "Debit"),
    t("partners.balance.colCredit", "Credit"),
    t("partners.balance.colClosing", "Closing balance"),
  ];
}

function rowValues(row: PartnerBalanceRow): (string | number)[] {
  return [
    row.currency ? currencyLabel(row.currency) || "—" : "—",
    row.document_type?.name || "—",
    row.document_code || (row.document_id != null ? String(row.document_id) : "—"),
    formatWhen(row.date),
    row.start_amount,
    row.debit,
    row.credit,
    row.end_amount,
  ];
}

export function exportPartnerReconciliationToExcel(options: {
  title: string;
  periodLabel: string;
  rows: PartnerBalanceRow[];
  t: TranslateFn;
}): { workbook: XLSX.WorkBook; filename: string } {
  const { title, periodLabel, rows, t } = options;
  const periodText = t("partners.balance.period", "For period: {{period}}", { period: periodLabel });
  const sheetRows: (string | number)[][] = [[title], [periodText], columnHeaders(t)];
  for (const row of rows) {
    sheetRows.push(rowValues(row));
  }

  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  const dataStartRow = HEADER_ROW + 1;

  worksheet["!merges"] = [
    { s: { r: TITLE_ROW, c: 0 }, e: { r: TITLE_ROW, c: COL_COUNT - 1 } },
    { s: { r: PERIOD_ROW, c: 0 }, e: { r: PERIOD_ROW, c: COL_COUNT - 1 } },
  ];
  worksheet["!cols"] = [
    { wch: 12 },
    { wch: 22 },
    { wch: 16 },
    { wch: 18 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
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
  applyRowStyle(worksheet, PERIOD_ROW, {
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

  for (let offset = 0; offset < rows.length; offset += 1) {
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
        numFmt: isNumeric ? "#,##0.00" : "@",
      });
    }
  }

  const workbook = XLSX.utils.book_new();
  const sheetName = sanitizeFileName(title).slice(0, 31) || "Reconciliation";
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return {
    workbook,
    filename: `partner-reconciliation-${sanitizeFileName(periodLabel)}.xlsx`,
  };
}
