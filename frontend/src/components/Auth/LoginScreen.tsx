import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AuthLayout } from "@/components/Auth/AuthLayout";
import { formatAuthError, useAuth } from "@/store/auth";
import styles from "./Auth.module.css";

export function LoginScreen() {
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
      title="Regos Optom"
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
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label htmlFor="identifier">Email or username</label>
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
