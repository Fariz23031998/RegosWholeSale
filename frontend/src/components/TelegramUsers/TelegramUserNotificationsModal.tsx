import { useEffect, useState } from "react";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { Checkbox } from "@/components/ui/checkbox";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatAuthError } from "@/store/auth";
import {
  TELEGRAM_RECEIPT_LANGUAGES,
  receiptLanguageLabelKey,
  type TelegramReceiptLanguage,
} from "@/lib/telegram-receipt-languages";
import { updateTelegramUser } from "@/lib/telegram-api";
import {
  TELEGRAM_NOTIFICATION_TYPES,
  notificationTypeDescriptionKey,
  notificationTypeLabelKey,
  type TelegramNotificationType,
} from "@/lib/telegram-notification-types";
import type { TelegramUser } from "@/types/telegram";
import styles from "./TelegramUsers.module.css";

type Props = {
  open: boolean;
  token: string;
  user: TelegramUser | null;
  onClose: () => void;
  onSaved: (user: TelegramUser) => void;
};

export function TelegramUserNotificationsModal({
  open,
  token,
  user,
  onClose,
  onSaved,
}: Props) {
  const { t } = useLanguage();
  const [selectedTypes, setSelectedTypes] = useState<TelegramNotificationType[]>([]);
  const [receiptLanguage, setReceiptLanguage] = useState<TelegramReceiptLanguage>("ru");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !user) return;
    setSelectedTypes(user.notification_types as TelegramNotificationType[]);
    setReceiptLanguage(user.receipt_language as TelegramReceiptLanguage);
    setIsActive(user.is_active);
    setError("");
  }, [open, user]);

  const toggleType = (type: TelegramNotificationType, checked: boolean) => {
    setSelectedTypes((current) => {
      if (checked) {
        return current.includes(type) ? current : [...current, type];
      }
      return current.filter((item) => item !== type);
    });
  };

  const handleSave = async () => {
    if (!user || selectedTypes.length === 0) {
      setError(
        t(
          "telegramUsers.notifications.selectAtLeastOne",
          "Select at least one notification type.",
        ),
      );
      return;
    }

    setSaving(true);
    setError("");
    try {
      const updated = await updateTelegramUser(token, user.id, {
        notification_types: selectedTypes,
        is_active: isActive,
        receipt_language: receiptLanguage,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setSaving(false);
    }
  };

  const title = user
    ? t("telegramUsers.notifications.titleFor", "Notifications for {{name}}", {
        name:
          [user.first_name, user.last_name].filter(Boolean).join(" ") ||
          (user.username ? `@${user.username}` : `#${user.telegram_user_id}`),
      })
    : t("telegramUsers.notifications.title", "Notification settings");

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className={styles.modalBody}>
        <p className={styles.modalHint}>
          {t(
            "telegramUsers.notifications.hint",
            "Choose which document notifications this subscriber receives from the Telegram bot.",
          )}
        </p>

        <label className={styles.activeToggle}>
          <Checkbox checked={isActive} onCheckedChange={(value) => setIsActive(value === true)} />
          <span>{t("telegramUsers.notifications.receiveMessages", "Receive Telegram messages")}</span>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            {t("telegramUsers.receiptLanguage", "Receipt language")}
          </span>
          <span className={styles.fieldHint}>
            {t(
              "telegramUsers.receiptLanguageHint",
              "Language used for Telegram document notifications.",
            )}
          </span>
          <select
            className={styles.select}
            value={receiptLanguage}
            disabled={!isActive}
            onChange={(event) =>
              setReceiptLanguage(event.target.value as TelegramReceiptLanguage)
            }
          >
            {TELEGRAM_RECEIPT_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t(receiptLanguageLabelKey(language), language.toUpperCase())}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.notificationList}>
          {TELEGRAM_NOTIFICATION_TYPES.map((type) => (
            <label key={type} className={styles.notificationItem}>
              <Checkbox
                checked={selectedTypes.includes(type)}
                disabled={!isActive}
                onCheckedChange={(value) => toggleType(type, value === true)}
              />
              <span className={styles.notificationText}>
                <span className={styles.notificationLabel}>
                  {t(notificationTypeLabelKey(type), type)}
                </span>
                <span className={styles.notificationDescription}>
                  {t(notificationTypeDescriptionKey(type), "")}
                </span>
              </span>
            </label>
          ))}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.modalActions}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? t("common.saving", "Saving…") : t("common.save", "Save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
