import { apiRequest } from "@/lib/api";
import type {
  TelegramBotConfig,
  TelegramBotMessage,
  TelegramBotSaveRequest,
  TelegramUser,
} from "@/types/telegram";

export async function fetchTelegramBotConfig(token: string): Promise<TelegramBotConfig> {
  return apiRequest("/api/v1/telegram/bot", { token });
}

export async function saveTelegramBot(
  token: string,
  body: TelegramBotSaveRequest,
): Promise<TelegramBotMessage> {
  return apiRequest("/api/v1/telegram/bot", {
    method: "PUT",
    token,
    body,
  });
}

export async function deleteTelegramBot(token: string): Promise<TelegramBotMessage> {
  return apiRequest("/api/v1/telegram/bot", {
    method: "DELETE",
    token,
  });
}

export async function fetchTelegramUsers(token: string): Promise<TelegramUser[]> {
  return apiRequest("/api/v1/telegram/users", { token });
}
