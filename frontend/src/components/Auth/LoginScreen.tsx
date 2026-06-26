import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AuthLayout } from "@/components/Auth/AuthLayout";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatAuthError, useAuth } from "@/store/auth";
import styles from "./Auth.module.css";

export function LoginScreen() {
  const { t } = useLanguage();

  const navigate = useNavigate();
  const search = useSearch({ from: "/login" });
  const login = useAuth((s) => s.login);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(identifier.trim(), password);
      navigate({ to: "/" });
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={t("auth.title", "Regos Optom")}
      subtitle={t("auth.signInSubtitle", "Sign in to your account")}
      headerAction={<LanguageSelector />}
      footer={
        <p className={styles.footer}>
          {t("auth.newCompany", "New company?")}{" "}
          <Link to="/register" className={styles.link}>
            {t("auth.createAccount", "Create account")}
          </Link>
        </p>
      }
    >
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label htmlFor="identifier">{t("auth.emailOrUsername", "Email or username")}</label>
          <input
            id="identifier"
            type="text"
            className={styles.input}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="password">{t("auth.password", "Password")}</label>
          <input
            id="password"
            type="password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {search.reset === "success" && (
          <p className={styles.success}>
            {t("auth.passwordUpdated", "Password updated. You can sign in now.")}
          </p>
        )}
        {search.subscription === "expired" && (
          <p className={styles.error}>
            {t(
              "auth.subscriptionExpired",
              "Your trial has ended. Contact support to continue using the service.",
            )}
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.btn} disabled={loading}>
          {loading ? t("auth.signingIn", "Signing in…") : t("auth.signIn", "Sign in")}
        </button>
      </form>

      <p className={styles.footer} style={{ marginTop: 16 }}>
        <Link to="/reset-password" className={styles.link}>
          {t("auth.forgotPassword", "Forgot password?")}
        </Link>
      </p>
    </AuthLayout>
  );
}
