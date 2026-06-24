import * as XLSX from "xlsx-js-style";
import { formatDateTime } from "@/lib/format";
import { currencyLabel } from "@/lib/currency-conversion";
import type { DashboardPaymentRow, TranslateFn } from "@/lib/dashboard-api";

const COL_COUNT = 8;
const TITLE_ROW = 0;
const PERIOD_ROW = 1;
const HEADER_ROW = 2;

const NUMERIC_COLS = new Set([5, 6]);

const COLORS = {
  primary: "4F46E5",
  primaryLight: "EEF2FF",
  white: "FFFFFF",
  text: "1E293B",
  textMuted: "64748B",
  border: "CBD5E1",
  headerBg: "F8FAFC",
  incomeAccent: "10B981",
  incomeBg: "D1FAE5",
  outcomeAccent: "F59E0B",
  outcomeBg: "FEF3C7",
  totalBg: "EEF2FF",
  altRow: "F8FAFC",
} as const;

type PaymentSection = "income" | "outcome";

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

function paymentColumnHeaders(t: TranslateFn): string[] {
  return [
    t("dashboard.payments.receipt"),
    t("common.date"),
    t("common.type"),
    t("dashboard.payments.partner"),
    t("dashboard.payments.user"),
    t("dashboard.payments.exchangeRate"),
    t("common.amount"),
    t("dashboard.payments.currency", "Currency"),
  ];
}

function formatPaymentDate(timestamp: number): string {
  if (timestamp <= 0) return "";
  return formatDateTime(new Date(timestamp * 1000).toISOString());
}

function paymentRowValues(payment: DashboardPaymentRow): (string | number)[] {
  return [
    payment.code ? `#${payment.code}` : `#${payment.id}`,
    formatPaymentDate(payment.date),
    payment.payment_type_name ?? "",
    payment.partner_name ?? "",
    payment.attached_user_name ?? "",
    payment.exchange_rate ?? "",
    payment.amount ?? "",
    currencyLabel(payment.currency),
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

function dataCellStyle(col: number, options?: { fill?: string }): CellStyle {
  const isNumeric = NUMERIC_COLS.has(col);
  return {
    font: { name: FONT, sz: 11, color: { rgb: COLORS.text } },
    fill: options?.fill ? { patternType: "solid", fgColor: { rgb: options.fill } } : undefined,
    alignment: {
      horizontal: isNumeric ? "right" : "left",
      vertical: "center",
      wrapText: col === 3 || col === 4,
    },
    border: thinBorder(),
    numFmt: col === 5 ? "#,##0.####" : col === 6 ? "#,##0.00" : "@",
  };
}

function sectionColors(section: PaymentSection) {
  return section === "income"
    ? { accent: COLORS.incomeAccent, bg: COLORS.incomeBg }
    : { accent: COLORS.outcomeAccent, bg: COLORS.outcomeBg };
}

function buildPaymentSheet(
  payments: DashboardPaymentRow[],
  section: PaymentSection,
  title: string,
  subtitle: string,
  totalAmount: number,
  totalLabel: string,
  t: TranslateFn,
): XLSX.WorkSheet {
  const headers = paymentColumnHeaders(t);
  const rows: (string | number)[][] = [[title], [subtitle], headers];

  if (payments.length > 0) {
    rows.push([
      totalLabel,
      "",
      "",
      "",
      "",
      "",
      totalAmount,
      "",
    ]);
  }

  for (const payment of payments) {
    rows.push(paymentRowValues(payment));
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const { accent, bg } = sectionColors(section);
  const dataStartRow = HEADER_ROW + 1;
  const hasTotalRow = payments.length > 0;

  worksheet["!merges"] = [
    { s: { r: TITLE_ROW, c: 0 }, e: { r: TITLE_ROW, c: COL_COUNT - 1 } },
    { s: { r: PERIOD_ROW, c: 0 }, e: { r: PERIOD_ROW, c: COL_COUNT - 1 } },
  ];
  worksheet["!cols"] = [
    { wch: 16 },
    { wch: 20 },
    { wch: 16 },
    { wch: 22 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 10 },
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
    fill: { patternType: "solid", fgColor: { rgb: accent } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(accent),
  });
  applyRowStyle(worksheet, PERIOD_ROW, {
    font: { name: FONT, sz: 11, italic: true, color: { rgb: COLORS.textMuted } },
    fill: { patternType: "solid", fgColor: { rgb: bg } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(),
  });

  for (let col = 0; col < COL_COUNT; col += 1) {
    applyCellStyle(worksheet, HEADER_ROW, col, {
      font: { name: FONT, sz: 10, bold: true, color: { rgb: COLORS.text } },
      fill: { patternType: "solid", fgColor: { rgb: bg } },
      alignment: {
        horizontal: NUMERIC_COLS.has(col) ? "right" : "left",
        vertical: "center",
        wrapText: true,
      },
      border: thinBorder(accent),
      numFmt: "@",
    });
  }

  const dataRowCount = rows.length - dataStartRow;
  for (let offset = 0; offset < dataRowCount; offset += 1) {
    const row = dataStartRow + offset;
    const isTotal = hasTotalRow && offset === 0;
    const isAlt = !isTotal && offset % 2 === (hasTotalRow ? 1 : 0);
    const fill = isTotal ? COLORS.totalBg : isAlt ? COLORS.altRow : undefined;

    for (let col = 0; col < COL_COUNT; col += 1) {
      applyCellStyle(worksheet, row, col, {
        ...dataCellStyle(col, { fill }),
        font: {
          name: FONT,
          sz: 11,
          bold: isTotal,
          color: { rgb: COLORS.text },
        },
      });
    }
  }

  return worksheet;
}

export function exportDashboardPaymentsToExcel(
  incomePayments: DashboardPaymentRow[],
  outcomePayments: DashboardPaymentRow[],
  incomeTotal: number,
  outcomeTotal: number,
  incomeCategoryName: string | null,
  outcomeCategoryName: string | null,
  t: TranslateFn,
  periodLabel: string,
): void {
  const totalLabel = t("dashboard.products.totalRow", "Total");
  const incomeTitle = t("dashboard.payments.income");
  const outcomeTitle = t("dashboard.payments.outcome");
  const incomeSubtitle = [
    periodLabel,
    incomeCategoryName
      ? t("dashboard.payments.category", undefined, { name: incomeCategoryName })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const outcomeSubtitle = [
    periodLabel,
    outcomeCategoryName
      ? t("dashboard.payments.category", undefined, { name: outcomeCategoryName })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    buildPaymentSheet(
      incomePayments,
      "income",
      incomeTitle,
      incomeSubtitle,
      incomeTotal,
      totalLabel,
      t,
    ),
    incomeTitle.slice(0, 31),
  );
  XLSX.utils.book_append_sheet(
    workbook,
    buildPaymentSheet(
      outcomePayments,
      "outcome",
      outcomeTitle,
      outcomeSubtitle,
      outcomeTotal,
      totalLabel,
      t,
    ),
    outcomeTitle.slice(0, 31),
  );

  const fileName = `dashboard-payments-${sanitizeFileName(periodLabel)}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
