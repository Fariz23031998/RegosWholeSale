import { createFileRoute } from "@tanstack/react-router";
import { PartnerTelegramPage } from "@/components/PartnerTelegram/PartnerTelegramPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/partner-telegram")({
  head: () => ({
    meta: [
      {
        title: languageService.t("meta.partnerTelegramTitle", "Partner Telegram · Regos Optom"),
      },
      {
        name: "description",
        content: languageService.t(
          "meta.partnerTelegramDescription",
          "Link Telegram accounts to Regos partners.",
        ),
      },
    ],
  }),
  component: PartnerTelegramPage,
});
