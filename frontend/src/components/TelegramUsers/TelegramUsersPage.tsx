import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  ALL_LEAF_NOTIFICATION_TYPES,
  countEnabledLeafTypes,
} from "@/lib/telegram-notification-types";
import { fetchTelegramBotConfig, fetchTelegramUsers, deleteTelegramUser } from "@/lib/telegram-api";
import type { TelegramUser } from "@/types/telegram";
import { TelegramUserNotificationsModal } from "./TelegramUserNotificationsModal";
import styles from "./TelegramUsers.module.css";

function isGroupChat(user: TelegramUser): boolean {
  return user.chat_type === "group" || user.chat_type === "supergroup";
}

function displayName(
  user: TelegramUser,
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string,
): string {
  if (isGroupChat(user) && user.title) return user.title;
  const parts = [user.first_name, user.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (user.username) return `@${user.username}`;
  if (isGroupChat(user)) {
    return t("telegramUsers.groupFallback", "Group #{{id}}", { id: user.chat_id });
  }
  return t("telegramUsers.userFallback", "User #{{id}}", { id: user.telegram_user_id });
}

function chatTypeLabel(
  user: TelegramUser,
  t: (key: string, fallback?: string) => string,
): string {
  if (isGroupChat(user)) {
    return t("telegramUsers.chatType.group", "Group");
  }
  return t("telegramUsers.chatType.user", "User");
}

function notificationsSummary(
  user: TelegramUser,
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string,
): string {
  if (!user.is_active) {
    return t("telegramUsers.notifications.none", "None");
  }
  const count = countEnabledLeafTypes(user.notification_types);
  if (count === ALL_LEAF_NOTIFICATION_TYPES.length) {
    return t("telegramUsers.notifications.all", "All types");
  }
  return t("telegramUsers.notifications.count", "{{enabled}} of {{total}}", {
    enabled: count,
    total: ALL_LEAF_NOTIFICATION_TYPES.length,
  });
}

function scopeSummary(
  user: TelegramUser,
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string,
): string {
  const stockCount = user.stock_ids?.length ?? 0;
  const cashierCount = user.cashier_ids?.length ?? 0;
  if (stockCount === 0 && cashierCount === 0) {
    return t("telegramUsers.scope.all", "All");
  }
  const parts: string[] = [];
  if (stockCount === 0) {
    parts.push(t("telegramUsers.scope.allWarehousesShort", "All warehouses"));
  } else if (stockCount === 1) {
    parts.push(t("telegramUsers.scope.oneWarehouse", "1 warehouse"));
  } else {
    parts.push(
      t("telegramUsers.scope.warehouseCount", "{{count}} warehouses", { count: stockCount }),
    );
  }
  if (cashierCount === 0) {
    parts.push(t("telegramUsers.scope.allCashiersShort", "All cashiers"));
  } else if (cashierCount === 1) {
    parts.push(t("telegramUsers.scope.oneCashier", "1 cashier"));
  } else {
    parts.push(
      t("telegramUsers.scope.cashierCount", "{{count}} cashiers", { count: cashierCount }),
    );
  }
  return parts.join(" · ");
}

type TelegramUsersPageData = {
  users: TelegramUser[];
  botConfigured: boolean;
  botUsername: string | null;
};

export function TelegramUsersPage() {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const canManageUsers = Boolean(user?.permissions.includes("users.manage"));
  const queryClient = useQueryClient();

  const [actionError, setActionError] = useState("");
  const [editingUser, setEditingUser] = useState<TelegramUser | null>(null);
  const [notificationsModalOpen, setNotificationsModalOpen] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);

  const telegramUsersQuery = useQuery({
    queryKey: ["telegram", "users-page", token],
    queryFn: async () => {
      const [botConfig, telegramUsers] = await Promise.all([
        fetchTelegramBotConfig(token!),
        fetchTelegramUsers(token!),
      ]);
      return {
        users: telegramUsers,
        botConfigured: botConfig.configured,
        botUsername: botConfig.bot_username,
      } satisfies TelegramUsersPageData;
    },
    enabled: Boolean(token) && canManageUsers,
    staleTime: 30_000,
  });

  const users = telegramUsersQuery.data?.users ?? [];
  const botConfigured = telegramUsersQuery.data?.botConfigured ?? false;
  const botUsername = telegramUsersQuery.data?.botUsername ?? null;
  const loading = telegramUsersQuery.isPending;
  const error = telegramUsersQuery.error
    ? formatAuthError(telegramUsersQuery.error)
    : actionError;

  const updateUsersList = (updater: (current: TelegramUser[]) => TelegramUser[]) => {
    queryClient.setQueryData<TelegramUsersPageData>(["telegram", "users-page", token], (current) => {
      if (!current) return current;
      return { ...current, users: updater(current.users) };
    });
  };

  const openNotifications = (item: TelegramUser) => {
    setEditingUser(item);
    setNotificationsModalOpen(true);
  };

  const handleUserSaved = (updated: TelegramUser) => {
    updateUsersList((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  };

  const handleDelete = async (item: TelegramUser) => {
    if (!token) return;
    const confirmed = window.confirm(
      t(
        "telegramUsers.confirmDelete",
        'Remove "{{name}}" from Telegram subscribers?',
        { name: displayName(item, t) },
      ),
    );
    if (!confirmed) return;

    setDeletingUserId(item.id);
    setActionError("");
    try {
      await deleteTelegramUser(token, item.id);
      updateUsersList((current) => current.filter((user) => user.id !== item.id));
    } catch (err) {
      setActionError(formatAuthError(err));
    } finally {
      setDeletingUserId(null);
    }
  };

  if (!canManageUsers) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{t("telegramUsers.title", "Telegram subscribers")}</h1>
            <div className={styles.subtitle}>
              {t(
                "telegramUsers.noPermission",
                "You do not have permission to view Telegram subscribers.",
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
          <h1 className={styles.title}>{t("telegramUsers.title", "Telegram subscribers")}</h1>
          <div className={styles.subtitle}>{subtitle}</div>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.table}>
        {loading ? (
          <div className={styles.empty}>
            {t("telegramUsers.loadingList", "Loading Telegram subscribers…")}
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
              "No subscribers yet. Share your bot link or add the bot to a group and send /start@botname.",
            )}
          </div>
        ) : (
          <div className={styles.tableScroll}>
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>{t("common.name", "Name")}</th>
                <th>{t("telegramUsers.table.type", "Type")}</th>
                <th>{t("telegramUsers.table.username", "Username")}</th>
                <th>{t("telegramUsers.table.chatId", "Chat ID")}</th>
                <th>{t("telegramUsers.table.language", "Language")}</th>
                <th>{t("telegramUsers.table.notifications", "Notifications")}</th>
                <th>{t("telegramUsers.table.scope", "Scope")}</th>
                <th>{t("telegramUsers.receiptLanguage", "Receipt language")}</th>
                <th>{t("telegramUsers.table.registered", "Registered")}</th>
                <th className={styles.statusHeader}>{t("common.status", "Status")}</th>
                <th>{t("common.actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td className={styles.nameCell} data-label={t("common.name", "Name")}>{displayName(item, t)}</td>
                  <td data-label={t("telegramUsers.table.type", "Type")}>
                    <span className={styles.badge}>{chatTypeLabel(item, t)}</span>
                  </td>
                  <td className={styles.muted} data-label={t("telegramUsers.table.username", "Username")}>
                    {item.username ? `@${item.username}` : "—"}
                  </td>
                  <td className={styles.id} data-label={t("telegramUsers.table.chatId", "Chat ID")}>
                    {item.chat_id}
                  </td>
                  <td className={styles.muted} data-label={t("telegramUsers.table.language", "Language")}>
                    {item.language_code ?? "—"}
                  </td>
                  <td className={clsx(styles.muted, styles.notificationsCell)} data-label={t("telegramUsers.table.notifications", "Notifications")}>
                    <span className={styles.notificationSummary}>
                      {notificationsSummary(item, t)}
                    </span>
                  </td>
                  <td className={clsx(styles.muted, styles.scopeCell)} data-label={t("telegramUsers.table.scope", "Scope")}>
                    {item.is_active ? scopeSummary(item, t) : "—"}
                  </td>
                  <td className={styles.muted} data-label={t("telegramUsers.receiptLanguage", "Receipt language")}>
                    {t(
                      receiptLanguageLabelKey(item.receipt_language as TelegramReceiptLanguage),
                      item.receipt_language.toUpperCase(),
                    )}
                  </td>
                  <td className={styles.muted} data-label={t("telegramUsers.table.registered", "Registered")}>
                    {formatDateTime(item.created_at)}
                  </td>
                  <td className={styles.statusCell} data-label={t("common.status", "Status")}>
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
                  <td className={styles.actionsCell} data-label={t("common.actions", "Actions")}>
                    <div className={styles.actions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openNotifications(item)}
                      >
                        {t("telegramUsers.actions.notifications", "Notifications")}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={deletingUserId === item.id}
                        onClick={() => void handleDelete(item)}
                      >
                        {deletingUserId === item.id
                          ? "…"
                          : t("common.delete", "Delete")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
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
