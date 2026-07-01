import { apiUpload } from "@/lib/api";

export type ReceiptShareCreateResponse = {
  share_id: string;
  url: string;
  expires_at: string;
  filename: string;
};

export type ReceiptShareUploadMetadata = {
  filename: string;
  documentCode?: string;
  templateName?: string;
};

export async function uploadReceiptShare(
  token: string,
  pdfBlob: Blob,
  metadata: ReceiptShareUploadMetadata,
): Promise<ReceiptShareCreateResponse> {
  const formData = new FormData();
  formData.append("file", pdfBlob, metadata.filename);
  if (metadata.documentCode) {
    formData.append("document_code", metadata.documentCode);
  }
  if (metadata.templateName) {
    formData.append("template_name", metadata.templateName);
  }
  return apiUpload<ReceiptShareCreateResponse>("/api/v1/receipts/share", formData, {
    token,
    timeoutMs: 60_000,
  });
}
