import { createContext, useContext, useEffect, useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { LanguageSelector } from "@/components/LanguageSelector";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { ApiError } from "@/lib/api";
import {
  authenticatePartnerWebApp,
  confirmPartnerPassword,
  fetchPartnerMe,
  loginPartnerPortal,
  requestPartnerPasswordCode,
  type PartnerTelegramAccount,
} from "@/lib/partner-telegram-api";
import { formatAuthError } from "@/store/auth";
import { partnerTokenKey } from "./partner-format";
import { PartnerShell } from "./PartnerShell";
import styles from "./PartnerPortal.module.css";

type TelegramWindow = Window & {
  Telegram?: { WebApp?: { initData: string; ready: () => void; expand: () => void } };
};

type PartnerSessionValue = {
  publicKey: string;
  token: string;
  account: PartnerTelegramAccount;
  compact: boolean;
  logout: () => void;
};

const PartnerSessionContext = createContext<PartnerSessionValue | null>(null);

export function usePartnerSession(): PartnerSessionValue {
  const value = useContext(PartnerSessionContext);
  if (!value) {
    throw new Error("Partner session is missing");
  }
  return value;
}

function loadTelegramScript(): Promise<void> {
  const telegram = (window as TelegramWindow).Telegram?.WebApp;
  if (telegram) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("telegram-script"));
    document.head.appendChild(script);
  });
}

export function PartnerPortal({ publicKey }: { publicKey: string }) {
  const { t, changeLanguage } = useLanguage();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [account, setAccount] = useState<PartnerTelegramAccount | null>(null);
  const [gate, setGate] = useState<"loading" | "login" | "unregistered" | "ready" | "error">("loading");
  const [compact, setCompact] = useState(false);
  const [gateMessage, setGateMessage] = useState("");

  const applySession = (token: string, next: PartnerTelegramAccount, fromTelegram: boolean) => {
    setAccessToken(token);
    setAccount(next);
    setCompact(fromTelegram);
    if (!fromTelegram) {
      sessionStorage.setItem(partnerTokenKey(publicKey), token);
    }
    if (next.language_code === "uz" || next.language_code === "ru" || next.language_code === "en") {
      void changeLanguage(next.language_code);
    }
    setGate(next.link_state === "linked" ? "ready" : "login");
    if (next.link_state !== "linked") {
      setGate("login");
      setAccount(next);
      setAccessToken(token);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let initData = "";
      try {
        await loadTelegramScript();
        const webApp = (window as TelegramWindow).Telegram?.WebApp;
        initData = webApp?.initData ?? "";
        if (initData) {
          webApp?.ready();
          webApp?.expand();
        }
      } catch {
        initData = "";
      }
      if (cancelled) return;
      if (initData) {
        try {
          const session = await authenticatePartnerWebApp(publicKey, initData);
          if (cancelled) return;
          applySession(session.access_token, session.account, true);
          if (session.account.link_state !== "linked") {
            setGate("login");
          }
        } catch (error) {
          if (cancelled) return;
          if (error instanceof ApiError && error.code === "PARTNER_TELEGRAM_NOT_REGISTERED") {
            setGate("unregistered");
            setCompact(true);
            return;
          }
          setGateMessage(formatAuthError(error));
          setGate("error");
        }
        return;
      }

      const stored = sessionStorage.getItem(partnerTokenKey(publicKey));
      if (!stored) {
        setGate("login");
        return;
      }
      try {
        const me = await fetchPartnerMe(stored);
        if (cancelled) return;
        applySession(stored, me, false);
      } catch {
        if (cancelled) return;
        sessionStorage.removeItem(partnerTokenKey(publicKey));
        setGate("login");
      }
    })();
    return () => {
      cancelled = true;
    };
    // applySession closes over changeLanguage; publicKey is the session boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  const logout = () => {
    sessionStorage.removeItem(partnerTokenKey(publicKey));
    setAccessToken(null);
    setAccount(null);
    setGate("login");
  };

  const acceptLogin = (token: string, next: PartnerTelegramAccount) => {
    applySession(token, next, compact);
  };

  if (gate === "loading") {
    return <main className={styles.gate}><p>{t("common.loading", "Loading...")}</p></main>;
  }
  if (gate === "unregistered") {
    return (
      <main className={styles.gate}>
        <p>{t("partnerApp.notRegistered", "Send /start in the bot and share your phone number first.")}</p>
      </main>
    );
  }
  if (gate === "error") {
    return <main className={styles.gate}><p>{gateMessage}</p></main>;
  }
  if (gate === "login" || !accessToken || !account || account.link_state !== "linked") {
    return (
      <main className={styles.gate}>
        <div className={styles.loginCard}>
          <div className={styles.loginTools}>
            <LanguageSelector />
          </div>
          {account && account.link_state !== "linked" ? (
            <>
              <p>{t("partnerApp.waitingLink", "Your phone number is saved. The company still needs to assign your partner id.")}</p>
              {compact ? null : (
                <button type="button" className={styles.textButton} onClick={logout}>
                  {t("partnerApp.signOut", "Sign out")}
                </button>
              )}
            </>
          ) : (
            <LoginForm publicKey={publicKey} onSession={acceptLogin} />
          )}
        </div>
      </main>
    );
  }

  return (
    <PartnerSessionContext.Provider value={{ publicKey, token: accessToken, account, compact, logout }}>
      <PartnerShell>
        <Outlet />
      </PartnerShell>
    </PartnerSessionContext.Provider>
  );
}

function LoginForm({
  publicKey,
  onSession,
}: {
  publicKey: string;
  onSession: (token: string, account: PartnerTelegramAccount) => void;
}) {
  const { t } = useLanguage();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"login" | "code">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      const session = await loginPartnerPortal(publicKey, phone.trim(), password);
      onSession(session.access_token, session.account);
    } catch (signInError) {
      setError(formatAuthError(signInError));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await requestPartnerPasswordCode(publicKey, phone.trim());
      setMode("code");
      setInfo(t("partnerApp.codeSent", "We sent a code to your Telegram chat."));
    } catch (requestError) {
      setError(formatAuthError(requestError));
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    setBusy(true);
    setError("");
    try {
      const session = await confirmPartnerPassword({
        publicKey,
        phone: phone.trim(),
        code: code.trim(),
        password,
      });
      onSession(session.access_token, session.account);
    } catch (confirmError) {
      setError(formatAuthError(confirmError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={styles.loginForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (mode === "code") void savePassword();
        else void signIn();
      }}
    >
      <h1>{t("partnerApp.loginTitle", "Partner sign in")}</h1>
      <p className={styles.muted}>
        {t("partnerApp.loginHint", "Use the phone number you shared with the partner bot.")}
      </p>
      <label className={styles.field}>
        {t("partnerApp.phone", "Phone")}
        <input className={styles.input} value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" />
      </label>
      <label className={styles.field}>
        {mode === "code" ? t("partnerApp.newPassword", "New password") : t("partnerApp.password", "Password")}
        <input
          className={styles.input}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === "code" ? "new-password" : "current-password"}
        />
      </label>
      {mode === "code" ? (
        <label className={styles.field}>
          {t("partnerApp.code", "Code")}
          <input className={styles.input} value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" />
        </label>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {info ? <p className={styles.muted}>{info}</p> : null}
      {mode === "login" ? (
        <Button type="submit" full disabled={busy || !phone.trim() || !password}>
          {t("partnerApp.signIn", "Sign in")}
        </Button>
      ) : (
        <Button type="submit" full disabled={busy || !phone.trim() || !password || !code.trim()}>
          {t("partnerApp.savePassword", "Save password")}
        </Button>
      )}
      <button type="button" className={styles.textButton} disabled={busy || !phone.trim()} onClick={() => void sendCode()}>
        {t("partnerApp.setPassword", "Set or change password")}
      </button>
    </form>
  );
}
