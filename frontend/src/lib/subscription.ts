import type { AuthUser, CompanySummary } from "@/types/auth";

export function isCompanySubscriptionActive(
  company: CompanySummary | null | undefined,
): boolean {
  if (!company) return false;
  const status = company.subscription_status;
  if (status !== "trial" && status !== "active") return false;
  if (!company.subscription_expires_at) return false;
  const expires = Date.parse(company.subscription_expires_at);
  if (Number.isNaN(expires)) return false;
  return expires > Date.now();
}

export function userNeedsBilling(user: AuthUser | null | undefined): boolean {
  return Boolean(user && !isCompanySubscriptionActive(user.company));
}
