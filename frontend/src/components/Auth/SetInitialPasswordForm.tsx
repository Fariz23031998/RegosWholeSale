import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { setInitialPassword } from "@/lib/auth-api";
import { formatAuthError } from "@/store/auth";
import styles from "./Auth.module.css";

type Props = {
  accessToken: string;
  onSuccess: () => void;
};

export function SetInitialPasswordForm({ accessToken, onSuccess }: Props) {
  const { t } = useLanguage();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const validate = (): string | null => {
    if (!newPassword || !confirmPassword) {
      return t("auth.fillAllFields", "Please fill in all fields");
    }
    if (newPassword !== confirmPassword) {
      return t("auth.passwordMismatch", "Passwords do not match");
    }
    if (newPassword.length < 8) {
      return t("auth.passwordMinLength", "Password must be at least 8 characters");
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return t(
        "auth.passwordLettersAndDigits",
        "Password must contain letters and digits",
      );
    }
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setLoading(true);
    try {
      await setInitialPassword(accessToken, newPassword);
      setNewPassword("");
      setConfirmPassword("");
      onSuccess();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <p className={styles.stepHint} style={{ marginTop: 0, textAlign: "left" }}>
        {t(
          "auth.setInitialPasswordDesc",
          "Choose a password to finish signing in with Regos.",
        )}
      </p>
      <div className={styles.field}>
        <label htmlFor="initial-password">{t("auth.newPassword", "New password")}</label>
        <input
          id="initial-password"
          type="password"
          className={styles.input}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus
          required
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="initial-password-confirm">
          {t("auth.confirmPassword", "Confirm password")}
        </label>
        <input
          id="initial-password-confirm"
          type="password"
          className={styles.input}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      <button type="submit" className={styles.btn} disabled={loading}>
        {loading
          ? t("auth.saving", "Saving…")
          : t("auth.savePassword", "Save password")}
      </button>
    </form>
  );
}
