import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { DataTable } from "@/components/DataTable/DataTable";
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
  const firmCount = user.firm_ids?.length ?? 0;
  if (stockCount === 0 && cashierCount === 0 && firmCount === 0) {
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
  if (firmCount === 0) {
    parts.push(t("telegramUsers.scope.allFirmsShort", "All firms"));
  } else if (firmCount === 1) {
    parts.push(t("telegramUsers.scope.oneFirm", "1 firm"));
  } else {
    parts.push(t("telegramUsers.scope.firmCount", "{{count}} firms", { count: firmCount }));
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

  const columns = useMemo<ColumnDef<TelegramUser, any>[]>(
    () => [
      {
        id: "name",
        accessorFn: (item) => displayName(item, t),
        header: t("common.name", "Name"),
        size: 200,
        meta: { cellClassName: styles.nameCell },
      },
      {
        id: "type",
        accessorFn: (item) => chatTypeLabel(item, t),
        header: t("telegramUsers.table.type", "Type"),
        cell: ({ row }) => <span className={styles.badge}>{chatTypeLabel(row.original, t)}</span>,
      },
      {
        id: "username",
        accessorFn: (item) => item.username ?? "",
        header: t("telegramUsers.table.username", "Username"),
        meta: { cellClassName: styles.muted },
        cell: ({ row }) => (row.original.username ? `@${row.original.username}` : "—"),
      },
      {
        id: "chatId",
        accessorFn: (item) => item.chat_id,
        header: t("telegramUsers.table.chatId", "Chat ID"),
        meta: { cellClassName: styles.id },
      },
      {
        id: "language",
        accessorFn: (item) => item.language_code ?? "",
        header: t("telegramUsers.table.language", "Language"),
        meta: { cellClassName: styles.muted },
        cell: ({ getValue }) => getValue<string>() || "—",
      },
      {
        id: "notifications",
        accessorFn: (item) => notificationsSummary(item, t),
        header: t("telegramUsers.table.notifications", "Notifications"),
        meta: { cellClassName: clsx(styles.muted, styles.notificationsCell) },
        cell: ({ row }) => (
          <span className={styles.notificationSummary}>{notificationsSummary(row.original, t)}</span>
        ),
      },
      {
        id: "scope",
        accessorFn: (item) => (item.is_active ? scopeSummary(item, t) : ""),
        header: t("telegramUsers.table.scope", "Scope"),
        meta: { cellClassName: clsx(styles.muted, styles.scopeCell) },
        cell: ({ row }) => (row.original.is_active ? scopeSummary(row.original, t) : "—"),
      },
      {
        id: "receiptLanguage",
        accessorFn: (item) => item.receipt_language,
        header: t("telegramUsers.receiptLanguage", "Receipt language"),
        meta: { cellClassName: styles.muted },
        cell: ({ row }) =>
          t(
            receiptLanguageLabelKey(row.original.receipt_language as TelegramReceiptLanguage),
            row.original.receipt_language.toUpperCase(),
          ),
      },
      {
        id: "registered",
        accessorFn: (item) => item.created_at,
        header: t("telegramUsers.table.registered", "Registered"),
        meta: { cellClassName: styles.muted },
        cell: ({ row }) => formatDateTime(row.original.created_at),
      },
      {
        id: "status",
        accessorFn: (item) => (item.is_active ? 1 : 0),
        header: t("common.status", "Status"),
        meta: { cellClassName: styles.statusCell, headerClassName: styles.statusHeader },
        cell: ({ row }) => (
          <span className={clsx(styles.badge, row.original.is_active ? styles.active : styles.inactive)}>
            {row.original.is_active
              ? t("common.active", "Active")
              : t("common.inactive", "Inactive")}
          </span>
        ),
      },
      {
        id: "actions",
        header: t("common.actions", "Actions"),
        enableSorting: false,
        enableHiding: false,
        size: 240,
        meta: { cellClassName: styles.actionsCell },
        cell: ({ row }) => (
          <div className={styles.actions}>
            <Button variant="secondary" size="sm" onClick={() => openNotifications(row.original)}>
              {t("telegramUsers.actions.notifications", "Notifications")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deletingUserId === row.original.id}
              onClick={() => void handleDelete(row.original)}
            >
              {deletingUserId === row.original.id ? "…" : t("common.delete", "Delete")}
            </Button>
          </div>
        ),
      },
    ],
    [deletingUserId, t],
  );

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
            <DataTable
              tableKey="telegramUsers.list"
              data={users}
              columns={columns}
              className={styles.tbl}
              getRowId={(item) => String(item.id)}
            />
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
