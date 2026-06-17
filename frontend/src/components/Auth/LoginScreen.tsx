import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import clsx from "clsx";
import { AuthLayout } from "@/components/Auth/AuthLayout";
import { formatAuthError, useAuth } from "@/store/auth";
import styles from "./Auth.module.css";

type Tab = "owner" | "employee";

export function LoginScreen() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/login" }) as { reset?: string };
  const loginOwner = useAuth((s) => s.loginOwner);
  const loginEmployee = useAuth((s) => s.loginEmployee);

  const [tab, setTab] = useState<Tab>("owner");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companySlug, setCompanySlug] = useState("");
  const [login, setLogin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (tab === "owner") {
        await loginOwner(email.trim(), password);
      } else {
        await loginEmployee(companySlug.trim(), login.trim(), password);
      }
      navigate({ to: "/" });
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Regos Wholesale"
      subtitle="Sign in to your account"
      footer={
        <p className={styles.footer}>
          New company?{" "}
          <Link to="/register" className={styles.link}>
            Create account
          </Link>
        </p>
      }
    >
      <div className={styles.tabs}>
        <button
          type="button"
          className={clsx(styles.tab, tab === "owner" && styles.tabActive)}
          onClick={() => setTab("owner")}
        >
          Owner / Admin
        </button>
        <button
          type="button"
          className={clsx(styles.tab, tab === "employee" && styles.tabActive)}
          onClick={() => setTab("employee")}
        >
          Employee
        </button>
      </div>

      <form className={styles.form} onSubmit={submit}>
        {tab === "owner" ? (
          <>
            <div className={styles.field}>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="password">Password</label>
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
          </>
        ) : (
          <>
            <div className={styles.field}>
              <label htmlFor="companySlug">Company ID (slug)</label>
              <input
                id="companySlug"
                type="text"
                className={styles.input}
                value={companySlug}
                onChange={(e) => setCompanySlug(e.target.value)}
                placeholder="e.g. regos-wholesale"
                required
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="login">Login</label>
              <input
                id="login"
                type="text"
                className={styles.input}
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="empPassword">Password</label>
              <input
                id="empPassword"
                type="password"
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
          </>
        )}

        {search.reset === "success" && (
          <p className={styles.success}>Password updated. You can sign in now.</p>
        )}
        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.btn} disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className={styles.footer} style={{ marginTop: 16 }}>
        <Link to="/reset-password" className={styles.link}>
          Forgot password?
        </Link>
      </p>
    </AuthLayout>
  );
}
