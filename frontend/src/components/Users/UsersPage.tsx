import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Button } from "@/components/posui/Button";
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

function permissionsSummary(user: UserDetail): string {
  if (user.permissions.length <= 3) return user.permissions.join(", ");
  return `${user.permissions.length} permissions`;
}

export function UsersPage() {
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const canManageUsers = Boolean(user?.permissions.includes("users.manage"));

  const [users, setUsers] = useState<UserDetail[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingUser, setEditingUser] = useState<UserDetail | null>(null);
  const [settingsUser, setSettingsUser] = useState<UserDetail | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [actionUserId, setActionUserId] = useState<number | null>(null);

  const loadUsers = useCallback(async () => {
    if (!token || !canManageUsers) return;
    setLoading(true);
    setError("");
    try {
      const [userList, permissionList] = await Promise.all([
        fetchUsers(token),
        fetchPermissions(token),
      ]);
      setUsers(userList);
      setPermissions(permissionList);
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  }, [canManageUsers, token]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

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
    setUsers((prev) => {
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
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
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
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
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
            <h1 className={styles.title}>Users</h1>
            <div className={styles.subtitle}>You do not have permission to manage users.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Users</h1>
          <div className={styles.subtitle}>
            {loading
              ? "Loading…"
              : `${users.length} user${users.length === 1 ? "" : "s"} in your company`}
          </div>
        </div>
        <Button onClick={openCreate}>Add user</Button>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {actionError && <div className={styles.error}>{actionError}</div>}

      <div className={styles.table}>
        {loading ? (
          <div className={styles.empty}>Loading users…</div>
        ) : users.length === 0 ? (
          <div className={styles.empty}>No users yet. Add your first employee.</div>
        ) : (
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Login / Email</th>
                <th>Role</th>
                <th>Permissions</th>
                <th>Schedules</th>
                <th>Status</th>
                <th>Actions</th>
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
                        {item.role}
                      </span>
                    </td>
                    <td className={styles.muted}>{permissionsSummary(item)}</td>
                    <td className={styles.muted}>
                      {item.role === "owner" ? "—" : formatScheduleSummary(item.schedules)}
                    </td>
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
                    <td>
                      <div className={styles.actions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openSettings(item)}
                        >
                          Settings
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openEdit(item)}
                        >
                          Edit
                        </Button>
                        {item.role !== "owner" && (
                          item.is_active ? (
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleDeactivate(item)}
                            >
                              {busy ? "…" : "Deactivate"}
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleReactivate(item)}
                            >
                              {busy ? "…" : "Reactivate"}
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
