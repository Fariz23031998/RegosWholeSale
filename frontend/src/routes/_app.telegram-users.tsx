import { createFileRoute } from "@tanstack/react-router";
import { TelegramUsersPage } from "@/components/TelegramUsers/TelegramUsersPage";

export const Route = createFileRoute("/_app/telegram-users")({
  head: () => ({
    meta: [
      { title: "Telegram users · Regos Optom" },
      { name: "description", content: "View Telegram bot subscribers." },
    ],
  }),
  component: TelegramUsersPage,
});
