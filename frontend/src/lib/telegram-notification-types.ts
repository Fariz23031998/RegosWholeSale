export const TELEGRAM_NOTIFICATION_TYPES = [
  "purchase",
  "return_purchase",
  "wholesale",
  "wholesale_return",
  "payment",
  "inout",
  "movement",
] as const;

export type TelegramNotificationType = (typeof TELEGRAM_NOTIFICATION_TYPES)[number];

export function notificationTypeLabelKey(type: TelegramNotificationType): string {
  return `telegramUsers.notificationTypes.${type}`;
}

export function notificationTypeDescriptionKey(type: TelegramNotificationType): string {
  return `telegramUsers.notificationTypes.${type}Description`;
}
