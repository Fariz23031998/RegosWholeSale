import { apiRequest } from "@/lib/api";
import type { PaymentTypesResponse } from "@/types/payment";

export async function fetchPaymentTypes(token: string): Promise<PaymentTypesResponse> {
  return apiRequest("/api/v1/regos/payment-types", { token });
}
