import * as XLSX from "xlsx-js-style";
import type { TranslateFn } from "@/lib/dashboard-api";
import type {
  PartnerDashboardProductRow,
  PartnerDashboardProductTotals,
} from "@/lib/partner-telegram-api";

const COL_COUNT = 9;
const TITLE_ROW = 0;
const PERIOD_ROW = 1;
const GROUP_ROW = 2;
const HEADER_ROW = 3;
const PRODUCT_END = 2;
const SELL_START = 3;
const SELL_END = 5;
const REFUND_START = 6;
const REFUND_END = 7;
const NET_START = 8;
const QTY_COLS = new Set([3, 6, 8]);
const NUMERIC_COLS = new Set([3, 4, 5, 6, 7, 8]);

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

function columnHeaders(t: TranslateFn): string[] {
  return [
    t("dashboard.products.col.code", "Code"),
    t("dashboard.products.col.name", "Name"),
    t("dashboard.products.col.category", "Category"),
    t("dashboard.products.col.qty", "Qty"),
    t("dashboard.products.col.avgPrice", "Avg price"),
    t("dashboard.products.col.totalSells", "Total"),
    t("dashboard.products.col.qty", "Qty"),
    t("dashboard.products.col.totalRefunds", "Total"),
    t("dashboard.products.col.totalSells", "Total"),
  ];
}

function groupHeaderRow(t: TranslateFn, productTitle: string): string[] {
  const row = Array<string>(COL_COUNT).fill("");
  row[0] = productTitle;
  row[SELL_START] = t("dashboard.products.group.sell", "Sell");
  row[REFUND_START] = t("dashboard.products.group.refund", "Refund");
  row[NET_START] = t("dashboard.products.group.net", "Net");
  return row;
}

function productRowValues(product: PartnerDashboardProductRow): (string | number)[] {
  return [
    product.code,
    product.name,
    product.category,
    product.sold_quantity,
    product.average_price,
    product.sold_total,
    product.refund_quantity,
    product.refund_total,
    product.net_total,
  ];
}

function totalsRowValues(totals: PartnerDashboardProductTotals, label: string): (string | number)[] {
  return [
    label,
    "",
    "",
    totals.sold_quantity,
    "",
    totals.sold_total,
    totals.refund_quantity,
    totals.refund_total,
    totals.net_total,
  ];
}

export function exportPartnerDashboardProductsToExcel(options: {
  title: string;
  periodLabel: string;
  products: PartnerDashboardProductRow[];
  totals: PartnerDashboardProductTotals;
  t: TranslateFn;
  filePrefix?: string;
}): { workbook: XLSX.WorkBook; filename: string } {
  const { title, periodLabel, products, totals, t, filePrefix = "partner-products" } = options;
  const totalLabel = t("dashboard.products.totalRow", "Total");
  const sheetRows: (string | number)[][] = [
    [title],
    [periodLabel],
    groupHeaderRow(t, title),
    columnHeaders(t),
  ];
  if (products.length > 0) {
    sheetRows.push(totalsRowValues(totals, totalLabel));
  }
  for (const product of products) {
    sheetRows.push(productRowValues(product));
  }

  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  const dataStartRow = HEADER_ROW + 1;
  const hasTotalsRow = products.length > 0;

  worksheet["!merges"] = [
    { s: { r: TITLE_ROW, c: 0 }, e: { r: TITLE_ROW, c: COL_COUNT - 1 } },
    { s: { r: PERIOD_ROW, c: 0 }, e: { r: PERIOD_ROW, c: COL_COUNT - 1 } },
    { s: { r: GROUP_ROW, c: 0 }, e: { r: GROUP_ROW, c: PRODUCT_END } },
    { s: { r: GROUP_ROW, c: SELL_START }, e: { r: GROUP_ROW, c: SELL_END } },
    { s: { r: GROUP_ROW, c: REFUND_START }, e: { r: GROUP_ROW, c: REFUND_END } },
    { s: { r: GROUP_ROW, c: NET_START }, e: { r: GROUP_ROW, c: COL_COUNT - 1 } },
  ];
  worksheet["!cols"] = [
    { wch: 14 },
    { wch: 34 },
    { wch: 18 },
    { wch: 10 },
    { wch: 12 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
  ];
  worksheet["!rows"] = [{ hpt: 30 }, { hpt: 20 }, { hpt: 24 }, { hpt: 28 }];
  worksheet["!freeze"] = {
    xSplit: 0,
    ySplit: HEADER_ROW + 1,
    topLeftCell: "A5",
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

  applyRowStyle(worksheet, GROUP_ROW, {
    font: { name: FONT, sz: 10, bold: true, color: { rgb: COLORS.text } },
    fill: { patternType: "solid", fgColor: { rgb: COLORS.groupNeutral } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder(),
  });
  applyRowStyle(
    worksheet,
    GROUP_ROW,
    {
      font: { name: FONT, sz: 10, bold: true, color: { rgb: COLORS.white } },
      fill: { patternType: "solid", fgColor: { rgb: COLORS.groupSellAccent } },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder(COLORS.groupSellAccent),
    },
    SELL_START,
    SELL_END,
  );
  applyRowStyle(
    worksheet,
    GROUP_ROW,
    {
      font: { name: FONT, sz: 10, bold: true, color: { rgb: COLORS.white } },
      fill: { patternType: "solid", fgColor: { rgb: COLORS.groupRefundAccent } },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder(COLORS.groupRefundAccent),
    },
    REFUND_START,
    REFUND_END,
  );
  applyRowStyle(
    worksheet,
    GROUP_ROW,
    {
      font: { name: FONT, sz: 10, bold: true, color: { rgb: COLORS.white } },
      fill: { patternType: "solid", fgColor: { rgb: COLORS.groupNetAccent } },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder(COLORS.groupNetAccent),
    },
    NET_START,
    COL_COUNT - 1,
  );

  for (let col = 0; col < COL_COUNT; col += 1) {
    const fill =
      col <= PRODUCT_END
        ? COLORS.headerBg
        : col <= SELL_END
          ? COLORS.groupSell
          : col <= REFUND_END
            ? COLORS.groupRefund
            : COLORS.groupNet;
    applyCellStyle(worksheet, HEADER_ROW, col, {
      font: { name: FONT, sz: 10, bold: true, color: { rgb: COLORS.textMuted } },
      fill: { patternType: "solid", fgColor: { rgb: fill } },
      alignment: {
        horizontal: NUMERIC_COLS.has(col) ? "right" : "left",
        vertical: "center",
        wrapText: true,
      },
      border: thinBorder(),
      numFmt: "@",
    });
  }

  const dataRowCount = sheetRows.length - dataStartRow;
  for (let offset = 0; offset < dataRowCount; offset += 1) {
    const row = dataStartRow + offset;
    const isTotal = hasTotalsRow && offset === 0;
    const isAlt = !isTotal && offset % 2 === (hasTotalsRow ? 1 : 0);
    const fill = isTotal ? COLORS.totalBg : isAlt ? COLORS.altRow : undefined;
    for (let col = 0; col < COL_COUNT; col += 1) {
      applyCellStyle(worksheet, row, col, {
        font: {
          name: FONT,
          sz: 11,
          bold: isTotal,
          color: { rgb: COLORS.text },
        },
        fill: fill ? { patternType: "solid", fgColor: { rgb: fill } } : undefined,
        alignment: {
          horizontal: NUMERIC_COLS.has(col) ? "right" : "left",
          vertical: "center",
          wrapText: col === 1,
        },
        border: thinBorder(),
        numFmt: QTY_COLS.has(col) ? "#,##0.##" : NUMERIC_COLS.has(col) ? "#,##0.00" : "@",
      });
    }
  }

  const workbook = XLSX.utils.book_new();
  const sheetName = sanitizeFileName(title).slice(0, 31) || "Products";
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return {
    workbook,
    filename: `${filePrefix}-${sanitizeFileName(periodLabel)}.xlsx`,
  };
}
