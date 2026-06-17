import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AuthLayout } from "@/components/Auth/AuthLayout";
import { VerificationCodeInput } from "@/components/Auth/VerificationCodeInput";
import { resetPassword, sendVerificationCode } from "@/lib/auth-api";
import { formatAuthError } from "@/store/auth";
import styles from "./Auth.module.css";

type Step = "email" | "reset";

export function ResetPasswordScreen() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      await sendVerificationCode(email.trim(), "reset_password");
      setInfo("Verification code sent to your email");
      setStep("reset");
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (code.length !== 6) {
      setError("Enter the 6-digit verification code");
      return;
    }
    setLoading(true);
    try {
      await resetPassword({
        email: email.trim(),
        verification_code: code,
        new_password: newPassword,
      });
      navigate({ to: "/login", search: { reset: "success" } });
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Reset password"
      subtitle="We'll email you a verification code"
      footer={
        <p className={styles.footer}>
          <Link to="/login" className={styles.link}>
            Back to sign in
          </Link>
        </p>
      }
    >
      {step === "email" ? (
        <form className={styles.form} onSubmit={sendCode}>
          <div className={styles.field}>
            <label htmlFor="resetEmail">Email</label>
            <input
              id="resetEmail"
              type="email"
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
        <form className={styles.form} onSubmit={submitReset}>
          <p className={styles.stepHint}>Code sent to {email}</p>
          <VerificationCodeInput value={code} onChange={setCode} disabled={loading} />
          <div className={styles.field}>
            <label htmlFor="newPassword">New password</label>
            <input
              id="newPassword"
              type="password"
              className={styles.input}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? "Updating…" : "Set new password"}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
