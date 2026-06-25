import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatAuthError, useAuth } from "@/store/auth";
import { formatDateTime } from "@/lib/format";
import {
  TELEGRAM_RECEIPT_LANGUAGES,
  receiptLanguageLabelKey,
  type TelegramReceiptLanguage,
} from "@/lib/telegram-receipt-languages";
import {
  TELEGRAM_NOTIFICATION_TYPES,
  notificationTypeLabelKey,
  type TelegramNotificationType,
} from "@/lib/telegram-notification-types";
import { fetchTelegramBotConfig, fetchTelegramUsers } from "@/lib/telegram-api";
import type { TelegramUser } from "@/types/telegram";
import { TelegramUserNotificationsModal } from "./TelegramUserNotificationsModal";
import styles from "./TelegramUsers.module.css";

function displayName(
  user: TelegramUser,
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string,
): string {
  const parts = [user.first_name, user.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (user.username) return `@${user.username}`;
  return t("telegramUsers.userFallback", "User #{{id}}", { id: user.telegram_user_id });
}

function notificationsSummary(
  user: TelegramUser,
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string,
): string {
  if (!user.is_active) {
    return t("telegramUsers.notifications.none", "None");
  }
  const count = user.notification_types.length;
  if (count === TELEGRAM_NOTIFICATION_TYPES.length) {
    return t("telegramUsers.notifications.all", "All types");
  }
  return t("telegramUsers.notifications.count", "{{enabled}} of {{total}}", {
    enabled: count,
    total: TELEGRAM_NOTIFICATION_TYPES.length,
  });
}

export function TelegramUsersPage() {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const canManageUsers = Boolean(user?.permissions.includes("users.manage"));

  const [users, setUsers] = useState<TelegramUser[]>([]);
  const [botConfigured, setBotConfigured] = useState(false);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingUser, setEditingUser] = useState<TelegramUser | null>(null);
  const [notificationsModalOpen, setNotificationsModalOpen] = useState(false);

  useEffect(() => {
    if (!token || !canManageUsers) {
      setUsers([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    const load = async () => {
      try {
        const [botConfig, telegramUsers] = await Promise.all([
          fetchTelegramBotConfig(token),
          fetchTelegramUsers(token),
        ]);
        if (cancelled) return;
        setBotConfigured(botConfig.configured);
        setBotUsername(botConfig.bot_username);
        setUsers(telegramUsers);
      } catch (err) {
        if (!cancelled) setError(formatAuthError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [canManageUsers, token]);

  const openNotifications = (item: TelegramUser) => {
    setEditingUser(item);
    setNotificationsModalOpen(true);
  };

  const handleUserSaved = (updated: TelegramUser) => {
    setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  };

  if (!canManageUsers) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{t("telegramUsers.title", "Telegram users")}</h1>
            <div className={styles.subtitle}>
              {t(
                "telegramUsers.noPermission",
                "You do not have permission to view Telegram users.",
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const subtitle = loading
    ? t("common.loading", "Loading...")
    : botConfigured
      ? users.length === 1
        ? t("telegramUsers.subtitle", "{{n}} subscriber · @{{bot}}", {
            n: users.length,
            bot: botUsername ?? "bot",
          })
        : t("telegramUsers.subtitlePlural", "{{n}} subscribers · @{{bot}}", {
            n: users.length,
            bot: botUsername ?? "bot",
          })
      : t(
          "telegramUsers.configureBot",
          "Configure a Telegram bot in Settings to start collecting subscribers.",
        );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("telegramUsers.title", "Telegram users")}</h1>
          <div className={styles.subtitle}>{subtitle}</div>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.table}>
        {loading ? (
          <div className={styles.empty}>
            {t("telegramUsers.loadingList", "Loading Telegram users…")}
          </div>
        ) : !botConfigured ? (
          <div className={styles.empty}>
            {t(
              "telegramUsers.noBot",
              "No Telegram bot configured yet. Add a bot token in Settings.",
            )}
          </div>
        ) : users.length === 0 ? (
          <div className={styles.empty}>
            {t(
              "telegramUsers.empty",
              "No users yet. Share your bot link to get subscribers.",
            )}
          </div>
        ) : (
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>{t("common.name", "Name")}</th>
                <th>{t("telegramUsers.table.username", "Username")}</th>
                <th>{t("telegramUsers.table.telegramId", "Telegram ID")}</th>
                <th>{t("telegramUsers.table.language", "Language")}</th>
                <th>{t("telegramUsers.table.notifications", "Notifications")}</th>
                <th>{t("telegramUsers.receiptLanguage", "Receipt language")}</th>
                <th>{t("telegramUsers.table.registered", "Registered")}</th>
                <th>{t("common.status", "Status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>{displayName(item, t)}</td>
                  <td className={styles.muted}>{item.username ? `@${item.username}` : "—"}</td>
                  <td className={styles.id}>{item.telegram_user_id}</td>
                  <td className={styles.muted}>{item.language_code ?? "—"}</td>
                  <td className={styles.muted}>
                    <div className={styles.notificationSummary}>
                      <span>{notificationsSummary(item, t)}</span>
                      {item.is_active && item.notification_types.length > 0 && (
                        <span className={styles.notificationTags}>
                          {item.notification_types.map((type) => (
                            <span key={type} className={styles.notificationTag}>
                              {t(notificationTypeLabelKey(type as TelegramNotificationType), type)}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={styles.muted}>
                    {t(
                      receiptLanguageLabelKey(item.receipt_language as TelegramReceiptLanguage),
                      item.receipt_language.toUpperCase(),
                    )}
                  </td>
                  <td className={styles.muted}>{formatDateTime(item.created_at)}</td>
                  <td>
                    <span
                      className={clsx(
                        styles.badge,
                        item.is_active ? styles.active : styles.inactive,
                      )}
                    >
                      {item.is_active
                        ? t("common.active", "Active")
                        : t("common.inactive", "Inactive")}
                    </span>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openNotifications(item)}
                      >
                        {t("telegramUsers.actions.notifications", "Notifications")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <TelegramUserNotificationsModal
        open={notificationsModalOpen}
        token={token ?? ""}
        user={editingUser}
        onClose={() => setNotificationsModalOpen(false)}
        onSaved={handleUserSaved}
      />
    </div>
  );
}
