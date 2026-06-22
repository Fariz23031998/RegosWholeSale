import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { formatAuthError } from "@/store/auth";
import { isValidScheduleTime, normalizeScheduleTime } from "@/lib/schedule-time";
import { createUser, patchUser } from "@/lib/users-api";
import {
  ROLE_DEFAULTS,
  extraPermissionCodes,
  type Permission,
  type ScheduleItem,
  type UserDetail,
  type UserRole,
} from "@/types/users";
import { ScheduleEditor } from "./ScheduleEditor";
import styles from "./Users.module.css";

type Mode = "create" | "edit";

type Props = {
  open: boolean;
  mode: Mode;
  token: string;
  user: UserDetail | null;
  permissions: Permission[];
  onClose: () => void;
  onSaved: (user: UserDetail) => void;
};

const EDITABLE_ROLES: UserRole[] = ["employee", "admin"];

export function UserFormModal({ open, mode, token, user, permissions, onClose, onSaved }: Props) {
  const isOwner = user?.role === "owner";
  const isCreate = mode === "create";

  const [displayName, setDisplayName] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("employee");
  const [isActive, setIsActive] = useState(true);
  const [extraCodes, setExtraCodes] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setSaving(false);

    if (isCreate) {
      setDisplayName("");
      setLogin("");
      setPassword("");
      setRole("employee");
      setIsActive(true);
      setExtraCodes([]);
      setSchedules([]);
      return;
    }

    if (!user) return;
    setDisplayName(user.display_name);
    setLogin(user.login ?? "");
    setPassword("");
    setRole(user.role === "owner" ? "owner" : user.role);
    setIsActive(user.is_active);
    setExtraCodes(extraPermissionCodes(user.role, user.permissions));
    setSchedules(user.schedules.map(({ day_of_week, start_time, end_time }) => ({
      day_of_week,
      start_time,
      end_time,
    })));
  }, [open, isCreate, user]);

  const assignablePermissions = useMemo(() => {
    const defaults = new Set(ROLE_DEFAULTS[role]);
    return permissions.filter((p) => !defaults.has(p.code));
  }, [permissions, role]);

  const togglePermission = (code: string) => {
    setExtraCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const handleRoleChange = (nextRole: UserRole) => {
    setRole(nextRole);
    if (nextRole === "admin") {
      setExtraCodes([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (isCreate) {
      if (!displayName.trim() || !login.trim() || password.length < 8) {
        setError("Display name, login, and password (min 8 characters) are required.");
        return;
      }
    } else if (!user) {
      return;
    }

    if (!isOwner) {
      const invalidTime = schedules.some(
        (s) => !isValidScheduleTime(s.start_time) || !isValidScheduleTime(s.end_time),
      );
      if (invalidTime) {
        setError("Schedule times must use 24-hour format HH:MM (e.g. 09:00, 17:30).");
        return;
      }
    }

    const normalizedSchedules = isOwner
      ? undefined
      : schedules.map((s) => ({
          ...s,
          start_time: normalizeScheduleTime(s.start_time)!,
          end_time: normalizeScheduleTime(s.end_time)!,
        }));

    setSaving(true);
    try {
      if (isCreate) {
        const created = await createUser(token, {
          login: login.trim(),
          password,
          display_name: displayName.trim(),
          role,
          permission_codes: role === "employee" ? extraCodes : [],
          schedules: normalizedSchedules,
        });
        onSaved(created);
        onClose();
        return;
      }

      const body: Parameters<typeof patchUser>[2] = {
        display_name: displayName.trim(),
        schedules: normalizedSchedules,
      };

      if (password.trim()) {
        body.password = password;
      }
      if (!isOwner) {
        body.role = role;
        body.is_active = isActive;
        body.permission_codes = role === "employee" ? extraCodes : [];
      }

      const updated = await patchUser(token, user!.id, body);
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isCreate ? "Add user" : "Edit user"}
      size="lg"
    >
      <form onSubmit={handleSubmit} className={styles.formGrid}>
        {error && <div className={styles.formError}>{error}</div>}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="user-display-name">
            Display name
          </label>
          <input
            id="user-display-name"
            className={styles.input}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="user-login">
            Login
          </label>
          <input
            id="user-login"
            className={styles.input}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            disabled={!isCreate}
            required={isCreate}
          />
          {!isCreate && <p className={styles.hint}>Login cannot be changed after creation.</p>}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="user-password">
            Password
          </label>
          <input
            id="user-password"
            type="password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={isCreate}
            minLength={isCreate ? 8 : undefined}
            placeholder={isCreate ? "" : "Leave blank to keep current password"}
          />
        </div>

        {!isOwner && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="user-role">
              Role
            </label>
            <select
              id="user-role"
              className={styles.select}
              value={role}
              onChange={(e) => handleRoleChange(e.target.value as UserRole)}
            >
              {EDITABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </div>
        )}

        {!isCreate && (
          <div className={styles.field}>
            <div className={styles.switchRow}>
              <label className={styles.switch}>
                <input
                  type="checkbox"
                  checked={isActive}
                  disabled={isOwner}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <span className={styles.slider} />
              </label>
              <div>
                <div className={styles.label}>Active</div>
                <p className={styles.hint}>
                  {isOwner ? "Owner account cannot be deactivated." : "Inactive users cannot sign in."}
                </p>
              </div>
            </div>
          </div>
        )}

        {role === "employee" && assignablePermissions.length > 0 && (
          <div className={styles.field}>
            <div className={styles.sectionTitle}>Extra permissions</div>
            <p className={styles.hint}>
              Employees receive POS and sales access by default. Grant additional permissions below.
            </p>
            <div className={styles.checkboxGrid}>
              {assignablePermissions.map((perm) => (
                <label key={perm.code} className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={extraCodes.includes(perm.code)}
                    onChange={() => togglePermission(perm.code)}
                  />
                  <span>
                    <div>{perm.code}</div>
                    <div className={styles.checkboxDesc}>{perm.description}</div>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {role === "admin" && (
          <p className={styles.hint}>Admins receive all permissions by default.</p>
        )}

        {!isOwner && (
          <ScheduleEditor schedules={schedules} onChange={setSchedules} />
        )}

        <div className={styles.modalActions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : isCreate ? "Create user" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
