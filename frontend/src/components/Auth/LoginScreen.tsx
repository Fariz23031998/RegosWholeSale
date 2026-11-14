import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AuthLayout } from "@/components/Auth/AuthLayout";
import { SetInitialPasswordForm } from "@/components/Auth/SetInitialPasswordForm";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLanguage } from "@/contexts/LanguageContext";
import { loginWithRegosSso } from "@/lib/auth-api";
import {
  loadRegosOAuthSdk,
  mapAppLanguageToRegos,
} from "@/lib/regos-oauth-sdk";
import { userNeedsBilling } from "@/lib/subscription";
import { formatAuthError, useAuth } from "@/store/auth";
import styles from "./Auth.module.css";

const SSO_CLIENT_ID = String(import.meta.env.VITE_REGOS_SSO_CLIENT_ID || "").trim();
const SSO_REDIRECT_URI = String(
  import.meta.env.VITE_REGOS_SSO_REDIRECT_URI || "",
).trim();
const SSO_FLAG = String(import.meta.env.VITE_REGOS_SSO_ENABLED || "")
  .trim()
  .toLowerCase();
const SSO_FLAG_ON = SSO_FLAG === "true" || SSO_FLAG === "1" || SSO_FLAG === "yes";
const SSO_ENABLED = SSO_FLAG_ON && Boolean(SSO_CLIENT_ID && SSO_REDIRECT_URI);

/** SDK often reports this on init when there is no saved REGOS session. */
function isBenignSsoMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === "no access token" ||
    normalized.includes("not authenticated") ||
    normalized.includes("user is not authenticated") ||
    normalized.includes("no token")
  );
}

function isDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export function LoginScreen() {
  const { t, currentLanguage } = useLanguage();

  const navigate = useNavigate();
  const search = useSearch({ from: "/login" });
  const login = useAuth((s) => s.login);
  const setSession = useAuth((s) => s.setSession);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ssoSessionToken, setSsoSessionToken] = useState<string | null>(null);
  const ssoBusy = useRef(false);

  const goAfterAuth = () => {
    const user = useAuth.getState().user;
    if (userNeedsBilling(user)) {
      void navigate({ to: "/billing" });
    } else {
      void navigate({ to: "/" });
    }
  };

  useEffect(() => {
    if (!SSO_ENABLED) return;

    let cancelled = false;

    const mountSso = async () => {
      try {
        const sdk = await loadRegosOAuthSdk();
        if (cancelled) return;

        sdk.initialize({
          clientId: SSO_CLIENT_ID,
          redirectUri: SSO_REDIRECT_URI,
          containerId: "regos-login",
          language: mapAppLanguageToRegos(currentLanguage),
          buttonSize: "l",
          buttonTheme: isDarkTheme() ? "dark" : "light",
          buttonType: "icon-text",
          buttonTextType: "full",
          buttonBorderRadius: 8,
          flow: "auto",
          silent: false,
          onData: (user, accessToken) => {
            if (!user || !accessToken) return;
            if (ssoBusy.current) return;
            ssoBusy.current = true;
            setError("");
            setLoading(true);
            void (async () => {
              try {
                const authData = await loginWithRegosSso(accessToken);
                setSession(authData.access_token, authData.user);
                if (authData.requires_password_setup) {
                  setSsoSessionToken(authData.access_token);
                  return;
                }
                const nextUser = useAuth.getState().user;
                if (userNeedsBilling(nextUser)) {
                  void navigate({ to: "/billing" });
                } else {
                  void navigate({ to: "/" });
                }
              } catch (err) {
                setError(formatAuthError(err));
              } finally {
                setLoading(false);
                ssoBusy.current = false;
              }
            })();
          },
          onError: (sdkError) => {
            const message =
              sdkError instanceof Error
                ? sdkError.message
                : String(sdkError.message || t("auth.ssoFailed", "REGOS sign-in failed"));
            if (isBenignSsoMessage(message)) return;
            setError(message);
          },
        });
      } catch (err) {
        if (!cancelled) {
          setError(formatAuthError(err));
        }
      }
    };

    void mountSso();
    return () => {
      cancelled = true;
    };
  }, [currentLanguage, navigate, setSession, t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(identifier.trim(), password);
      goAfterAuth();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  if (ssoSessionToken) {
    return (
      <AuthLayout
        title={t("auth.title", "Regos Optom")}
        subtitle={t("auth.setInitialPasswordTitle", "Set your password")}
        headerAction={<LanguageSelector />}
      >
        <SetInitialPasswordForm
          accessToken={ssoSessionToken}
          onSuccess={goAfterAuth}
        />
      </AuthLayout>
    );
  }

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
              "Your trial has ended. Sign in to renew on the billing page.",
            )}
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.btn} disabled={loading}>
          {loading ? t("auth.signingIn", "Signing in…") : t("auth.signIn", "Sign in")}
        </button>
      </form>

      {SSO_ENABLED ? (
        <>
          <div className={styles.ssoDivider}>{t("auth.or", "or")}</div>
          <div className={styles.ssoWrap}>
            <div id="regos-login" />
          </div>
        </>
      ) : null}

      <p className={styles.footer} style={{ marginTop: 16 }}>
        <Link to="/reset-password" className={styles.link}>
          {t("auth.forgotPassword", "Forgot password?")}
        </Link>
        {" · "}
        <Link to="/docs" className={styles.link}>
          {t("nav.docs", "Documentation")}
        </Link>
      </p>
    </AuthLayout>
  );
}
