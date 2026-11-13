import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AuthLayout } from "@/components/Auth/AuthLayout";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  createCheckout,
  fetchBillingSubscription,
  fetchCheckoutOrder,
  type BillingSubscription,
} from "@/lib/billing-api";
import { ApiError } from "@/lib/api";
import { isCompanySubscriptionActive } from "@/lib/subscription";
import { useAuth } from "@/store/auth";
import styles from "@/components/Auth/Auth.module.css";

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currency}`;
  }
}

export function BillingPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const search = useSearch({ from: "/billing" });
  const accessToken = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const refreshMe = useAuth((s) => s.refreshMe);
  const logout = useAuth((s) => s.logout);

  const [billing, setBilling] = useState<BillingSubscription | null>(null);
  const [periodMonths, setPeriodMonths] = useState(1);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const orderId = typeof search.order_id === "string" ? search.order_id : undefined;

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchBillingSubscription(accessToken)
      .then((data) => {
        if (cancelled) return;
        setBilling(data);
        if (data.allowed_periods.length > 0) {
          setPeriodMonths(data.allowed_periods[0]);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !orderId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setPolling(true);
    setSuccess("");
    setError("");

    const poll = async () => {
      try {
        const order = await fetchCheckoutOrder(accessToken, orderId);
        if (cancelled) return;
        if (order.status === "paid") {
          setSuccess(
            t("billing.paymentSuccess", "Payment received. Your subscription is active."),
          );
          setPolling(false);
          await refreshMe();
          return;
        }
        if (order.status === "expired" || order.status === "cancelled") {
          setError(t("billing.orderExpired", "This payment order expired. Start a new checkout."));
          setPolling(false);
          return;
        }
        timer = setTimeout(() => {
          void poll();
        }, 2500);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : String(err));
        setPolling(false);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [accessToken, orderId, refreshMe, t]);

  const totalAmount = useMemo(() => {
    if (!billing) return 0;
    return billing.monthly_price_uzs * periodMonths;
  }, [billing, periodMonths]);

  const active = billing?.subscription_active ?? isCompanySubscriptionActive(user?.company);

  const startCheckout = async () => {
    if (!accessToken) return;
    setPaying(true);
    setError("");
    setSuccess("");
    try {
      const res = await createCheckout(accessToken, periodMonths);
      window.open(res.payment_url, "_blank", "noopener,noreferrer");
      await navigate({
        to: "/billing",
        search: { order_id: res.order.id },
        replace: true,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setPaying(false);
    }
  };

  return (
    <AuthLayout
      title={t("billing.title", "Subscription")}
      subtitle={t(
        "billing.subtitle",
        "Renew your Regos Optom subscription with Click.",
      )}
      headerAction={<LanguageSelector />}
      footer={
        <p className={styles.footer}>
          <button
            type="button"
            className={styles.link}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
            onClick={() => {
              logout();
              void navigate({ to: "/login" });
            }}
          >
            {t("auth.signOut", "Sign out")}
          </button>
          {active ? (
            <>
              {" · "}
              <Link to="/" className={styles.link}>
                {t("billing.backToApp", "Back to app")}
              </Link>
            </>
          ) : null}
        </p>
      }
    >
      <div className={styles.form}>
        {loading ? (
          <p className={styles.subtitle}>{t("billing.loading", "Loading…")}</p>
        ) : (
          <>
            <div className={styles.field}>
              <label>{t("billing.status", "Status")}</label>
              <p className={styles.subtitle} style={{ marginBottom: 0 }}>
                {active
                  ? t("billing.statusActive", "Active until {{date}}").replace(
                      "{{date}}",
                      billing?.subscription_expires_at
                        ? new Date(billing.subscription_expires_at).toLocaleString()
                        : "—",
                    )
                  : t(
                      "billing.statusExpired",
                      "Expired. Pay with Click to continue using the service.",
                    )}
              </p>
            </div>

            {billing?.checkout_enabled ? (
              <>
                <div className={styles.field}>
                  <label htmlFor="period">{t("billing.period", "Period")}</label>
                  <select
                    id="period"
                    className={styles.input}
                    value={periodMonths}
                    onChange={(e) => setPeriodMonths(Number(e.target.value))}
                    disabled={paying || polling}
                  >
                    {(billing.allowed_periods.length
                      ? billing.allowed_periods
                      : [1, 3, 6, 12]
                    ).map((months) => (
                      <option key={months} value={months}>
                        {t("billing.months", "{{n}} months").replace("{{n}}", String(months))}
                        {" — "}
                        {formatMoney(
                          billing.monthly_price_uzs * months,
                          billing.currency || "UZS",
                        )}
                      </option>
                    ))}
                  </select>
                </div>

                <p className={styles.subtitle}>
                  {t("billing.total", "Total")}:{" "}
                  {formatMoney(totalAmount, billing.currency || "UZS")}
                </p>

                <button
                  type="button"
                  className={styles.btn}
                  disabled={paying || polling}
                  onClick={() => void startCheckout()}
                >
                  {paying
                    ? t("billing.starting", "Starting…")
                    : polling
                      ? t("billing.waitingPayment", "Waiting for payment…")
                      : t("billing.payWithClick", "Pay with Click")}
                </button>
              </>
            ) : (
              <p className={styles.error}>
                {t(
                  "billing.checkoutDisabled",
                  "Online checkout is not configured yet. Contact support to renew.",
                )}
              </p>
            )}
          </>
        )}

        {polling && (
          <p className={styles.subtitle}>
            {t(
              "billing.pollingHint",
              "Complete payment in the Click tab. This page updates automatically.",
            )}
          </p>
        )}
        {success && <p className={styles.success}>{success}</p>}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </AuthLayout>
  );
}
