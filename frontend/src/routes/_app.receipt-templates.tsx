import { createFileRoute } from "@tanstack/react-router";
import { ReceiptTemplatesPage } from "@/components/Settings/ReceiptTemplatesPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/receipt-templates")({
  head: () => ({
    meta: [
      {
        title: languageService.t(
          "meta.receiptTemplatesTitle",
          "Receipt templates · Regos Optom",
        ),
      },
      {
        name: "description",
        content: languageService.t(
          "meta.receiptTemplatesDescription",
          "Configure receipt and invoice print templates.",
        ),
      },
    ],
  }),
  component: ReceiptTemplatesPage,
});
