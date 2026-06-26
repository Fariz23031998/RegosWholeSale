import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatAuthError } from "@/store/auth";
import { isValidScheduleTime, normalizeScheduleTime } from "@/lib/schedule-time";
import { createUser, patchUser } from "@/lib/users-api";
import {
  CONFIGURABLE_PERMISSION_CODES,
  PERMISSION_GROUPS,
  explicitPermissionRules,
  isRoleDefaultPermission,
  type Permission,
  type PermissionEffect,
  type PermissionRule,
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

type RuleState = "inherit" | PermissionEffect;

const EDITABLE_ROLES: UserRole[] = ["employee", "admin"];

function rulesToState(rules: PermissionRule[]): Record<string, RuleState> {
  const map: Record<string, RuleState> = {};
  for (const rule of rules) {
    map[rule.code] = rule.effect;
  }
  return map;
}

function stateToRules(state: Record<string, RuleState>): PermissionRule[] {
  return Object.entries(state)
    .filter(([, effect]) => effect !== "inherit")
    .map(([code, effect]) => ({ code, effect: effect as PermissionEffect }));
}

function permissionNameKey(code: string): string {
  return `users.permissions.codes.${code}`;
}

function permissionDescriptionKey(code: string): string {
  return `users.permissions.descriptions.${code}`;
}

export function UserFormModal({ open, mode, token, user, permissions, onClose, onSaved }: Props) {
  const { t } = useLanguage();
  const isOwner = user?.role === "owner";
  const isCreate = mode === "create";

  const [displayName, setDisplayName] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("employee");
  const [isActive, setIsActive] = useState(true);
  const [ruleState, setRuleState] = useState<Record<string, RuleState>>({});
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const permissionByCode = useMemo(
    () => new Map(permissions.map((permission) => [permission.code, permission])),
    [permissions],
  );

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
      setRuleState({});
      setSchedules([]);
      return;
    }

    if (!user) return;
    setDisplayName(user.display_name);
    setLogin(user.login ?? "");
    setPassword("");
    setRole(user.role === "owner" ? "owner" : user.role);
    setIsActive(user.is_active);
    setRuleState(rulesToState(explicitPermissionRules(user)));
    setSchedules(user.schedules.map(({ day_of_week, start_time, end_time }) => ({
      day_of_week,
      start_time,
      end_time,
    })));
  }, [open, isCreate, user]);

  const setPermissionEffect = (code: string, effect: RuleState) => {
    setRuleState((prev) => {
      const next = { ...prev };
      if (effect === "inherit") {
        delete next[code];
      } else {
        next[code] = effect;
      }
      return next;
    });
  };

  const handleRoleChange = (nextRole: UserRole) => {
    setRole(nextRole);
    if (nextRole === "admin") {
      setRuleState({});
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (isCreate) {
      if (!displayName.trim() || !login.trim() || password.length < 8) {
        setError(
          t(
            "users.form.validationRequired",
            "Display name, login, and password (min 8 characters) are required.",
          ),
        );
        return;
      }
      if (login.trim().includes("@")) {
        setError(
          t(
            "users.form.validationLoginFormat",
            "Login cannot contain @. Use email sign-in for email addresses.",
          ),
        );
        return;
      }
    } else if (!user) {
      return;
    } else {
      const trimmedLogin = login.trim();
      if (!isOwner && trimmedLogin.length < 2) {
        setError(
          t(
            "users.form.validationLogin",
            "Login is required and must be at least 2 characters.",
          ),
        );
        return;
      }
      if (isOwner && trimmedLogin.length > 0 && trimmedLogin.length < 2) {
        setError(
          t(
            "users.form.validationLogin",
            "Login is required and must be at least 2 characters.",
          ),
        );
        return;
      }
      if (trimmedLogin.includes("@")) {
        setError(
          t(
            "users.form.validationLoginFormat",
            "Login cannot contain @. Use email sign-in for email addresses.",
          ),
        );
        return;
      }
    }

    if (!isOwner) {
      const invalidTime = schedules.some(
        (s) => !isValidScheduleTime(s.start_time) || !isValidScheduleTime(s.end_time),
      );
      if (invalidTime) {
        setError(
          t(
            "users.form.validationSchedule",
            "Schedule times must use 24-hour format HH:MM (e.g. 09:00, 17:30).",
          ),
        );
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

    const permission_rules = role === "employee" ? stateToRules(ruleState) : [];

    setSaving(true);
    try {
      if (isCreate) {
        const created = await createUser(token, {
          login: login.trim(),
          password,
          display_name: displayName.trim(),
          role,
          permission_rules,
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

      const trimmedLogin = login.trim();
      if (trimmedLogin !== (user!.login ?? "")) {
        body.login = trimmedLogin;
      }

      if (password.trim()) {
        body.password = password;
      }
      if (!isOwner) {
        body.role = role;
        body.is_active = isActive;
        body.permission_rules = permission_rules;
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
      title={
        isCreate
          ? t("users.form.addTitle", "Add user")
          : t("users.form.editTitle", "Edit user")
      }
      size="lg"
    >
      <form onSubmit={handleSubmit} className={styles.formGrid}>
        {error && <div className={styles.formError}>{error}</div>}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="user-display-name">
            {t("users.form.displayName", "Display name")}
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
            {t("users.form.login", "Login")}
          </label>
          <input
            id="user-login"
            className={styles.input}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required={isCreate || !isOwner}
          />
          <p className={styles.hint}>
            {isOwner
              ? t(
                  "users.form.loginOwnerHint",
                  "Optional username for sign-in. You can still use your email address.",
                )
              : t(
                  "users.form.loginHint",
                  "Username used to sign in to the application.",
                )}
          </p>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="user-password">
            {t("users.form.password", "Password")}
          </label>
          <input
            id="user-password"
            type="password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={isCreate}
            minLength={isCreate ? 8 : undefined}
            placeholder={
              isCreate ? "" : t("users.form.passwordPlaceholder", "Leave blank to keep current password")
            }
          />
        </div>

        {!isOwner && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="user-role">
              {t("users.form.role", "Role")}
            </label>
            <select
              id="user-role"
              className={styles.select}
              value={role}
              onChange={(e) => handleRoleChange(e.target.value as UserRole)}
            >
              {EDITABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r === "admin"
                    ? t("users.role.admin", "Admin")
                    : t("users.role.employee", "Employee")}
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
                <div className={styles.label}>{t("users.form.active", "Active")}</div>
                <p className={styles.hint}>
                  {isOwner
                    ? t("users.form.ownerCannotDeactivate", "Owner account cannot be deactivated.")
                    : t("users.form.inactiveCannotSignIn", "Inactive users cannot sign in.")}
                </p>
              </div>
            </div>
          </div>
        )}

        {role === "employee" && (
          <div className={styles.field}>
            <div className={styles.sectionTitle}>
              {t("users.form.permissionsTitle", "Permissions")}
            </div>
            <p className={styles.hint}>
              {t(
                "users.form.permissionsHint",
                "Set Allow or Deny rules for each permission. Inherit uses the employee role default.",
              )}
            </p>
            {PERMISSION_GROUPS.map((group) => {
              const groupCodes = group.codes.filter((code) =>
                CONFIGURABLE_PERMISSION_CODES.includes(code),
              );
              if (groupCodes.length === 0) return null;

              return (
                <div key={group.id} className={styles.permissionGroup}>
                  <div className={styles.permissionGroupTitle}>
                    {t(group.labelKey, group.fallback)}
                  </div>
                  <div className={styles.permissionMatrix}>
                    <div className={styles.permissionMatrixHeader}>
                      <span>{t("users.permissions.column.permission", "Permission")}</span>
                      <span>{t("users.permissions.effect.inherit", "Inherit")}</span>
                      <span>{t("users.permissions.effect.allow", "Allow")}</span>
                      <span>{t("users.permissions.effect.deny", "Deny")}</span>
                    </div>
                    {groupCodes.map((code) => {
                      const perm = permissionByCode.get(code);
                      if (!perm) return null;
                      const current = ruleState[code] ?? "inherit";
                      const isDefault = isRoleDefaultPermission("employee", code);

                      return (
                        <div key={code} className={styles.permissionMatrixRow}>
                          <div className={styles.permissionMatrixLabel}>
                            <div>{t(permissionNameKey(code), code)}</div>
                            <div className={styles.checkboxDesc}>
                              {t(permissionDescriptionKey(code), perm.description)}
                            </div>
                            {isDefault && (
                              <div className={styles.permissionDefaultBadge}>
                                {t("users.permissions.roleDefault", "Included by default")}
                              </div>
                            )}
                          </div>
                          {(["inherit", "allow", "deny"] as const).map((effect) => (
                            <label key={effect} className={styles.permissionEffectCell}>
                              <input
                                type="radio"
                                name={`perm-${code}`}
                                checked={current === effect}
                                onChange={() => setPermissionEffect(code, effect)}
                                aria-label={`${t(permissionNameKey(code), code)} — ${t(`users.permissions.effect.${effect}`, effect)}`}
                              />
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {role === "admin" && (
          <p className={styles.hint}>
            {t("users.form.adminDefaults", "Admins receive all permissions by default.")}
          </p>
        )}

        {!isOwner && <ScheduleEditor schedules={schedules} onChange={setSchedules} />}

        <div className={styles.modalActions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving
              ? t("common.saving", "Saving…")
              : isCreate
                ? t("users.form.createUser", "Create user")
                : t("users.form.saveChanges", "Save changes")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
