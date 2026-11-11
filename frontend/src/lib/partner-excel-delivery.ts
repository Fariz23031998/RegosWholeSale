import * as XLSX from "xlsx-js-style";
import { sendPartnerExcelToTelegram } from "@/lib/partner-telegram-api";

export type PartnerExcelExport = {
  workbook: XLSX.WorkBook;
  filename: string;
};

export async function deliverPartnerExcel(
  exportResult: PartnerExcelExport,
  options: { token: string; viaTelegram: boolean; caption?: string },
): Promise<void> {
  const { workbook, filename } = exportResult;
  if (!options.viaTelegram) {
    XLSX.writeFile(workbook, filename);
    return;
  }
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer | Uint8Array;
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await sendPartnerExcelToTelegram(options.token, blob, filename, options.caption);
}
