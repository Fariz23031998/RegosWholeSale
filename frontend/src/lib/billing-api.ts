import { apiRequest } from "@/lib/api";

export type BillingSubscription = {
  subscription_status: string;
  subscription_expires_at: string | null;
  subscription_active: boolean;
  monthly_price_uzs: number;
  allowed_periods: number[];
  checkout_enabled: boolean;
  currency: string;
};

export type CheckoutOrder = {
  id: string;
  company_id: number;
  amount: string | number;
  currency: string;
  period_months: number;
  period_days: number;
  status: string;
  payment_provider?: string | null;
  payment_transaction_id?: string | null;
  payment_url?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
  expires_at: string;
};

export type CheckoutCreateResponse = {
  order: CheckoutOrder;
  payment_url: string;
};

export async function fetchBillingSubscription(token: string): Promise<BillingSubscription> {
  return apiRequest("/api/v1/billing/subscription", { token });
}

export async function createCheckout(
  token: string,
  period_months: number,
): Promise<CheckoutCreateResponse> {
  return apiRequest("/api/v1/billing/checkout", {
    method: "POST",
    token,
    body: { period_months },
  });
}

export async function fetchCheckoutOrder(token: string, orderId: string): Promise<CheckoutOrder> {
  return apiRequest(`/api/v1/billing/orders/${encodeURIComponent(orderId)}`, { token });
}
