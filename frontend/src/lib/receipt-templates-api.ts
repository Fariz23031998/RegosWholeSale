import { apiRequest } from "@/lib/api";
import type {
  ReceiptTemplatesPatchRequest,
  ReceiptTemplatesResponse,
} from "@/types/receipt-templates";

export async function fetchReceiptTemplates(
  token: string,
): Promise<ReceiptTemplatesResponse> {
  return apiRequest("/api/v1/company/settings/receipt-templates", { token });
}

export async function patchReceiptTemplates(
  token: string,
  body: ReceiptTemplatesPatchRequest,
): Promise<ReceiptTemplatesResponse> {
  return apiRequest("/api/v1/company/settings/receipt-templates", {
    method: "PATCH",
    token,
    body,
  });
}
