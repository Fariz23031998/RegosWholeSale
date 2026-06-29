export type TelegramBotConfig = {
  configured: boolean;
  bot_username: string | null;
  token_masked: string;
  webhook_url: string | null;
};

export type TelegramBotSaveRequest = {
  bot_token: string;
};

export type TelegramBotMessage = {
  message: string;
  bot?: TelegramBotConfig | null;
};

export type TelegramUser = {
  id: number;
  telegram_user_id: number;
  chat_id: number;
  chat_type: string;
  title: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  is_active: boolean;
  notification_types: string[];
  receipt_language: string;
  stock_ids: number[];
  cashier_ids: number[];
  created_at: string;
};

export type TelegramUserUpdateRequest = {
  notification_types?: string[];
  is_active?: boolean;
  receipt_language?: string;
  stock_ids?: number[];
  cashier_ids?: number[];
};

export type TelegramReceiptLanguagesResponse = {
  languages: string[];
};

export type TelegramNotificationCategory = {
  id: string;
  subcategories: string[];
};

export type TelegramNotificationTypesResponse = {
  categories: TelegramNotificationCategory[];
  types: string[];
};
