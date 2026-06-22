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
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  is_active: boolean;
  created_at: string;
};
