import type { AuthUser, CompanySummary } from "@/types/auth";

export type BillingAction = "pay" | "renew" | "extend";

export type SubscriptionLike = {
  subscription_status?: string | null;
  subscription_expires_at?: string | null;
  subscription_active?: boolean;
};

export function getSubscriptionExpiryMs(
  company: SubscriptionLike | null | undefined,
): number | null {
  if (!company?.subscription_expires_at) return null;
  const expires = Date.parse(company.subscription_expires_at);
  if (Number.isNaN(expires)) return null;
  return expires;
}

export function daysUntilSubscriptionExpires(
  company: SubscriptionLike | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  const expires = getSubscriptionExpiryMs(company);
  if (expires == null) return null;
  return Math.ceil((expires - nowMs) / (24 * 60 * 60 * 1000));
}

export function isCompanySubscriptionActive(
  company: CompanySummary | null | undefined,
): boolean {
  if (!company) return false;
  const status = company.subscription_status;
  if (status !== "trial" && status !== "active") return false;
  const expires = getSubscriptionExpiryMs(company);
  if (expires == null) return false;
  return expires > Date.now();
}

export function userNeedsBilling(user: AuthUser | null | undefined): boolean {
  return Boolean(user && !isCompanySubscriptionActive(user.company));
}

/** Decide pay / renew / extend CTA from company or billing API payload. */
export function getBillingAction(
  source: SubscriptionLike | null | undefined,
): BillingAction {
  if (!source) return "pay";

  const status = (source.subscription_status ?? "").toLowerCase();
  const activeFlag = source.subscription_active;
  const active =
    typeof activeFlag === "boolean"
      ? activeFlag
      : (() => {
          if (status !== "trial" && status !== "active") return false;
          const expires = getSubscriptionExpiryMs(source);
          return expires != null && expires > Date.now();
        })();

  if (active) return "extend";
  if (status === "trial" || status === "active" || status === "expired") return "renew";
  return "pay";
}
