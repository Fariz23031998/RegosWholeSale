import { apiRequest } from "@/lib/api";
import type {
  PaymentCreateRequest,
  PaymentDocument,
  PaymentEditRequest,
  PaymentMutationResponse,
  PaymentsListResponse,
} from "@/types/payments";

export type PaymentsListQuery = {
  start_date?: number | null;
  end_date?: number | null;
  partner_ids?: number[];
  all_partners?: boolean;
  firm_ids?: number[];
  direction?: "income" | "outcome" | null;
  performed?: boolean | null;
  deleted_mark?: boolean | null;
  search?: string | null;
  offset?: number;
  limit?: number;
};

function buildPaymentsQuery(query: PaymentsListQuery): string {
  const params = new URLSearchParams();
  if (query.start_date != null) params.set("start_date", String(query.start_date));
  if (query.end_date != null) params.set("end_date", String(query.end_date));
  if (query.all_partners != null) params.set("all_partners", String(query.all_partners));
  if (query.partner_ids?.length) {
    for (const id of query.partner_ids) {
      params.append("partner_ids", String(id));
    }
  }
  if (query.firm_ids?.length) {
    for (const id of query.firm_ids) {
      params.append("firm_ids", String(id));
    }
  }
  if (query.direction) params.set("direction", query.direction);
  if (query.performed != null) params.set("performed", String(query.performed));
  if (query.deleted_mark != null) params.set("deleted_mark", String(query.deleted_mark));
  if (query.search?.trim()) params.set("search", query.search.trim());
  params.set("offset", String(query.offset ?? 0));
  params.set("limit", String(query.limit ?? 50));
  return params.toString();
}

export async function fetchPayments(
  token: string,
  query: PaymentsListQuery = {},
): Promise<PaymentsListResponse> {
  return apiRequest(`/api/v1/payments?${buildPaymentsQuery(query)}`, { token });
}

export async function fetchPayment(
  token: string,
  paymentId: number,
): Promise<PaymentDocument> {
  return apiRequest(`/api/v1/payments/${paymentId}`, { token });
}

export async function createPayment(
  token: string,
  body: PaymentCreateRequest,
): Promise<PaymentDocument> {
  return apiRequest("/api/v1/payments", {
    token,
    method: "POST",
    body,
  });
}

export async function editPayment(
  token: string,
  paymentId: number,
  body: PaymentEditRequest,
): Promise<PaymentDocument> {
  return apiRequest(`/api/v1/payments/${paymentId}`, {
    token,
    method: "PATCH",
    body,
  });
}

export async function performPayment(
  token: string,
  paymentId: number,
): Promise<PaymentMutationResponse> {
  return apiRequest(`/api/v1/payments/${paymentId}/perform`, {
    token,
    method: "POST",
  });
}

export async function performCancelPayment(
  token: string,
  paymentId: number,
): Promise<PaymentMutationResponse> {
  return apiRequest(`/api/v1/payments/${paymentId}/perform-cancel`, {
    token,
    method: "POST",
  });
}

export async function deleteMarkPayment(
  token: string,
  paymentId: number,
): Promise<PaymentMutationResponse> {
  return apiRequest(`/api/v1/payments/${paymentId}/delete-mark`, {
    token,
    method: "POST",
  });
}

export async function deletePayment(
  token: string,
  paymentId: number,
): Promise<PaymentMutationResponse> {
  return apiRequest(`/api/v1/payments/${paymentId}`, {
    token,
    method: "DELETE",
  });
}
