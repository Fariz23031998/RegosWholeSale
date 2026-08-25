import { useEffect, useState } from "react";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { updateProfile } from "@/lib/auth-api";
import { formatAuthError } from "@/store/auth";
import type { AuthUser } from "@/types/auth";
import styles from "@/components/Users/Users.module.css";

type Props = {
  open: boolean;
  token: string;
  user: AuthUser;
  onClose: () => void;
  onSaved: (user: AuthUser) => void;
};

export function ProfileEditModal({ open, token, user, onClose, onSaved }: Props) {
  const { t } = useLanguage();
  const [displayName, setDisplayName] = useState("");
  const [login, setLogin] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setSaving(false);
    setDisplayName(user.display_name);
    setLogin(user.login ?? "");
    setCurrentPassword("");
    setNewPassword("");
  }, [open, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const nextDisplayName = displayName.trim();
    const nextLogin = login.trim();
    const wantsPasswordChange = newPassword.length > 0;

    if (!nextDisplayName) {
      setError(t("profile.validationDisplayName", "Display name is required."));
      return;
    }

    if (nextLogin && nextLogin.length < 2) {
      setError(
        t("profile.validationLogin", "Login must be at least 2 characters."),
      );
      return;
    }

    if (nextLogin.includes("@")) {
      setError(
        t(
          "users.form.validationLoginFormat",
          "Login cannot contain @. Use email sign-in for email addresses.",
        ),
      );
      return;
    }

    if (wantsPasswordChange) {
      if (!currentPassword) {
        setError(
          t(
            "profile.validationCurrentPassword",
            "Current password is required to set a new password.",
          ),
        );
        return;
      }
      if (newPassword.length < 8) {
        setError(
          t(
            "profile.validationNewPassword",
            "New password must be at least 8 characters.",
          ),
        );
        return;
      }
    }

    const payload: {
      display_name?: string;
      login?: string;
      current_password?: string;
      new_password?: string;
    } = {};

    if (nextDisplayName !== user.display_name) {
      payload.display_name = nextDisplayName;
    }
    if (nextLogin !== (user.login ?? "")) {
      if (!nextLogin) {
        setError(
          t(
            "profile.validationLoginRequired",
            "Login cannot be cleared. Enter a username or leave the current value.",
          ),
        );
        return;
      }
      payload.login = nextLogin;
    }
    if (wantsPasswordChange) {
      payload.current_password = currentPassword;
      payload.new_password = newPassword;
    }

    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const updated = await updateProfile(token, payload);
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
      title={t("profile.editTitle", "Edit profile")}
      size="md"
    >
      <form className={styles.formGrid} onSubmit={handleSubmit}>
        {error && <div className={styles.formError}>{error}</div>}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="profile-display-name">
            {t("profile.displayName", "Display name")}
          </label>
          <input
            id="profile-display-name"
            className={styles.input}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
            disabled={saving}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="profile-login">
            {t("profile.login", "Login")}
          </label>
          <input
            id="profile-login"
            className={styles.input}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            disabled={saving}
          />
          <p className={styles.hint}>
            {user.email
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
          <label className={styles.label} htmlFor="profile-current-password">
            {t("profile.currentPassword", "Current password")}
          </label>
          <input
            id="profile-current-password"
            className={styles.input}
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            disabled={saving}
          />
          <p className={styles.hint}>
            {t(
              "profile.currentPasswordHint",
              "Required only when setting a new password.",
            )}
          </p>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="profile-new-password">
            {t("profile.newPassword", "New password")}
          </label>
          <input
            id="profile-new-password"
            className={styles.input}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            placeholder={t(
              "users.form.passwordPlaceholder",
              "Leave blank to keep current password",
            )}
            disabled={saving}
          />
        </div>

        <div className={styles.modalActions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving
              ? t("common.saving", "Saving…")
              : t("profile.save", "Save changes")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
