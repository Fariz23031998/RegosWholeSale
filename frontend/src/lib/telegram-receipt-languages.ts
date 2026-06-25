export const TELEGRAM_RECEIPT_LANGUAGES = ["en", "ru", "uz", "tj"] as const;

export type TelegramReceiptLanguage = (typeof TELEGRAM_RECEIPT_LANGUAGES)[number];

export function receiptLanguageLabelKey(language: TelegramReceiptLanguage): string {
  return `language.${language}`;
}
