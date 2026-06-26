import { apiRequest } from "./api";

export type PlatformAdmin = {
  id: number;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
};

export type DashboardStats = {
  total: number;
  trial: number;
  active: number;
  expired: number;
  suspended: number;
  expiring_soon: number;
  payment_count: number;
  payment_total: number;
};

export type CompanyListItem = {
  id: number;
  name: string;
  slug: string;
  subscription_status: string;
  subscription_expires_at: string;
  created_at: string;
  user_count: number;
  owner_email: string | null;
};

export type CompanyDetail = CompanyListItem & {
  timezone: string;
  internal_notes: string | null;
  owner: { id: number; email: string | null; display_name: string } | null;
};

export type SubscriptionPayment = {
  id: number;
  company_id: number;
  amount: number;
  currency: string;
  period_months: number;
  period_days: number;
  paid_at: string;
  notes: string | null;
  recorded_by_name: string | null;
  created_at: string;
};

export type SubscriptionPaymentListItem = SubscriptionPayment & {
  company_name: string;
};

export async function platformLogin(login: string, password: string) {
  return apiRequest<{ access_token: string; admin: PlatformAdmin }>("/api/v1/platform/auth/login", {
    body: { login, password },
  });
}

export async function fetchPlatformMe(token: string) {
  return apiRequest<PlatformAdmin>("/api/v1/platform/auth/me", { token });
}

export async function fetchStats(token: string) {
  return apiRequest<DashboardStats>("/api/v1/platform/stats", { token });
}

export async function fetchCompanies(
  token: string,
  params?: { status?: string; search?: string; offset?: number; limit?: number },
) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.search) qs.set("search", params.search);
  if (params?.offset != null) qs.set("offset", String(params.offset));
  if (params?.limit != null) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return apiRequest<{ items: CompanyListItem[]; total: number }>(
    `/api/v1/platform/companies${query ? `?${query}` : ""}`,
    { token },
  );
}

export async function fetchCompany(token: string, id: number) {
  return apiRequest<CompanyDetail>(`/api/v1/platform/companies/${id}`, { token });
}

export async function createCompany(
  token: string,
  body: {
    company_name: string;
    owner_email: string;
    owner_password: string;
    owner_display_name: string;
    trial_days?: number;
    active_days?: number;
  },
) {
  return apiRequest<CompanyDetail>("/api/v1/platform/companies", { token, body });
}

export async function updateCompany(
  token: string,
  id: number,
  body: {
    status?: string;
    extend_days?: number;
    internal_notes?: string;
    reset_subscription?: boolean;
  },
) {
  return apiRequest<CompanyDetail>(`/api/v1/platform/companies/${id}`, {
    token,
    method: "PATCH",
    body,
  });
}

export async function fetchCompanyPayments(token: string, companyId: number) {
  return apiRequest<SubscriptionPayment[]>(
    `/api/v1/platform/companies/${companyId}/payments`,
    { token },
  );
}

export async function fetchPayments(
  token: string,
  params?: { company_id?: number; search?: string; offset?: number; limit?: number },
) {
  const qs = new URLSearchParams();
  if (params?.company_id != null) qs.set("company_id", String(params.company_id));
  if (params?.search) qs.set("search", params.search);
  if (params?.offset != null) qs.set("offset", String(params.offset));
  if (params?.limit != null) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return apiRequest<{ items: SubscriptionPaymentListItem[]; total: number }>(
    `/api/v1/platform/payments${query ? `?${query}` : ""}`,
    { token },
  );
}

export async function recordCompanyPayment(
  token: string,
  companyId: number,
  body: {
    amount: number;
    currency?: string;
    period_months: number;
    notes?: string;
  },
) {
  return apiRequest<{ payment: SubscriptionPayment; company: CompanyDetail }>(
    `/api/v1/platform/companies/${companyId}/payments`,
    { token, body },
  );
}

export async function updatePayment(
  token: string,
  paymentId: number,
  body: {
    amount?: number;
    currency?: string;
    period_months?: number;
    paid_at?: string;
    notes?: string;
  },
) {
  return apiRequest<SubscriptionPayment>(`/api/v1/platform/payments/${paymentId}`, {
    token,
    method: "PATCH",
    body,
  });
}

export async function fetchAdmins(token: string) {
  return apiRequest<PlatformAdmin[]>("/api/v1/platform/admins", { token });
}

export async function createAdmin(
  token: string,
  body: { email: string; password: string; display_name: string },
) {
  return apiRequest<PlatformAdmin>("/api/v1/platform/admins", { token, body });
}

export async function updateAdmin(
  token: string,
  id: number,
  body: { display_name?: string; password?: string; is_active?: boolean },
) {
  return apiRequest<PlatformAdmin>(`/api/v1/platform/admins/${id}`, {
    token,
    method: "PATCH",
    body,
  });
}
