import { apiRequest } from "@/lib/api";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import type { ReceiptTemplate } from "@/types/receipt-templates";

export type PublicTemplateShareCreateResponse = {
  public_token: string;
  url: string;
  public_expires_at: string;
  is_public: boolean;
};

export type PublicTemplateShareResponse = {
  public_token: string;
  public_expires_at: string;
  is_public: boolean;
  template: ReceiptTemplate;
  context: DocumentPrintContext;
  document_code: string | null;
};

export type PublicTemplateShareMetadata = {
  documentCode?: string;
};

export async function createPublicTemplateShare(
  token: string,
  payload: {
    template: ReceiptTemplate;
    context: DocumentPrintContext;
    documentCode?: string;
  },
): Promise<PublicTemplateShareCreateResponse> {
  return apiRequest<PublicTemplateShareCreateResponse>("/api/v1/receipts/share", {
    method: "POST",
    token,
    body: {
      template: payload.template,
      context: payload.context,
      document_code: payload.documentCode,
    },
    timeoutMs: 60_000,
  });
}

export async function fetchPublicTemplateShare(
  publicToken: string,
): Promise<PublicTemplateShareResponse> {
  return apiRequest<PublicTemplateShareResponse>(
    `/api/v1/public/templates/${encodeURIComponent(publicToken)}`,
    { timeoutMs: 30_000 },
  );
}

export function buildPublicTemplateUrl(publicToken: string): string {
  if (typeof globalThis.location !== "undefined") {
    return `${globalThis.location.origin}/public/templates/${publicToken}`;
  }
  return `/public/templates/${publicToken}`;
}
