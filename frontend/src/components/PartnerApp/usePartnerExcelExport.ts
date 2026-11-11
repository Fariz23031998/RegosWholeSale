import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  deliverPartnerExcel,
  type PartnerExcelExport,
} from "@/lib/partner-excel-delivery";
import { formatAuthError } from "@/store/auth";
import { usePartnerSession } from "./PartnerSession";

export function usePartnerExcelExport() {
  const { t } = useLanguage();
  const { token, compact } = usePartnerSession();
  const [exporting, setExporting] = useState(false);

  const exportLabel = compact
    ? t("partnerApp.sendExcelTelegram", "Send to Telegram")
    : t("partnerApp.exportExcel", "Export to Excel");

  const runExport = useCallback(
    async (build: () => PartnerExcelExport) => {
      setExporting(true);
      try {
        await deliverPartnerExcel(build(), { token, viaTelegram: compact });
        if (compact) {
          toast.success(
            t("partnerApp.excelSentTelegram", "Excel sent to your Telegram chat."),
          );
        }
      } catch (error) {
        toast.error(
          formatAuthError(
            error,
            t("partnerApp.excelSendFailed", "Failed to send Excel to Telegram."),
          ),
        );
      } finally {
        setExporting(false);
      }
    },
    [compact, t, token],
  );

  return { compact, exporting, exportLabel, runExport };
}
