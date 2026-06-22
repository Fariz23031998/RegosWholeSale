import { useEffect, useState } from "react";
import clsx from "clsx";
import { formatAuthError, useAuth } from "@/store/auth";
import { formatDateTime } from "@/lib/format";
import { fetchTelegramBotConfig, fetchTelegramUsers } from "@/lib/telegram-api";
import type { TelegramUser } from "@/types/telegram";
import styles from "./TelegramUsers.module.css";

function displayName(user: TelegramUser): string {
  const parts = [user.first_name, user.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (user.username) return `@${user.username}`;
  return `User #${user.telegram_user_id}`;
}

export function TelegramUsersPage() {
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const canManageUsers = Boolean(user?.permissions.includes("users.manage"));

  const [users, setUsers] = useState<TelegramUser[]>([]);
  const [botConfigured, setBotConfigured] = useState(false);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  if (!canManageUsers) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Telegram users</h1>
            <div className={styles.subtitle}>You do not have permission to view Telegram users.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Telegram users</h1>
          <div className={styles.subtitle}>
            {loading
              ? "Loading…"
              : botConfigured
                ? `${users.length} subscriber${users.length === 1 ? "" : "s"} · @${botUsername ?? "bot"}`
                : "Configure a Telegram bot in Settings to collect subscribers"}
          </div>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.table}>
        {loading ? (
          <div className={styles.empty}>Loading Telegram users…</div>
        ) : !botConfigured ? (
          <div className={styles.empty}>
            No Telegram bot configured yet. Add your BotFather token in Settings.
          </div>
        ) : users.length === 0 ? (
          <div className={styles.empty}>
            No users yet. Share your bot link and ask customers to send /start.
          </div>
        ) : (
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Telegram ID</th>
                <th>Language</th>
                <th>Registered</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>{displayName(item)}</td>
                  <td className={styles.muted}>{item.username ? `@${item.username}` : "—"}</td>
                  <td className={styles.id}>{item.telegram_user_id}</td>
                  <td className={styles.muted}>{item.language_code ?? "—"}</td>
                  <td className={styles.muted}>{formatDateTime(item.created_at)}</td>
                  <td>
                    <span
                      className={clsx(
                        styles.badge,
                        item.is_active ? styles.active : styles.inactive,
                      )}
                    >
                      {item.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
