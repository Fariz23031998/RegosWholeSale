import { createFileRoute } from "@tanstack/react-router";
import { PartnerPortal } from "@/components/PartnerApp/PartnerSession";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/partner/$publicKey")({
  head: () => ({
    meta: [
      {
        title: languageService.t("meta.partnerTelegramTitle", "Partner Telegram · Regos Optom"),
      },
    ],
  }),
  component: PartnerRoute,
});

function PartnerRoute() {
  const { publicKey } = Route.useParams();
  return <PartnerPortal publicKey={publicKey} />;
}
