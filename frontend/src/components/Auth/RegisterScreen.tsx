import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AuthLayout } from "@/components/Auth/AuthLayout";
import { VerificationCodeInput } from "@/components/Auth/VerificationCodeInput";
import { sendVerificationCode, registerOwner } from "@/lib/auth-api";
import { formatAuthError, useAuth } from "@/store/auth";
import styles from "./Auth.module.css";

type Step = "form" | "verify";

export function RegisterScreen() {
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);

  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const sendCode = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setInfo("");

    const fd = new FormData(e.currentTarget);
    const emailVal = String(fd.get("email") ?? "").trim();
    const passwordVal = String(fd.get("password") ?? "");
    const displayVal = String(fd.get("display_name") ?? "").trim();
    const companyVal = String(fd.get("company_name") ?? "").trim();

    setEmail(emailVal);
    setPassword(passwordVal);
    setDisplayName(displayVal);
    setCompanyName(companyVal);

    if (!emailVal) {
      setError("Enter your email first");
      return;
    }
    if (passwordVal.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!displayVal || !companyVal) {
      setError("Enter your name and company name");
      return;
    }

    setLoading(true);
    try {
      await sendVerificationCode(emailVal, "register");
      setInfo("Verification code sent to your email");
      setStep("verify");
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const submitRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const fd = new FormData(e.currentTarget);
    const emailVal = String(fd.get("email") ?? email).trim();
    const passwordVal = String(fd.get("password") ?? password);
    const displayVal = String(fd.get("display_name") ?? displayName).trim();
    const companyVal = String(fd.get("company_name") ?? companyName).trim();
    const verificationCode = String(fd.get("verification_code") ?? code).replace(/\D/g, "");

    if (verificationCode.length !== 6) {
      setError("Enter the 6-digit verification code");
      return;
    }
    if (passwordVal.length < 8) {
      setError("Password must be at least 8 characters. Go back and re-enter your password.");
      return;
    }

    setLoading(true);
    try {
      const res = await registerOwner({
        email: emailVal,
        password: passwordVal,
        display_name: displayVal,
        company_name: companyVal,
        verification_code: verificationCode,
      });
      setSession(res.access_token, res.user);
      navigate({ to: "/" });
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create your company"
      subtitle="Register as the first owner account"
      footer={
        <p className={styles.footer}>
          Already have an account?{" "}
          <Link to="/login" className={styles.link}>
            Sign in
          </Link>
        </p>
      }
    >
      {step === "form" ? (
        <form className={styles.form} onSubmit={sendCode}>
          <div className={styles.field}>
            <label htmlFor="regEmail">Email</label>
            <input
              id="regEmail"
              name="email"
              type="email"
              autoComplete="email"
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="regPassword">Password</label>
            <input
              id="regPassword"
              name="password"
              type="password"
              autoComplete="new-password"
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="displayName">Your name</label>
            <input
              id="displayName"
              name="display_name"
              type="text"
              autoComplete="name"
              className={styles.input}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="companyName">Company name</label>
            <input
              id="companyName"
              name="company_name"
              type="text"
              autoComplete="organization"
              className={styles.input}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
            />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          {info && <p className={styles.success}>{info}</p>}
          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? "Sending…" : "Send verification code"}
          </button>
        </form>
      ) : (
        <form className={styles.form} onSubmit={submitRegister}>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="password" value={password} />
          <input type="hidden" name="display_name" value={displayName} />
          <input type="hidden" name="company_name" value={companyName} />
          <input type="hidden" name="verification_code" value={code.replace(/\D/g, "")} />
          <p className={styles.stepHint}>Code sent to {email}</p>
          <VerificationCodeInput value={code} onChange={setCode} disabled={loading} />
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? "Creating account…" : "Create account"}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            disabled={loading}
            onClick={() => {
              setStep("form");
              setCode("");
            }}
          >
            Back
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
