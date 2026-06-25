import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import clsx from "clsx";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatAuthError, useAuth } from "@/store/auth";
import { deactivateUser, fetchPermissions, fetchUsers, patchUser } from "@/lib/users-api";
import { formatScheduleSummary, type Permission, type UserDetail } from "@/types/users";
import { UserFormModal } from "./UserFormModal";
import { UserPosSettingsModal } from "./UserPosSettingsModal";
import styles from "./Users.module.css";

function loginOrEmail(user: UserDetail): string {
  if (user.role === "owner" && user.email) return user.email;
  return user.login ?? "—";
}

function roleBadgeClass(role: UserDetail["role"]): string {
  if (role === "owner") return styles.roleOwner;
  if (role === "admin") return styles.roleAdmin;
  return styles.roleEmployee;
}

function roleLabel(
  role: UserDetail["role"],
  t: (key: string, fallback?: string) => string,
): string {
  if (role === "owner") return t("users.role.owner", "Owner");
  if (role === "admin") return t("users.role.admin", "Admin");
  return t("users.role.employee", "Employee");
}

function permissionsSummary(
  user: UserDetail,
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string,
): string {
  if (user.permissions.length <= 3) return user.permissions.join(", ");
  return t("users.permissionsCount", "{{n}} permissions", { n: user.permissions.length });
}

export function UsersPage() {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const canManageUsers = Boolean(user?.permissions.includes("users.manage"));
  const queryClient = useQueryClient();

  const [actionError, setActionError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingUser, setEditingUser] = useState<UserDetail | null>(null);
  const [settingsUser, setSettingsUser] = useState<UserDetail | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [actionUserId, setActionUserId] = useState<number | null>(null);

  const usersListQuery = useQuery({
    queryKey: ["users", "list", token],
    queryFn: async () => {
      const [userList, permissionList] = await Promise.all([
        fetchUsers(token!),
        fetchPermissions(token!),
      ]);
      return { users: userList, permissions: permissionList };
    },
    enabled: Boolean(token) && canManageUsers,
    staleTime: 30_000,
  });

  const users = usersListQuery.data?.users ?? [];
  const permissions = usersListQuery.data?.permissions ?? [];
  const loading = usersListQuery.isPending;
  const error = usersListQuery.error ? formatAuthError(usersListQuery.error) : "";

  type UsersListData = { users: UserDetail[]; permissions: Permission[] };

  const updateUsersList = (updater: (current: UserDetail[]) => UserDetail[]) => {
    queryClient.setQueryData<UsersListData>(["users", "list", token], (current) => {
      if (!current) return current;
      return { ...current, users: updater(current.users) };
    });
  };

  const openCreate = () => {
    setModalMode("create");
    setEditingUser(null);
    setModalOpen(true);
  };

  const openEdit = (item: UserDetail) => {
    setModalMode("edit");
    setEditingUser(item);
    setModalOpen(true);
  };

  const openSettings = (item: UserDetail) => {
    setSettingsUser(item);
    setSettingsModalOpen(true);
  };

  const handleSaved = (saved: UserDetail) => {
    updateUsersList((prev) => {
      const index = prev.findIndex((u) => u.id === saved.id);
      if (index === -1) return [...prev, saved];
      const next = [...prev];
      next[index] = saved;
      return next;
    });
  };

  const handleDeactivate = async (item: UserDetail) => {
    if (!token || item.role === "owner") return;
    setActionError("");
    setActionUserId(item.id);
    try {
      const updated = await deactivateUser(token, item.id);
      updateUsersList((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err) {
      setActionError(formatAuthError(err));
    } finally {
      setActionUserId(null);
    }
  };

  const handleReactivate = async (item: UserDetail) => {
    if (!token || item.role === "owner") return;
    setActionError("");
    setActionUserId(item.id);
    try {
      const updated = await patchUser(token, item.id, { is_active: true });
      updateUsersList((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err) {
      setActionError(formatAuthError(err));
    } finally {
      setActionUserId(null);
    }
  };

  if (!canManageUsers) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{t("users.title", "Users")}</h1>
            <div className={styles.subtitle}>
              {t("users.noPermission", "You do not have permission to manage users.")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const subtitle = loading
    ? t("common.loading", "Loading...")
    : users.length === 1
      ? t("users.subtitle", "{{n}} user in your company", { n: users.length })
      : t("users.subtitlePlural", "{{n}} users in your company", { n: users.length });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("users.title", "Users")}</h1>
          <div className={styles.subtitle}>{subtitle}</div>
        </div>
        <Button onClick={openCreate}>{t("users.addUser", "Add user")}</Button>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {actionError && <div className={styles.error}>{actionError}</div>}

      <div className={styles.table}>
        {loading ? (
          <div className={styles.empty}>{t("users.loadingList", "Loading users…")}</div>
        ) : users.length === 0 ? (
          <div className={styles.empty}>
            {t("users.empty", "No users yet. Add your first employee.")}
          </div>
        ) : (
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>{t("common.name", "Name")}</th>
                <th>{t("users.table.login", "Login")} / {t("users.table.email", "Email")}</th>
                <th>{t("users.table.role", "Role")}</th>
                <th>{t("users.table.permissions", "Permissions")}</th>
                <th>{t("users.table.schedules", "Schedules")}</th>
                <th>{t("common.status", "Status")}</th>
                <th>{t("common.actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => {
                const busy = actionUserId === item.id;
                return (
                  <tr key={item.id}>
                    <td>{item.display_name}</td>
                    <td className={styles.mono}>{loginOrEmail(item)}</td>
                    <td>
                      <span className={clsx(styles.badge, roleBadgeClass(item.role))}>
                        {roleLabel(item.role, t)}
                      </span>
                    </td>
                    <td className={styles.muted}>{permissionsSummary(item, t)}</td>
                    <td className={styles.muted}>
                      {item.role === "owner"
                        ? "—"
                        : formatScheduleSummary(item.schedules, t)}
                    </td>
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
                          onClick={() => openSettings(item)}
                        >
                          {t("users.actions.settings", "Settings")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openEdit(item)}
                        >
                          {t("common.edit", "Edit")}
                        </Button>
                        {item.role !== "owner" && (
                          item.is_active ? (
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleDeactivate(item)}
                            >
                              {busy
                                ? "…"
                                : t("users.actions.deactivate", "Deactivate")}
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleReactivate(item)}
                            >
                              {busy
                                ? "…"
                                : t("users.actions.reactivate", "Reactivate")}
                            </Button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {token && (
        <UserFormModal
          open={modalOpen}
          mode={modalMode}
          token={token}
          user={editingUser}
          permissions={permissions}
          onClose={() => setModalOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {token && (
        <UserPosSettingsModal
          open={settingsModalOpen}
          token={token}
          user={settingsUser}
          onClose={() => setSettingsModalOpen(false)}
        />
      )}
    </div>
  );
}
