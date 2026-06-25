import { apiRequest } from "@/lib/api";
import type {
  TelegramBotConfig,
  TelegramBotMessage,
  TelegramBotSaveRequest,
  TelegramNotificationTypesResponse,
  TelegramReceiptLanguagesResponse,
  TelegramUser,
  TelegramUserUpdateRequest,
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

export async function fetchTelegramNotificationTypes(
  token: string,
): Promise<TelegramNotificationTypesResponse> {
  return apiRequest("/api/v1/telegram/notification-types", { token });
}

export async function fetchTelegramReceiptLanguages(
  token: string,
): Promise<TelegramReceiptLanguagesResponse> {
  return apiRequest("/api/v1/telegram/receipt-languages", { token });
}

export async function deleteTelegramUser(token: string, userId: number): Promise<{ message: string }> {
  return apiRequest(`/api/v1/telegram/users/${userId}`, {
    method: "DELETE",
    token,
  });
}

export async function updateTelegramUser(
  token: string,
  userId: number,
  body: TelegramUserUpdateRequest,
): Promise<TelegramUser> {
  return apiRequest(`/api/v1/telegram/users/${userId}`, {
    method: "PATCH",
    token,
    body,
  });
}
