import { createFileRoute } from "@tanstack/react-router";
import { TelegramUsersPage } from "@/components/TelegramUsers/TelegramUsersPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/telegram-users")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.telegramUsersTitle", "Telegram users · Regos Optom") },
      {
        name: "description",
        content: languageService.t(
          "meta.telegramUsersDescription",
          "View Telegram bot subscribers.",
        ),
      },
    ],
  }),
  component: TelegramUsersPage,
});
