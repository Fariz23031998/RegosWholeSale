import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AuthLayout } from "@/components/Auth/AuthLayout";
import { SetInitialPasswordForm } from "@/components/Auth/SetInitialPasswordForm";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLanguage } from "@/contexts/LanguageContext";
import { loginWithRegosIntegration } from "@/lib/auth-api";
import { formatAuthError, useAuth } from "@/store/auth";
import styles from "@/components/Auth/Auth.module.css";

const TOKEN_PATTERN = /^[a-f0-9]{32}$/i;

export const Route = createFileRoute("/integration/callback/$token")({
  component: IntegrationCallbackPage,
});

function IntegrationCallbackPage() {
  const { token } = Route.useParams();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const clearSession = useAuth((s) => s.clearSession);

  const [status, setStatus] = useState<"loading" | "set_password" | "error">("loading");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!TOKEN_PATTERN.test(token)) {
      void navigate({ to: "/login", replace: true });
      return;
    }
    if (started.current) return;
    started.current = true;

    const authorize = async () => {
      clearSession();
      try {
        const authData = await loginWithRegosIntegration(token.toLowerCase());
        setSession(authData.access_token, authData.user);
        if (authData.requires_password_setup) {
          setSessionToken(authData.access_token);
          setStatus("set_password");
          return;
        }
        void navigate({ to: "/", replace: true });
      } catch (err) {
        setErrorMessage(formatAuthError(err));
        setStatus("error");
      }
    };

    void authorize();
  }, [token, navigate, setSession, clearSession]);

  const handlePasswordSet = () => {
    void navigate({ to: "/", replace: true });
  };

  return (
    <AuthLayout
      title={t("auth.title", "Regos Optom")}
      subtitle={
        status === "loading"
          ? t("auth.integrationAuthorizing", "Authorizing integration…")
          : status === "set_password"
            ? t("auth.setInitialPasswordTitle", "Set your password")
            : t("auth.integrationErrorTitle", "Authorization failed")
      }
      headerAction={<LanguageSelector />}
      footer={
        status === "error" ? (
          <p className={styles.footer}>
            <Link to="/login" className={styles.link}>
              {t("auth.backToSignIn", "Back to sign in")}
            </Link>
          </p>
        ) : null
      }
    >
      {status === "loading" ? (
        <p className={styles.subtitle} style={{ marginBottom: 0 }}>
          {t("auth.integrationAuthorizing", "Authorizing integration…")}
        </p>
      ) : null}

      {status === "set_password" && sessionToken ? (
        <SetInitialPasswordForm
          accessToken={sessionToken}
          onSuccess={handlePasswordSet}
        />
      ) : null}

      {status === "error" ? (
        <div className={styles.form}>
          {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
          <Link to="/login" className={styles.btn} style={{ textAlign: "center" }}>
            {t("auth.backToSignIn", "Back to sign in")}
          </Link>
        </div>
      ) : null}
    </AuthLayout>
  );
}
